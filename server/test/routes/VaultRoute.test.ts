import {setupTestApp} from "../helpers/testApp";
import {createAuthenticatedUser, ITestUser} from "../helpers/auth";
import {appService} from "../../src/AppService";

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

describe("GET /vault/roles", () => {
    it("lists the four fixed roles with their permissions, least to most privileged", async () => {
        const res = await admin.agent.get("/api/rest/vault/roles");
        expect(res.status).toBe(200);

        const byName = Object.fromEntries(res.body.map((r: any) => [r.name, r]));
        expect(Object.keys(byName).sort()).toEqual(["admin", "borrower", "normal", "readonly"]);

        expect(byName.readonly).toMatchObject({can_borrow: false, can_edit_catalog: false, can_manage_members: false, can_manage_settings: false});
        expect(byName.borrower).toMatchObject({can_borrow: true, can_edit_catalog: false, can_manage_members: false, can_manage_settings: false});
        expect(byName.normal).toMatchObject({can_borrow: true, can_edit_catalog: true, can_manage_members: false, can_manage_settings: false});
        expect(byName.admin).toMatchObject({can_borrow: true, can_edit_catalog: true, can_manage_members: true, can_manage_settings: true});

        // rank, not code, is what sorts least to most permissive.
        const byRank = [...res.body].sort((a: any, b: any) => a.rank - b.rank).map((r: any) => r.name);
        expect(byRank).toEqual(["readonly", "borrower", "normal", "admin"]);
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

    it("404s fetching a vault the caller isn't a member of at all", async () => {
        const outsider = await createAuthenticatedUser(app, "Outsider");
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Not yours"});

        const res = await outsider.agent.get(`/api/rest/vault/${createRes.body.id}`);
        expect(res.status).toBe(404);
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

    it("rejects a pending join request, leaving the member excluded from the vault", async () => {
        const {vaultId, bob, bobId} = await createVaultWithPendingBob();

        const rejectRes = await admin.agent.put(`/api/rest/vault/${vaultId}/members/${bobId}`).send({status: 2});
        expect(rejectRes.status).toBe(200);

        const membersRes = await admin.agent.get(`/api/rest/vault/${vaultId}/members`);
        expect(membersRes.body).toEqual(expect.arrayContaining([
            expect.objectContaining({user_id: bobId, status: 2}),
        ]));

        // Still not an accepted member - listing the vault's members (or
        // anything else vault-scoped) is refused, same as if never invited.
        const bobMembersRes = await bob.agent.get(`/api/rest/vault/${vaultId}/members`);
        expect(bobMembersRes.status).toBe(404);
    });

    it("a pending (not-yet-accepted) member can't list the vault's members", async () => {
        const {vaultId, bob} = await createVaultWithPendingBob();
        const res = await bob.agent.get(`/api/rest/vault/${vaultId}/members`);
        expect(res.status).toBe(404);
    });

    it("400s updating a member with neither role nor status", async () => {
        const {vaultId, bobId} = await createVaultWithPendingBob();
        const res = await admin.agent.put(`/api/rest/vault/${vaultId}/members/${bobId}`).send({});
        expect(res.status).toBe(400);
    });

    it("400s updating a member with an invalid status value", async () => {
        const {vaultId, bobId} = await createVaultWithPendingBob();
        const res = await admin.agent.put(`/api/rest/vault/${vaultId}/members/${bobId}`).send({status: 99});
        expect(res.status).toBe(400);
    });

    it("404s updating someone who was never a member of the vault", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Shared Library"});
        const vaultId = createRes.body.id;
        const outsider = await createAuthenticatedUser(app, "Outsider");
        const outsiderPolicy = await outsider.agent.get("/api/rest/app/policy");

        const updateRes = await admin.agent.put(`/api/rest/vault/${vaultId}/members/${outsiderPolicy.body.user.id}`).send({status: 1});
        expect(updateRes.status).toBe(404);
    });

    it("removing someone who was never a member of the vault is a no-op, not an error", async () => {
        // Unlike updateMember, VaultRepository.removeMember never checks
        // whether it actually deleted a row - DELETE FROM ... WHERE (no
        // match) is silently a no-op, so this "succeeds" (200) same as a
        // real removal would.
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Shared Library"});
        const vaultId = createRes.body.id;
        const outsider = await createAuthenticatedUser(app, "Outsider");
        const outsiderPolicy = await outsider.agent.get("/api/rest/app/policy");

        const removeRes = await admin.agent.delete(`/api/rest/vault/${vaultId}/members/${outsiderPolicy.body.user.id}`);
        expect(removeRes.status).toBe(200);
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

describe("deleting a vault with content (transfer)", () => {
    it("refuses to delete the caller's only vault, even if empty", async () => {
        const policyRes = await admin.agent.get("/api/rest/app/policy");
        const onlyVaultId = policyRes.body.user.activeVault;

        const deleteRes = await admin.agent.delete(`/api/rest/vault/${onlyVaultId}`);
        expect(deleteRes.status).toBe(409);
    });

    it("400s when transferToVaultId is the vault being deleted", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Vault B"});
        const vaultBId = createRes.body.id;

        const deleteRes = await admin.agent.delete(`/api/rest/vault/${vaultBId}`).send({transferToVaultId: vaultBId});
        expect(deleteRes.status).toBe(400);
    });

    it("404s when transferToVaultId is a vault the caller doesn't belong to", async () => {
        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Vault B"});
        const vaultBId = createRes.body.id;
        const outsider = await createAuthenticatedUser(app, "Outsider");
        const outsiderPolicy = await outsider.agent.get("/api/rest/app/policy");

        const deleteRes = await admin.agent.delete(`/api/rest/vault/${vaultBId}`).send({transferToVaultId: outsiderPolicy.body.user.activeVault});
        expect(deleteRes.status).toBe(404);
    });

    it("merges content into the destination vault, deduping same-named categories/authors/customer groups, and deletes the source vault", async () => {
        const policyRes = await admin.agent.get("/api/rest/app/policy");
        const vaultAId = policyRes.body.user.activeVault;

        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Vault B"});
        const vaultBId = createRes.body.id;
        await admin.agent.put(`/api/rest/vault/${vaultBId}/active`);

        const pool = appService.getDatabasePool();

        // Pre-existing rows in vault A that should be reused (deduped) rather than duplicated.
        const {rows: [{id: catAId}]} = await pool.query("INSERT INTO categories (vault_id, name) VALUES ($1, 'Fiction') RETURNING id", [vaultAId]);
        const {rows: [{id: authorAId}]} = await pool.query("INSERT INTO authors (vault_id, name) VALUES ($1, 'Stephen King') RETURNING id", [vaultAId]);
        const {rows: [{id: groupAId}]} = await pool.query("INSERT INTO customer_groups (vault_id, name) VALUES ($1, 'VIP') RETURNING id", [vaultAId]);
        await pool.query("INSERT INTO locations (vault_id, name, \"default\") VALUES ($1, 'Main shelf', TRUE)", [vaultAId]);

        // Content in vault B, one of each colliding by name with vault A's.
        const {rows: [{id: catBId}]} = await pool.query("INSERT INTO categories (vault_id, name) VALUES ($1, 'Fiction') RETURNING id", [vaultBId]);
        const {rows: [{id: authorBId}]} = await pool.query("INSERT INTO authors (vault_id, name) VALUES ($1, 'Stephen King') RETURNING id", [vaultBId]);
        const {rows: [{id: groupBId}]} = await pool.query("INSERT INTO customer_groups (vault_id, name) VALUES ($1, 'VIP') RETURNING id", [vaultBId]);
        const {rows: [{id: locBId}]} = await pool.query("INSERT INTO locations (vault_id, name, \"default\") VALUES ($1, 'Storage', TRUE) RETURNING id", [vaultBId]);
        const {rows: [{id: customerBId}]} = await pool.query("INSERT INTO customers (vault_id, name, group_id) VALUES ($1, 'Alice', $2) RETURNING id", [vaultBId, groupBId]);
        const {rows: [{id: bookBId}]} = await pool.query("INSERT INTO books (vault_id, name, category_id) VALUES ($1, 'The Shining', $2) RETURNING id", [vaultBId, catBId]);
        await pool.query("INSERT INTO book_authors (book_id, author_id, vault_id) VALUES ($1, $2, $3)", [bookBId, authorBId, vaultBId]);
        await pool.query("INSERT INTO book_stocks (vault_id, book_id, code, location_id, status) VALUES ($1, $2, 'ABC1234567', $3, 0)", [vaultBId, bookBId, locBId]);

        const deleteRes = await admin.agent.delete(`/api/rest/vault/${vaultBId}`).send({transferToVaultId: vaultAId});
        expect(deleteRes.status).toBe(200);

        const getVaultBRes = await admin.agent.get(`/api/rest/vault/${vaultBId}`);
        expect(getVaultBRes.status).toBe(404);

        // The caller's active vault (vault B) followed its content into vault A.
        const policyAfter = await admin.agent.get("/api/rest/app/policy");
        expect(policyAfter.body.user.activeVault).toBe(vaultAId);

        // Deduped: exactly one "Fiction"/"Stephen King"/"VIP" row in vault A, matching the ORIGINAL vault-A id - vault B's duplicate was dropped, not moved.
        expect((await pool.query("SELECT id FROM categories WHERE vault_id = $1 AND name = 'Fiction'", [vaultAId])).rows).toEqual([{id: catAId}]);
        expect((await pool.query("SELECT id FROM authors WHERE vault_id = $1 AND name = 'Stephen King'", [vaultAId])).rows).toEqual([{id: authorAId}]);
        expect((await pool.query("SELECT id FROM customer_groups WHERE vault_id = $1 AND name = 'VIP'", [vaultAId])).rows).toEqual([{id: groupAId}]);
        expect((await pool.query("SELECT id FROM categories WHERE id = $1", [catBId])).rows).toEqual([]);
        expect((await pool.query("SELECT id FROM authors WHERE id = $1", [authorBId])).rows).toEqual([]);
        expect((await pool.query("SELECT id FROM customer_groups WHERE id = $1", [groupBId])).rows).toEqual([]);

        // The moved book now points at vault A's pre-existing category, and its author link was repointed.
        const bookRes = await pool.query("SELECT vault_id, category_id FROM books WHERE id = $1", [bookBId]);
        expect(bookRes.rows[0]).toEqual({vault_id: vaultAId, category_id: catAId});
        const bookAuthorRes = await pool.query("SELECT author_id, vault_id FROM book_authors WHERE book_id = $1", [bookBId]);
        expect(bookAuthorRes.rows).toEqual([{author_id: authorAId, vault_id: vaultAId}]);

        // The moved customer/stock followed, and the customer's group was repointed to vault A's group.
        const customerRes = await pool.query("SELECT vault_id, group_id FROM customers WHERE id = $1", [customerBId]);
        expect(customerRes.rows[0]).toEqual({vault_id: vaultAId, group_id: groupAId});
        const stockRes = await pool.query("SELECT vault_id FROM book_stocks WHERE book_id = $1", [bookBId]);
        expect(stockRes.rows[0]).toEqual({vault_id: vaultAId});

        // Only one default location remains for vault A - vault B's default was demoted on the way in.
        const defaultLocationsRes = await pool.query("SELECT COUNT(*) FROM locations WHERE vault_id = $1 AND \"default\" = TRUE", [vaultAId]);
        expect(Number(defaultLocationsRes.rows[0].count)).toBe(1);
        const movedLocationRes = await pool.query("SELECT \"default\" FROM locations WHERE id = $1", [locBId]);
        expect(movedLocationRes.rows[0].default).toBe(false);
    });

    it("409s and rolls back entirely when both vaults have a book with the same isbn", async () => {
        const policyRes = await admin.agent.get("/api/rest/app/policy");
        const vaultAId = policyRes.body.user.activeVault;

        const createRes = await admin.agent.post("/api/rest/vault").send({name: "Vault B"});
        const vaultBId = createRes.body.id;

        const pool = appService.getDatabasePool();
        await pool.query("INSERT INTO books (vault_id, name, isbn) VALUES ($1, 'Copy A', '1234567890')", [vaultAId]);
        const {rows: [{id: bookBId}]} = await pool.query("INSERT INTO books (vault_id, name, isbn) VALUES ($1, 'Copy B', '1234567890') RETURNING id", [vaultBId]);

        const deleteRes = await admin.agent.delete(`/api/rest/vault/${vaultBId}`).send({transferToVaultId: vaultAId});
        expect(deleteRes.status).toBe(409);

        // Nothing moved - the whole merge rolled back.
        const getVaultBRes = await admin.agent.get(`/api/rest/vault/${vaultBId}`);
        expect(getVaultBRes.status).toBe(200);
        const bookRes = await pool.query("SELECT vault_id FROM books WHERE id = $1", [bookBId]);
        expect(bookRes.rows[0]).toEqual({vault_id: vaultBId});
    });
});
