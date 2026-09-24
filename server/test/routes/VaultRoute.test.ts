import {setupTestApp} from "../helpers/testApp";
import {createAuthenticatedUser, ITestUser} from "../helpers/auth";

const app = setupTestApp();

let admin: ITestUser;

beforeEach(async () => {
    admin = await createAuthenticatedUser(app, "Admin");
});

describe("registration bootstrap", () => {
    it("provisions a personal vault and sets it active", async () => {
        const policyRes = await admin.agent.get("/api/rest/app/policy");
        expect(policyRes.status).toBe(200);
        expect(typeof policyRes.body.user.id).toBe("number");
        expect(typeof policyRes.body.user.activeVault).toBe("number");

        const listRes = await admin.agent.get("/api/rest/vault");
        expect(listRes.status).toBe(200);
        expect(listRes.body).toEqual([
            expect.objectContaining({id: policyRes.body.user.activeVault}),
        ]);
    });
});

describe("vault CRUD", () => {
    it("creates a vault with the caller as its first (admin) member", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Shared Library", description: "Test"});
        expect(createRes.status).toBe(200);

        const detailRes = await admin.agent.get(`/api/rest/vault/${createRes.body.id}`);
        expect(detailRes.status).toBe(200);
        expect(detailRes.body.invitationUuid).toBeTruthy();
        expect(detailRes.body.roles.length).toBeGreaterThan(0);
        expect(detailRes.body.users).toEqual([
            expect.objectContaining({role: "admin", status: 1}),
        ]);
    });

    it("rejects creating a vault with a blank name", async () => {
        const res = await admin.agent.post("/api/rest/vault").send({name: "  "});
        expect(res.status).toBe(400);
    });

    it("updates a vault's settings, requiring can_manage_settings", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Original"});
        const vaultId = createRes.body.id;

        const updateRes = await admin.agent.put(`/api/rest/vault/${vaultId}`).send({name: "Renamed", description: "New desc", leasingEnabled: true});
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.name).toBe("Renamed");

        const outsider = await createAuthenticatedUser(app, "Outsider");
        const forbiddenRes = await outsider.agent.put(`/api/rest/vault/${vaultId}`).send({name: "Hijacked"});
        expect(forbiddenRes.status).toBe(404); // not a member at all
    });

    it("deletes an empty vault (regression: the vault's own admin membership used to trip the min-one-admin trigger)", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "To delete"});
        const vaultId = createRes.body.id;

        const deleteRes = await admin.agent.delete(`/api/rest/vault/${vaultId}`);
        expect(deleteRes.status).toBe(200);

        const getRes = await admin.agent.get(`/api/rest/vault/${vaultId}`);
        expect(getRes.status).toBe(404);
    });

    it("refuses to delete a vault that still owns content", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Has content"});
        const vaultId = createRes.body.id;
        await admin.agent.put(`/api/rest/vault/${vaultId}/active`);
        await admin.agent.post("/api/rest/book").field("name", "A book in the shared vault");

        const deleteRes = await admin.agent.delete(`/api/rest/vault/${vaultId}`);
        expect(deleteRes.status).toBe(409);
    });
});

describe("invite / join flow", () => {
    it("previews and joins via the invite link, at the least-privileged (readonly, pending) role", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Shared Library"});
        const vaultId = createRes.body.id;
        const detailRes = await admin.agent.get(`/api/rest/vault/${vaultId}`);
        const uuid = detailRes.body.invitationUuid;

        const bob = await createAuthenticatedUser(app, "Bob");
        const previewRes = await bob.agent.get(`/api/rest/vault/invite/${uuid}`);
        expect(previewRes.status).toBe(200);
        expect(previewRes.body.name).toBe("Shared Library");

        const joinRes = await bob.agent.post(`/api/rest/vault/join/${uuid}`);
        expect(joinRes.status).toBe(200);

        const bobPolicy = await bob.agent.get("/api/rest/app/policy");
        const membersRes = await admin.agent.get(`/api/rest/vault/${vaultId}/members`);
        expect(membersRes.body).toEqual(expect.arrayContaining([
            expect.objectContaining({user_id: bobPolicy.body.user.id, role: "readonly", status: 0}),
        ]));
    });

    it("rejects joining twice", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Shared Library"});
        const detailRes = await admin.agent.get(`/api/rest/vault/${createRes.body.id}`);
        const uuid = detailRes.body.invitationUuid;

        const bob = await createAuthenticatedUser(app, "Bob");
        await bob.agent.post(`/api/rest/vault/join/${uuid}`);
        const secondJoinRes = await bob.agent.post(`/api/rest/vault/join/${uuid}`);
        expect(secondJoinRes.status).toBe(409);
    });

    it("404s previewing an unknown invite uuid", async () => {
        const res = await admin.agent.get("/api/rest/vault/invite/00000000-0000-0000-0000-000000000000");
        expect(res.status).toBe(404);
    });
});

