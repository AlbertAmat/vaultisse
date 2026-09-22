import {generate} from "otplib";
import request from "supertest";
import {setupTestApp} from "../helpers/testApp";
import {createAuthenticatedUser, nextFakeIp, TEST_PASSWORD} from "../helpers/auth";

const app = setupTestApp();

describe("PUT /user", () => {
    it("updates the current user's profile fields", async () => {
        const user = await createAuthenticatedUser(app);

        const res = await user.agent.put("/api/rest/user").send({
            name: "Updated Name",
            email: user.email,
            language: "es",
            region: "US",
        });
        expect(res.status).toBe(200);

        const policyRes = await user.agent.get("/api/rest/app/policy");
        expect(policyRes.body.user).toMatchObject({name: "Updated Name", language: "es"});
    });

    describe("changing the email (security audit #8)", () => {
        it("rejects an email change with no currentPassword", async () => {
            const user = await createAuthenticatedUser(app);

            const res = await user.agent.put("/api/rest/user").send({
                name: user.name,
                email: "new-" + user.email,
                language: "en",
                region: "US",
            });
            expect(res.status).toBe(401);

            const policyRes = await user.agent.get("/api/rest/app/policy");
            expect(policyRes.body.user.email).toBe(user.email);
        });

        it("rejects an email change with the wrong currentPassword", async () => {
            const user = await createAuthenticatedUser(app);

            const res = await user.agent.put("/api/rest/user").send({
                name: user.name,
                email: "new-" + user.email,
                language: "en",
                region: "US",
                currentPassword: "WrongPassword1!",
            });
            expect(res.status).toBe(401);
        });

        it("allows an email change with the correct currentPassword", async () => {
            const user = await createAuthenticatedUser(app);
            const newEmail = "new-" + user.email;

            const res = await user.agent.put("/api/rest/user").send({
                name: user.name,
                email: newEmail,
                language: "en",
                region: "US",
                currentPassword: TEST_PASSWORD,
            });
            expect(res.status).toBe(200);

            const policyRes = await user.agent.get("/api/rest/app/policy");
            expect(policyRes.body.user.email).toBe(newEmail);
        });
    });
});

describe("PATCH /user/theme", () => {
    it("accepts a valid theme", async () => {
        const user = await createAuthenticatedUser(app);
        const res = await user.agent.patch("/api/rest/user/theme").send({theme: "library"});
        expect(res.status).toBe(200);
    });

    it("rejects an invalid theme", async () => {
        const user = await createAuthenticatedUser(app);
        const res = await user.agent.patch("/api/rest/user/theme").send({theme: "not-a-theme"});
        expect(res.status).toBe(400);
    });
});

describe("PATCH /user/sidebar-rail", () => {
    it("accepts a boolean", async () => {
        const user = await createAuthenticatedUser(app);
        const res = await user.agent.patch("/api/rest/user/sidebar-rail").send({sidebarRail: true});
        expect(res.status).toBe(200);
    });

    it("rejects a non-boolean", async () => {
        const user = await createAuthenticatedUser(app);
        const res = await user.agent.patch("/api/rest/user/sidebar-rail").send({sidebarRail: "yes"});
        expect(res.status).toBe(400);
    });
});

describe("PATCH /user/leasing", () => {
    it("accepts a boolean", async () => {
        const user = await createAuthenticatedUser(app);
        const res = await user.agent.patch("/api/rest/user/leasing").send({leasingEnabled: true});
        expect(res.status).toBe(200);
    });
});

describe("POST /user/password", () => {
    it("changes the password and keeps the current session valid", async () => {
        const user = await createAuthenticatedUser(app);
        const ip = nextFakeIp();

        const res = await user.agent
            .post("/api/rest/user/password")
            .set("X-Forwarded-For", ip)
            .send({currentPassword: TEST_PASSWORD, newPassword: "NewPass123!"});

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({success: true});

        // The old password no longer works...
        const oldLoginRes = await user.agent
            .post("/login")
            .set("X-Forwarded-For", ip)
            .send({username: user.userCode, password: TEST_PASSWORD});
        expect(oldLoginRes.status).toBe(401);

        // ...but the new one does.
        const newLoginRes = await user.agent
            .post("/login")
            .set("X-Forwarded-For", ip)
            .send({username: user.userCode, password: "NewPass123!"});
        expect(newLoginRes.status).toBe(200);
    });

    it("rejects the wrong current password", async () => {
        const user = await createAuthenticatedUser(app);

        const res = await user.agent
            .post("/api/rest/user/password")
            .set("X-Forwarded-For", nextFakeIp())
            .send({currentPassword: "WrongCurrent1!", newPassword: "NewPass123!"});

        expect(res.status).toBe(401);
    });

    it("rejects a weak new password", async () => {
        const user = await createAuthenticatedUser(app);

        const res = await user.agent
            .post("/api/rest/user/password")
            .set("X-Forwarded-For", nextFakeIp())
            .send({currentPassword: TEST_PASSWORD, newPassword: "weak"});

        expect(res.status).toBe(400);
        expect(res.body.missing.length).toBeGreaterThan(0);
    });
});

