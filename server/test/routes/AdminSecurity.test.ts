import "../helpers/adminEnv";
import request from "supertest";
import {appService} from "../../src/AppService";
import {guardedLookup} from "../../src/admin/services/WebhookService";
import {createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";

const apps = setupAdminTestApp();
afterEach(() => jest.restoreAllMocks());

/** Endpoints a signed-out visitor must never get anything from. */
const PROTECTED_GETS = [
    "/overview", "/overview/charts", "/admins", "/admins/sessions", "/users", "/users/tags", "/users/1", "/vaults", "/vaults/1", "/vaults/1/content", "/plans",
    "/deletions", "/security/summary", "/security/events", "/security/blocked-ips", "/logs/activity", "/logs/server", "/logs/mail", "/logs/audit", "/system",
    "/system/details", "/settings", "/announcements", "/broadcast/audiences", "/inactivity", "/terms/summary", "/terms/export.csv", "/compliance",
    "/compliance/export.csv", "/compliance/register", "/compliance/incidents", "/compliance/access", "/data-requests", "/data-requests/export/1/abc",
    "/webhooks", "/jobs", "/jobs/anomalies/history", "/retention", "/map/logins", "/notifications", "/admin-signins", "/admin-signins/attempts",
];
const PROTECTED_WRITES: [string, string][] = [
    ["post", "/users/1/email"], ["post", "/users/1/merge"], ["post", "/users/bulk"], ["delete", "/users/1"], ["post", "/vaults/1/clear"], ["post", "/vaults/1/transfer"],
    ["post", "/jobs/retention/run"], ["put", "/settings"], ["post", "/webhooks"], ["post", "/data-requests"], ["post", "/admins"], ["post", "/security/blocked-ips"],
    ["put", "/announcements/maintenance"], ["post", "/broadcast"], ["post", "/compliance/incidents"],
];

describe("admin API: nothing without a session", () => {
    it.each(PROTECTED_GETS)("GET %s answers 401 to a visitor who isn't signed in", async (path) => {
        const res = await request(apps.admin()).get(`/api/admin${path}`);
        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toMatch(/@|password|secret/i);
    });

    it.each(PROTECTED_WRITES)("%s %s answers 401 to a visitor who isn't signed in", async (method, path) => {
        const res = await (request(apps.admin()) as any)[method](`/api/admin${path}`).send({});
        expect(res.status).toBe(401);
    });

    it("refuses a made-up or tampered session cookie", async () => {
        const forged = await request(apps.admin()).get("/api/admin/overview").set("Cookie", "admin_token=not.a.jwt");
        expect(forged.status).toBe(401);
        const admin = await createLoggedInAdmin(apps.admin());
        const real = (await admin.agent.get("/api/admin/overview")).status;
        expect(real).toBe(200);
        // A token signed by the *users'* JWT secret (not the admin key) is useless on the portal.
        const jwt = require("jsonwebtoken");
        const userToken = jwt.sign({admin_id: 1, token_version: 0, sid: "x"}, appService.getJwtSecret(), {expiresIn: 600});
        expect((await request(apps.admin()).get("/api/admin/overview").set("Cookie", `admin_token=${userToken}`)).status).toBe(401);
        const none = jwt.sign({admin_id: 1}, "", {algorithm: "none"});
        expect((await request(apps.admin()).get("/api/admin/overview").set("Cookie", `admin_token=${none}`)).status).toBe(401);
    });
});

describe("admin API: transport and browser protections", () => {
    it("tells browsers and proxies never to keep an answer, and sets the hardening headers", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const res = await admin.agent.get("/api/admin/users");
        expect(res.headers["cache-control"]).toMatch(/no-store/);
        expect(res.headers["pragma"]).toBe("no-cache");
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers["x-frame-options"]).toBeDefined();
        expect(res.headers["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
        expect(res.headers["content-security-policy"]).toMatch(/script-src 'self'/);
        expect(res.headers["permissions-policy"]).toMatch(/camera=\(\)/);
        expect(res.headers["x-powered-by"]).toBeUndefined();
        const failed = await request(apps.admin()).get("/api/admin/users");
        expect(failed.headers["cache-control"]).toMatch(/no-store/);
    });

    it("refuses a change that comes from another site, and one that isn't JSON (CSRF)", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const foreign = await admin.agent.post("/api/admin/jobs/anomalies/run").set("Origin", "https://evil.example").send({});
        expect(foreign.status).toBe(403);
        expect(foreign.body.message).toMatch(/Cross-origin/);
        const form = await admin.agent.post("/api/admin/jobs/anomalies/run").type("form").send("a=b");
        expect(form.status).toBe(415);
        const text = await admin.agent.post("/api/admin/jobs/anomalies/run").set("Content-Type", "text/plain").send("{}");
        expect(text.status).toBe(415);
        expect((await admin.agent.post("/api/admin/jobs/anomalies/run").send({})).status).toBe(200);
    });

    it("marks the sign-in cookies Secure whenever the console is on HTTPS, and HttpOnly and SameSite=Strict always", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const login = (ip: string) => request(apps.admin()).post("/api/admin/auth/login").set("X-Forwarded-For", ip).send({email: admin.email, password: admin.password});
        const plain = ((await login("198.51.100.77")).headers["set-cookie"] as unknown as string[]).join(";");
        expect(plain).toMatch(/HttpOnly/);
        expect(plain).toMatch(/SameSite=Strict/);
        expect(plain).not.toMatch(/Secure/);
        const before = process.env.ADMIN_URL;
        process.env.ADMIN_URL = "https://adm.example.com";
        try {
            const secure = ((await login("198.51.100.78")).headers["set-cookie"] as unknown as string[]).join(";");
            expect(secure).toMatch(/Secure/);
            expect(secure).toMatch(/HttpOnly/);
        } finally {
            if (before === undefined) delete process.env.ADMIN_URL; else process.env.ADMIN_URL = before;
        }
    });
});