describe("member management", () => {
    async function createVaultWithPendingBob() {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Shared Library"});
        const vaultId = createRes.body.id;
        const detailRes = await admin.agent.get(`/api/rest/vault/${vaultId}`);
        const uuid = detailRes.body.invitationUuid;

        const bob = await createAuthenticatedUser(app, "Bob");
        await bob.agent.post(`/api/rest/vault/join/${uuid}`);
        const bobPolicy = await bob.agent.get("/api/rest/app/policy");
        return {vaultId, bob, bobId: bobPolicy.body.user.id};
    }

    it("approves a pending member and can change their role", async () => {
        const {vaultId, bobId} = await createVaultWithPendingBob();

        const approveRes = await admin.agent.put(`/api/rest/vault/${vaultId}/members/${bobId}`).send({status: 1});
        expect(approveRes.status).toBe(200);

        const rolesRes = await admin.agent.get("/api/rest/vault/roles");
        const normalRole = rolesRes.body.find((r: any) => r.name === "normal");
        const roleRes = await admin.agent.put(`/api/rest/vault/${vaultId}/members/${bobId}`).send({role: normalRole.code});
        expect(roleRes.status).toBe(200);

        const membersRes = await admin.agent.get(`/api/rest/vault/${vaultId}/members`);
        expect(membersRes.body).toEqual(expect.arrayContaining([
            expect.objectContaining({user_id: bobId, status: 1, role: "normal"}),
        ]));
    });

    it("rejects member updates from an accepted member without can_manage_members", async () => {
        const {vaultId, bob, bobId} = await createVaultWithPendingBob();
        await admin.agent.put(`/api/rest/vault/${vaultId}/members/${bobId}`).send({status: 1}); // accepted, still "readonly"

        const adminPolicy = await admin.agent.get("/api/rest/app/policy");
        const res = await bob.agent.put(`/api/rest/vault/${vaultId}/members/${adminPolicy.body.user.id}`).send({role: 0});
        expect(res.status).toBe(403);
    });

    it("removing a member clears their active vault if it pointed here (regression: used to leave a dangling reference, both blocking vault deletion and leaving the removed member's next request still resolving into it)", async () => {
        const {vaultId, bob, bobId} = await createVaultWithPendingBob();
        await admin.agent.put(`/api/rest/vault/${vaultId}/members/${bobId}`).send({status: 1});
        await bob.agent.put(`/api/rest/vault/${vaultId}/active`);

        const removeRes = await admin.agent.delete(`/api/rest/vault/${vaultId}/members/${bobId}`);
        expect(removeRes.status).toBe(200);

        const bobPolicy = await bob.agent.get("/api/rest/app/policy");
        expect(bobPolicy.body.user.activeVault).not.toBe(vaultId);

        // Bob's own personal vault (created at registration) is the only
        // other one he belongs to - that's what he should have fallen back to.
        const bobVaults = await bob.agent.get("/api/rest/vault");
        expect(bobVaults.body.map((v: any) => v.id)).toContain(bobPolicy.body.user.activeVault);
    });

    it("lets a member leave on their own without can_manage_members", async () => {
        const {vaultId, bob, bobId} = await createVaultWithPendingBob();
        await admin.agent.put(`/api/rest/vault/${vaultId}/members/${bobId}`).send({status: 1});

        const leaveRes = await bob.agent.delete(`/api/rest/vault/${vaultId}/members/${bobId}`);
        expect(leaveRes.status).toBe(200);

        const membersRes = await admin.agent.get(`/api/rest/vault/${vaultId}/members`);
        expect(membersRes.body.some((m: any) => m.user_id === bobId)).toBe(false);
    });

    it("rejects removing the vault's last admin", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Shared Library"});
        const vaultId = createRes.body.id;
        const adminPolicy = await admin.agent.get("/api/rest/app/policy");

        const res = await admin.agent.delete(`/api/rest/vault/${vaultId}/members/${adminPolicy.body.user.id}`);
        expect(res.status).toBe(400);
    });
});

describe("active vault switching", () => {
    it("switches the caller's active vault", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Second vault"});
        const vaultId = createRes.body.id;

        const switchRes = await admin.agent.put(`/api/rest/vault/${vaultId}/active`);
        expect(switchRes.status).toBe(200);

        const policyRes = await admin.agent.get("/api/rest/app/policy");
        expect(policyRes.body.user.activeVault).toBe(vaultId);
    });

    it("404s switching to a vault the caller isn't a member of", async () => {
        const outsider = await createAuthenticatedUser(app, "Outsider");
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Not yours"});

        const res = await outsider.agent.put(`/api/rest/vault/${createRes.body.id}/active`);
        expect(res.status).toBe(404);
    });
});
