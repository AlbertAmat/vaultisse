import request from "supertest";
import {setupTestApp} from "../helpers/testApp";
import {createAuthenticatedUser} from "../helpers/auth";
import {appService} from "../../src/AppService";

const app = setupTestApp();

describe("GET /app/version", () => {
    it("responds with a version and uptime, unauthenticated", async () => {
        const res = await request(app).get("/api/rest/app/version");

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("version");
        expect(typeof res.body.uptime).toBe("number");
    });
});

describe("GET /app/policy", () => {
    it("redirects a request with no session cookie at all", async () => {
        const res = await request(app).get("/api/rest/app/policy");
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe("/login");
    });

    it("rejects a request with an invalid session cookie", async () => {
        const res = await request(app)
            .get("/api/rest/app/policy")
            .set("Cookie", "token=not-a-real-jwt");

        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({sessionExpired: true});
    });

    it("returns the bootstrap payload for a logged-in user", async () => {
        const {agent, name, email} = await createAuthenticatedUser(app);

        const res = await agent.get("/api/rest/app/policy");

        expect(res.status).toBe(200);
        expect(res.body.user).toMatchObject({name, email});
        expect(Array.isArray(res.body.categories)).toBe(true);
        expect(Array.isArray(res.body.languages)).toBe(true);
        expect(Array.isArray(res.body.formats)).toBe(true);
        expect(Array.isArray(res.body.locations)).toBe(true);
        expect(Array.isArray(res.body.customers)).toBe(true);
        // Seeded by databaseSchema.sql - confirms the schema load in
        // globalSetup actually ran, not just that the endpoint responds.
        expect(res.body.formats.length).toBeGreaterThan(0);
        expect(res.body.languages.length).toBeGreaterThan(0);
        // Real value from AppService, not a hardcoded client-side copy -
        // see the MAX_IMPORT_FILE_SIZE_MB feature this guards against drifting.
        expect(res.body.maxImportFileSizeMb).toBe(10);
    });

    it("rejects a session past its absolute lifetime, even though the JWT itself hasn't expired (security audit #11)", async () => {
        // Without an absolute cap, a session that's used at least once every
        // SESSION_TIME window keeps getting silently reissued by
        // AuthMiddleware and never actually expires. Simulate that by
        // backdating the session's created_date past MAX_SESSION_AGE_DAYS
        // (default 30) directly, rather than waiting real time.
        const {agent, userCode} = await createAuthenticatedUser(app);

        const beforeRes = await agent.get("/api/rest/app/policy");
        expect(beforeRes.status).toBe(200);

        await appService.getDatabasePool().query(
            `UPDATE user_sessions
                SET created_date = NOW() - INTERVAL '31 days'
              WHERE user_id = (SELECT id FROM users WHERE code = $1)`,
            [userCode]
        );

        const afterRes = await agent.get("/api/rest/app/policy");
        expect(afterRes.status).toBe(401);
        expect(afterRes.body).toMatchObject({sessionExpired: true});
    });
});