describe("admin API: privileges", () => {
    it("keeps the raw server log, and every change, away from a read-only admin", async () => {
        const reader = await createLoggedInAdmin(apps.admin(), "readonly");
        const boss = await createLoggedInAdmin(apps.admin());
        expect((await reader.agent.get("/api/admin/logs/server")).status).toBe(403);
        expect((await boss.agent.get("/api/admin/logs/server")).status).toBe(200);
        for (const [method, path, body] of [
            ["put", "/settings", {changes: {REGISTRATION_ENABLED: "false"}}], ["post", "/users/1/approve", {}], ["post", "/vaults/1/suspend", {}], ["post", "/webhooks", {}],
            ["post", "/data-requests", {}], ["put", "/plans/default", {}], ["post", "/security/blocked-ips", {ip: "198.51.100.9"}], ["post", "/admins", {}], ["post", "/jobs/anomalies/run", {}],
        ] as const) {
            const res = await (reader.agent as any)[method](`/api/admin${path}`).send(body);
            expect([403]).toContain(res.status);
        }
    });

    it("asks for a fresh password and code before the mail server or a secret is changed (a stolen session could read reset codes)", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        for (const key of ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD", "OIDC_ISSUER", "GOOGLE_BOOKS_API_KEY"]) {
            const res = await admin.agent.put("/api/admin/settings").send({changes: {[key]: "x"}});
            expect([403, 400]).toContain(res.status);
            if (res.status === 403) expect(res.body.reauthRequired).toBe(true);
            expect(res.status).toBe(403);
        }
        // A harmless setting doesn't.
        expect((await admin.agent.put("/api/admin/settings").send({changes: {REGISTRATION_ENABLED: "true"}})).status).toBe(200);
        await admin.agent.put("/api/admin/settings").send({changes: {REGISTRATION_ENABLED: null}});
    });
});