describe("GET /user/sessions and DELETE /user/sessions/:id", () => {
    it("lists the current session and can revoke it", async () => {
        const user = await createAuthenticatedUser(app);

        const listRes = await user.agent.get("/api/rest/user/sessions");
        expect(listRes.status).toBe(200);
        expect(listRes.body.length).toBeGreaterThan(0);
        const current = listRes.body.find((s: any) => s.isCurrent);
        expect(current).toBeDefined();

        const deleteRes = await user.agent.delete(`/api/rest/user/sessions/${current.id}`);
        expect(deleteRes.status).toBe(200);

        // The revoked session's own cookie no longer authenticates.
        const afterRes = await user.agent.get("/api/rest/app/policy");
        expect(afterRes.status).toBe(302);
    });
});

describe("GET /user/activity", () => {
    it("records a login event", async () => {
        const user = await createAuthenticatedUser(app);
        const res = await user.agent.get("/api/rest/user/activity");
        expect(res.status).toBe(200);
        expect(res.body.some((a: any) => a.action === "login")).toBe(true);
    });
});

describe("Two-factor authentication", () => {
    it("supports the full setup -> enable -> gated login -> disable round trip", async () => {
        const user = await createAuthenticatedUser(app);

        const setupRes = await user.agent.post("/api/rest/user/2fa/setup");
        expect(setupRes.status).toBe(200);
        const {secret} = setupRes.body;
        expect(typeof secret).toBe("string");

        const enableRes = await user.agent
            .post("/api/rest/user/2fa/enable")
            .set("X-Forwarded-For", nextFakeIp())
            .send({code: await generate({secret})});
        expect(enableRes.status).toBe(200);
        expect(enableRes.body.success).toBe(true);
        expect(enableRes.body.backupCodes.length).toBeGreaterThan(0);

        // A fresh login now stops at the password step.
        const freshAgent = request.agent(app);
        const loginIp = nextFakeIp();
        const loginRes = await freshAgent
            .post("/login")
            .set("X-Forwarded-For", loginIp)
            .send({username: user.userCode, password: TEST_PASSWORD});
        expect(loginRes.body).toMatchObject({success: true, twoFactorRequired: true});

        const twoFaRes = await freshAgent
            .post("/login/2fa")
            .set("X-Forwarded-For", loginIp)
            .send({code: await generate({secret})});
        expect(twoFaRes.status).toBe(200);
        expect(twoFaRes.body).toMatchObject({success: true, redirectUrl: "/app"});

        const disableRes = await user.agent
            .post("/api/rest/user/2fa/disable")
            .set("X-Forwarded-For", nextFakeIp())
            .send({password: TEST_PASSWORD});
        expect(disableRes.status).toBe(200);
    });

    it("rejects enabling with an invalid code", async () => {
        const user = await createAuthenticatedUser(app);
        await user.agent.post("/api/rest/user/2fa/setup");

        const res = await user.agent
            .post("/api/rest/user/2fa/enable")
            .set("X-Forwarded-For", nextFakeIp())
            .send({code: "000000"});
        expect(res.status).toBe(401);
    });
});

describe("DELETE /user (account deletion)", () => {
    it("rejects the wrong password", async () => {
        const user = await createAuthenticatedUser(app);
        const res = await user.agent
            .delete("/api/rest/user")
            .set("X-Forwarded-For", nextFakeIp())
            .send({password: "WrongPassword1!"});
        expect(res.status).toBe(401);
    });

    it("deletes the account with the correct password", async () => {
        const user = await createAuthenticatedUser(app);
        const res = await user.agent
            .delete("/api/rest/user")
            .set("X-Forwarded-For", nextFakeIp())
            .send({password: TEST_PASSWORD});
        expect(res.status).toBe(302);

        const loginRes = await user.agent
            .post("/login")
            .set("X-Forwarded-For", nextFakeIp())
            .send({username: user.userCode, password: TEST_PASSWORD});
        expect(loginRes.status).toBe(401);
    });
});
