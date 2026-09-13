import request from "supertest";
import {setupTestApp} from "../helpers/testApp";
import {nextFakeIp, TEST_PASSWORD} from "../helpers/auth";

const app = setupTestApp();

/** A fresh {userName, email, name} triple for one register attempt - avoids colliding with other tests' accounts. */
function freshIdentity() {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {userName: `auth_${suffix}`, email: `auth_${suffix}@example.com`, name: "Auth Test User"};
}

describe("POST /register", () => {
    it("creates an account that can immediately log in (REGISTRATION_REQUIRES_APPROVAL=false)", async () => {
        const {userName, email, name} = freshIdentity();
        const ip = nextFakeIp();

        const registerRes = await request(app)
            .post("/register")
            .set("X-Forwarded-For", ip)
            .send({userName, email, name, password: TEST_PASSWORD});

        expect(registerRes.status).toBe(201);
        expect(registerRes.body).toMatchObject({success: true, requiresApproval: false});

        const loginRes = await request(app)
            .post("/login")
            .set("X-Forwarded-For", ip)
            .send({username: userName, password: TEST_PASSWORD});

        expect(loginRes.status).toBe(200);
        expect(loginRes.body).toMatchObject({success: true, redirectUrl: "/app"});
        const setCookie = loginRes.headers["set-cookie"]?.join(";") ?? "";
        expect(setCookie).toMatch(/token=/);
        expect(setCookie).toMatch(/SameSite=Lax/i);
    });

    it("trims surrounding whitespace from username and email", async () => {
        const {userName, email, name} = freshIdentity();
        const ip = nextFakeIp();

        const registerRes = await request(app)
            .post("/register")
            .set("X-Forwarded-For", ip)
            .send({userName: `  ${userName}  `, email: `  ${email}  `, name, password: TEST_PASSWORD});
        expect(registerRes.status).toBe(201);

        // Logs in with the untrimmed username too - proves it was stored trimmed.
        const loginRes = await request(app)
            .post("/login")
            .set("X-Forwarded-For", ip)
            .send({username: userName, password: TEST_PASSWORD});
        expect(loginRes.status).toBe(200);
    });

    it("rejects a duplicate email/username with a generic message (no account enumeration)", async () => {
        const {userName, email, name} = freshIdentity();
        const ip = nextFakeIp();

        const first = await request(app)
            .post("/register")
            .set("X-Forwarded-For", ip)
            .send({userName, email, name, password: TEST_PASSWORD});
        expect(first.status).toBe(201);

        const second = await request(app)
            .post("/register")
            .set("X-Forwarded-For", ip)
            .send({userName, email, name, password: TEST_PASSWORD});
        expect(second.status).toBe(400);
        expect(second.body.message).not.toMatch(/already exists|taken/i);
    });

    it("rejects a weak password", async () => {
        const {userName, email, name} = freshIdentity();
        const res = await request(app)
            .post("/register")
            .set("X-Forwarded-For", nextFakeIp())
            .send({userName, email, name, password: "weak"});

        expect(res.status).toBe(400);
    });

    it("rejects an invalid email format", async () => {
        const {userName, name} = freshIdentity();
        const res = await request(app)
            .post("/register")
            .set("X-Forwarded-For", nextFakeIp())
            .send({userName, email: "not-an-email", name, password: TEST_PASSWORD});

        expect(res.status).toBe(400);
    });

    it("rejects missing required fields", async () => {
        const res = await request(app)
            .post("/register")
            .set("X-Forwarded-For", nextFakeIp())
            .send({userName: "onlyusername"});

        expect(res.status).toBe(400);
    });
});

describe("POST /login", () => {
    it("rejects an unknown username", async () => {
        const res = await request(app)
            .post("/login")
            .set("X-Forwarded-For", nextFakeIp())
            .send({username: "no-such-user", password: TEST_PASSWORD});

        expect(res.status).toBe(401);
    });

    it("rejects the wrong password for a real account", async () => {
        const {userName, email, name} = freshIdentity();
        const ip = nextFakeIp();

        await request(app)
            .post("/register")
            .set("X-Forwarded-For", ip)
            .send({userName, email, name, password: TEST_PASSWORD});

        const res = await request(app)
            .post("/login")
            .set("X-Forwarded-For", ip)
            .send({username: userName, password: "WrongPassword1!"});

        expect(res.status).toBe(401);
    });

    it("rejects a missing username or password", async () => {
        const res = await request(app)
            .post("/login")
            .set("X-Forwarded-For", nextFakeIp())
            .send({username: "someone"});

        expect(res.status).toBe(400);
    });
});

describe("GET /logout", () => {
    it("clears the session cookie and redirects to /login", async () => {
        const {userName, email, name} = freshIdentity();
        const ip = nextFakeIp();
        const agent = request.agent(app);

        await agent.post("/register").set("X-Forwarded-For", ip).send({userName, email, name, password: TEST_PASSWORD});
        await agent.post("/login").set("X-Forwarded-For", ip).send({username: userName, password: TEST_PASSWORD});

        const logoutRes = await agent.get("/logout");
        expect(logoutRes.status).toBe(302);
        expect(logoutRes.headers.location).toBe("/login");

        // clearCookie's Set-Cookie removes it from the agent's jar, so the next
        // request carries no token at all - requireAuth redirects rather than 401s.
        const policyRes = await agent.get("/api/rest/app/policy");
        expect(policyRes.status).toBe(302);
    });

    it("still succeeds (redirects) with no cookie at all", async () => {
        const res = await request(app).get("/logout");
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe("/login");
    });
});

describe("GET /auth/oidc/* (disabled by default)", () => {
    it("reports SSO disabled when OIDC env vars are unset", async () => {
        const res = await request(app).get("/auth/oidc/status");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({enabled: false, label: "Sign in with SSO"});
    });

    it("returns 404 from /auth/oidc/start when SSO is not configured", async () => {
        const res = await request(app)
            .get("/auth/oidc/start")
            .set("X-Forwarded-For", nextFakeIp());
        expect(res.status).toBe(404);
        expect(res.body.message).toMatch(/not configured/i);
    });

    it("redirects a callback with no pending login to /login?error=sso", async () => {
        const res = await request(app)
            .get("/auth/oidc/callback")
            .set("X-Forwarded-For", nextFakeIp())
            .redirects(0);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe("/login?error=sso");
    });
});