describe("admin API: injection", () => {
    it("treats search text, filters and ids as data, never as SQL", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const evil = "' OR 1=1; DROP TABLE users; --";
        for (const path of [
            `/users?search=${encodeURIComponent(evil)}`, `/users?tag=${encodeURIComponent(evil)}`, `/vaults?search=${encodeURIComponent(evil)}`,
            `/logs/activity?ip=${encodeURIComponent(evil)}`, `/logs/mail?q=${encodeURIComponent(evil)}`, `/logs/audit?action=${encodeURIComponent(evil)}`,
            `/security/events?ip=${encodeURIComponent(evil)}`, `/terms/list?search=${encodeURIComponent(evil)}`, `/users/${encodeURIComponent("1; DROP TABLE users")}`,
            `/overview/charts?days=${encodeURIComponent("7; DROP TABLE users")}`, `/map/logins?days=${encodeURIComponent("30 OR 1=1")}`,
        ]) {
            const res = await admin.agent.get(`/api/admin${path}`);
            expect(res.status).toBeLessThan(500);
        }
        expect((await appService.getDatabasePool().query("SELECT COUNT(*)::int AS n FROM users")).rows[0].n).toBeGreaterThanOrEqual(0);
        const tag = await admin.agent.put("/api/admin/users/1/tags").send({tags: [evil]});
        expect(tag.status).toBeLessThan(500);
    });
});

describe("webhooks: server-side request forgery", () => {
    it("checks the address again at the moment of connecting (DNS rebinding), and lets a public host through", async () => {
        const before = process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE;
        process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE = "false";
        try {
            const blocked = await new Promise<Error | null>((resolve) => guardedLookup("localhost", {}, (err) => resolve(err)));
            expect(blocked?.message).toMatch(/private or local/);
            const blockedAll = await new Promise<Error | null>((resolve) => guardedLookup("localhost", {all: true}, (err) => resolve(err)));
            expect(blockedAll?.message).toMatch(/private or local/);
            process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE = "true";
            const allowed = await new Promise<{err: Error | null; address?: any}>((resolve) => guardedLookup("localhost", {}, (err, address) => resolve({err, address})));
            expect(allowed.err).toBeNull();
            expect(String(allowed.address)).toMatch(/127\.0\.0\.1|::1/);
        } finally {
            if (before === undefined) delete process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE; else process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE = before;
        }
    });

    it("never lets a webhook call the cloud metadata address or the loopback", async () => {
        const before = [process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE, process.env.ALLOW_HTTP];
        delete process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE;
        process.env.ALLOW_HTTP = "true";
        const admin = await createLoggedInAdmin(apps.admin());
        try {
            for (const url of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:3000/api/rest/app/version", "http://[::1]/", "http://localhost/", "http://10.0.0.5/x", "http://0.0.0.0/"]) {
                await admin.reauth();
                const made = await admin.agent.post("/api/admin/webhooks").send({name: "ssrf", kind: "generic", url, events: ["system.alert"]});
                expect(made.status).toBe(201);
                const test = await admin.agent.post(`/api/admin/webhooks/${made.body.item.id}/test`).send({});
                expect(test.body.ok).toBe(false);
                expect(test.body.error).toMatch(/private or local/);
            }
        } finally {
            if (before[0] === undefined) delete process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE; else process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE = before[0];
            if (before[1] === undefined) delete process.env.ALLOW_HTTP; else process.env.ALLOW_HTTP = before[1];
        }
    });
});

describe("admin sign-in", () => {
    it("answers the same to an unknown email and a wrong password, and locks an admin after repeated failures", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const unknown = await request(apps.admin()).post("/api/admin/auth/login").set("X-Forwarded-For", "198.51.100.51").send({email: "ghost@example.com", password: "Wrong-Passw0rd!x"});
        const wrong = await request(apps.admin()).post("/api/admin/auth/login").set("X-Forwarded-For", "198.51.100.52").send({email: admin.email, password: "Wrong-Passw0rd!x"});
        expect(unknown.status).toBe(401);
        expect(wrong.status).toBe(401);
        expect(unknown.body.message).toBe(wrong.body.message);
        for (let i = 0; i < 5; i++) {
            await request(apps.admin()).post("/api/admin/auth/login").set("X-Forwarded-For", `198.51.100.${60 + i}`).send({email: admin.email, password: "Wrong-Passw0rd!x"});
        }
        // Locked: even the right password is refused, with the same message.
        const locked = await request(apps.admin()).post("/api/admin/auth/login").set("X-Forwarded-For", "198.51.100.70").send({email: admin.email, password: admin.password});
        expect(locked.status).toBe(401);
        expect(locked.body.message).toBe(wrong.body.message);
        await appService.getDatabasePool().query("UPDATE admin_users SET failed_login_count = 0, lockout_until = NULL WHERE email = $1", [admin.email]);
    });
});
