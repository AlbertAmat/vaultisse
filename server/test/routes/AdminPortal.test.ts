import "../helpers/adminEnv";
import request from "supertest";
import {generate} from "otplib";
import {appService} from "../../src/AppService";
import {ADMIN_PASSWORD, createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";
import {createAuthenticatedUser, nextFakeIp, TEST_PASSWORD} from "../helpers/auth";

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();

let isbnCounter = 0;
/** A book creation request for a user agent; every book gets its own made-up ISBN (it is unique per vault). */
const addBook = (user: Awaited<ReturnType<typeof createAuthenticatedUser>>, name: string) =>
    user.agent.post("/api/rest/book").field("name", name).field("description", "d").field("isbn", `99${Date.now()}${++isbnCounter}`);

describe("admin portal: authentication", () => {
    it("runs on its own port, separate from the API", () => {
        expect(appService.getAdminServer()).not.toBeNull();
        const adminPort = (appService.getAdminServer()!.address() as {port: number}).port;
        const apiPort = (appService.getServer()!.address() as {port: number}).port;
        expect(adminPort).not.toBe(apiPort);
    });

    it("rejects API calls without a session", async () => {
        const res = await request(apps.admin()).get("/api/admin/overview");
        expect(res.status).toBe(401);
        expect(res.body.sessionExpired).toBe(true);
    });

    it("does not accept a regular user's session as an admin session", async () => {
        const user = await createAuthenticatedUser(apps.main());
        const res = await request(apps.admin()).get("/api/admin/overview").set("Cookie", `admin_token=${(await user.agent.get("/api/rest/app/version")).request.cookies ?? "x"}`);
        expect(res.status).toBe(401);
    });

    it("gives the same answer for an unknown email and a wrong password", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const wrong = await request(apps.admin()).post("/api/admin/auth/login").set("X-Forwarded-For", nextFakeIp()).send({email: admin.email, password: "Wrong-Passw0rd!x"});
        const unknown = await request(apps.admin()).post("/api/admin/auth/login").set("X-Forwarded-For", nextFakeIp()).send({email: "nobody@example.com", password: "Wrong-Passw0rd!x"});
        expect(wrong.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(wrong.body).toEqual(unknown.body);
    });

    it("forces two-factor enrolment before the first session and logs in with a backup code afterwards", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const me = await admin.agent.get("/api/admin/auth/me");
        expect(me.status).toBe(200);
        expect(me.body.email).toBe(admin.email);
        expect(admin.backupCodes).toHaveLength(10);

        const fresh = request.agent(apps.admin());
        const login = await fresh.post("/api/admin/auth/login").set("X-Forwarded-For", nextFakeIp()).send({email: admin.email, password: admin.password});
        expect(login.body.next).toBe("totp");
        // Not logged in until the second step is done.
        expect((await fresh.get("/api/admin/overview")).status).toBe(401);
        const second = await fresh.post("/api/admin/auth/2fa").set("X-Forwarded-For", nextFakeIp()).send({backupCode: admin.backupCodes.shift()});
        expect({status: second.status, body: second.body}).toEqual({status: 200, body: expect.anything()});
        expect((await fresh.get("/api/admin/overview")).status).toBe(200);

        // A backup code works once.
        const again = request.agent(apps.admin());
        await again.post("/api/admin/auth/login").set("X-Forwarded-For", nextFakeIp()).send({email: admin.email, password: admin.password});
        const reuse = await again.post("/api/admin/auth/2fa").set("X-Forwarded-For", nextFakeIp()).send({backupCode: "AAAAAAAA-BBBBBBBB"});
        expect(reuse.status).toBe(401);
    });

    it("refuses cross-origin state-changing requests and non-JSON bodies", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const evil = await admin.agent.post("/api/admin/auth/logout").set("Origin", "http://evil.example").send({});
        expect(evil.status).toBe(403);
        const form = await admin.agent.post("/api/admin/auth/logout").type("form").send("a=b");
        expect(form.status).toBe(415);
    });

    it("ends the session on logout", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await admin.agent.post("/api/admin/auth/logout").send({})).status).toBe(200);
        expect((await admin.agent.get("/api/admin/auth/me")).status).toBe(401);
    });

    it("needs a fresh password+code check for dangerous actions", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        const list = await admin.agent.get("/api/admin/users").query({search: user.userCode});
        const id = list.body.items[0].id;

        const blocked = await admin.agent.delete(`/api/admin/users/${id}`).send({confirm: user.userCode});
        expect(blocked.status).toBe(403);
        expect(blocked.body.reauthRequired).toBe(true);

        await admin.reauth();
        const wrongConfirm = await admin.agent.delete(`/api/admin/users/${id}`).send({confirm: "not-the-name"});
        expect(wrongConfirm.status).toBe(400);
    });

    it("lets a read-only admin look but not change anything", async () => {
        const readonly = await createLoggedInAdmin(apps.admin(), "readonly");
        expect((await readonly.agent.get("/api/admin/overview")).status).toBe(200);
        expect((await readonly.agent.get("/api/admin/settings")).status).toBe(200);
        const change = await readonly.agent.put("/api/admin/settings").send({changes: {REGISTRATION_ENABLED: "false"}});
        expect(change.status).toBe(403);
    });
});

describe("admin portal: settings without env vars", () => {
    it("never sends secrets back and stores them encrypted", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.reauth();
        const res = await admin.agent.put("/api/admin/settings").send({changes: {GOOGLE_BOOKS_API_KEY: "super-secret-key"}});
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain("super-secret-key");

        const item = res.body.groups.flatMap((g: any) => g.items).find((i: any) => i.key === "GOOGLE_BOOKS_API_KEY");
        expect(item).toMatchObject({isSet: true, value: null, source: "database"});

        const stored = await pool().query("SELECT value, is_secret FROM app_settings WHERE key = 'GOOGLE_BOOKS_API_KEY'");
        expect(stored.rows[0].is_secret).toBe(true);
        expect(stored.rows[0].value.startsWith("enc:v1:")).toBe(true);
        expect(stored.rows[0].value).not.toContain("super-secret-key");
        expect(appService.getGoogleApiKey()).toBe("super-secret-key");

        // null goes back to the env var / default.
        await admin.agent.put("/api/admin/settings").send({changes: {GOOGLE_BOOKS_API_KEY: null}});
        expect(appService.getGoogleApiKey()).toBeUndefined();
        expect((await pool().query("SELECT 1 FROM app_settings WHERE key = 'GOOGLE_BOOKS_API_KEY'")).rowCount).toBe(0);
    });

    it("refuses a half-configured mail setup and applies a complete one at once", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect(appService.getMailService().isEnabled()).toBe(false);

        const half = await admin.agent.put("/api/admin/settings").send({changes: {SMTP_HOST: "smtp.example.invalid"}});
        expect(half.status).toBe(400);
        expect(appService.getMailService().isEnabled()).toBe(false);

        const full = await admin.agent.put("/api/admin/settings").send({changes: {SMTP_HOST: "smtp.example.invalid", SMTP_FROM: "Vaultisse <a@example.com>"}});
        expect(full.status).toBe(200);
        expect(appService.getMailService().isEnabled()).toBe(true);

        await admin.agent.put("/api/admin/settings").send({changes: {SMTP_HOST: null, SMTP_FROM: null}});
        expect(appService.getMailService().isEnabled()).toBe(false);
    });

    it("rejects unknown keys and malformed values", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await admin.agent.put("/api/admin/settings").send({changes: {JWT_SECRET: "x"}})).status).toBe(400);
        expect((await admin.agent.put("/api/admin/settings").send({changes: {MAX_EBOOK_FILE_SIZE_MB: "lots"}})).status).toBe(400);
        expect((await admin.agent.put("/api/admin/settings").send({changes: {}})).status).toBe(400);
    });

    it("applies a changed upload limit without a restart", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.agent.put("/api/admin/settings").send({changes: {MAX_EBOOK_FILE_SIZE_MB: "3"}});
        expect(appService.getMaxEbookFileSizeMb()).toBe(3);
        await admin.agent.put("/api/admin/settings").send({changes: {MAX_EBOOK_FILE_SIZE_MB: null}});
        expect(appService.getMaxEbookFileSizeMb()).toBe(10);
    });

    it("turns registration approval on from the portal and approves the account from the portal", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.agent.put("/api/admin/settings").send({changes: {REGISTRATION_REQUIRES_APPROVAL: "true"}});

        const code = `pending_${Date.now()}`;
        const ip = nextFakeIp();
        const register = await request(apps.main()).post("/register").set("X-Forwarded-For", ip).send({userName: code, email: `${code}@example.com`, name: "Pending", password: TEST_PASSWORD});
        expect(register.status).toBeLessThan(300);

        const login = await request(apps.main()).post("/login").set("X-Forwarded-For", nextFakeIp()).send({username: code, password: TEST_PASSWORD});
        expect(login.status).toBe(401);

        const pending = await admin.agent.get("/api/admin/users").query({status: "pending", search: code});
        expect(pending.body.items).toHaveLength(1);
        expect(pending.body.items[0].disabledReason).toBe("pending_approval");
        const approve = await admin.agent.post(`/api/admin/users/${pending.body.items[0].id}/approve`).send({});
        expect(approve.status).toBe(200);

        const after = await request(apps.main()).post("/login").set("X-Forwarded-For", nextFakeIp()).send({username: code, password: TEST_PASSWORD});
        expect(after.status).toBe(200);

        await admin.agent.put("/api/admin/settings").send({changes: {REGISTRATION_REQUIRES_APPROVAL: null}});
        expect(appService.requiresRegistrationApproval()).toBe(false);
    });
});

describe("admin portal: accounts, vaults and dangerous actions", () => {
    it("disables an account, ending its session, and enables it again", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        expect((await user.agent.get("/api/rest/app/policy")).status).toBe(200);

        const id = (await admin.agent.get("/api/admin/users").query({search: user.userCode})).body.items[0].id;
        expect((await admin.agent.post(`/api/admin/users/${id}/disable`).send({})).status).toBe(200);
        expect((await user.agent.get("/api/rest/app/policy")).status).toBe(401);

        expect((await admin.agent.post(`/api/admin/users/${id}/enable`).send({})).status).toBe(200);
        const login = await request(apps.main()).post("/login").set("X-Forwarded-For", nextFakeIp()).send({username: user.userCode, password: user.password});
        expect(login.status).toBe(200);
    });

    it("force-logs-out an account", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        const id = (await admin.agent.get("/api/admin/users").query({search: user.userCode})).body.items[0].id;
        expect((await admin.agent.post(`/api/admin/users/${id}/force-logout`).send({})).status).toBe(200);
        expect((await user.agent.get("/api/rest/app/policy")).status).toBe(401);
    });

    it("schedules a deletion with a grace period, locks the account meanwhile, and can cancel it", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        const id = (await admin.agent.get("/api/admin/users").query({search: user.userCode})).body.items[0].id;

        await admin.reauth();
        const del = await admin.agent.delete(`/api/admin/users/${id}`).send({confirm: user.userCode});
        expect(del.status).toBe(200);
        expect(del.body.executed).toBe(false);
        expect((await user.agent.get("/api/rest/app/policy")).status).toBe(401);

        const detail = await admin.agent.get(`/api/admin/users/${id}`);
        expect(detail.body.user.disabledReason).toBe("pending_deletion");
        expect(detail.body.user.deletionScheduledFor).not.toBeNull();

        const deletions = await admin.agent.get("/api/admin/deletions");
        const mine = deletions.body.items.find((d: any) => d.entityId === id);
        expect(mine.entityType).toBe("user");

        // Can't be re-enabled behind the deletion's back, and can't be scheduled twice.
        expect((await admin.agent.post(`/api/admin/users/${id}/enable`).send({})).status).toBe(409);
        expect((await admin.agent.delete(`/api/admin/users/${id}`).send({confirm: user.userCode})).status).toBe(409);

        expect((await admin.agent.post(`/api/admin/deletions/${mine.id}/cancel`).send({})).status).toBe(200);
        const login = await request(apps.main()).post("/login").set("X-Forwarded-For", nextFakeIp()).send({username: user.userCode, password: user.password});
        expect(login.status).toBe(200);
    });

    it("deletes an account immediately, with its personal vault, when asked to", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        await addBook(user, "Doomed book");
        const id = (await admin.agent.get("/api/admin/users").query({search: user.userCode})).body.items[0].id;
        const vaultsBefore = (await admin.agent.get(`/api/admin/users/${id}`)).body.memberships;
        expect(vaultsBefore).toHaveLength(1);

        await admin.reauth();
        const del = await admin.agent.delete(`/api/admin/users/${id}`).send({confirm: user.userCode, immediate: true});
        expect(del.status).toBe(200);
        expect(del.body.executed).toBe(true);

        expect((await pool().query("SELECT 1 FROM users WHERE id = $1", [id])).rowCount).toBe(0);
        expect((await pool().query("SELECT 1 FROM vault WHERE id = $1", [vaultsBefore[0].vaultId])).rowCount).toBe(0);
    });

    it("executes deletions whose grace period is over, on the maintenance pass", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        const id = (await admin.agent.get("/api/admin/users").query({search: user.userCode})).body.items[0].id;
        await admin.reauth();
        const del = await admin.agent.delete(`/api/admin/users/${id}`).send({confirm: user.userCode});
        await pool().query("UPDATE scheduled_deletions SET execute_after = NOW() - INTERVAL '1 minute' WHERE id = $1", [del.body.deletionId]);

        await (appService as any).m_adminApp.maintain();
        expect((await pool().query("SELECT 1 FROM users WHERE id = $1", [id])).rowCount).toBe(0);
        const audit = await admin.agent.get("/api/admin/logs/audit").query({action: "deletion.executed"});
        expect(audit.body.items.some((entry: any) => entry.entityId === id)).toBe(true);
    });

    it("suspends a vault so its members can no longer open it, and restores it", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        const id = (await admin.agent.get("/api/admin/users").query({search: user.userCode})).body.items[0].id;
        const vaultId = (await admin.agent.get(`/api/admin/users/${id}`)).body.memberships[0].vaultId;

        const before = await user.agent.get("/api/rest/app/policy");
        expect(before.body.vaultPermissions.canEditCatalog).toBe(true);

        expect((await admin.agent.post(`/api/admin/vaults/${vaultId}/suspend`).send({})).status).toBe(200);
        const during = await user.agent.get("/api/rest/app/policy");
        expect(during.body.vaultPermissions.canEditCatalog).toBe(false);
        expect((await addBook(user, "Into a suspended vault")).status).toBe(403);

        expect((await admin.agent.post(`/api/admin/vaults/${vaultId}/unsuspend`).send({})).status).toBe(200);
        expect((await user.agent.get("/api/rest/app/policy")).body.vaultPermissions.canEditCatalog).toBe(true);
    });

    it("shows vault metadata and members but never the vault's content", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        await addBook(user, "A private title nobody else should see");
        const id = (await admin.agent.get("/api/admin/users").query({search: user.userCode})).body.items[0].id;
        const vaultId = (await admin.agent.get(`/api/admin/users/${id}`)).body.memberships[0].vaultId;

        const detail = await admin.agent.get(`/api/admin/vaults/${vaultId}`);
        expect(detail.status).toBe(200);
        expect(detail.body.vault.bookCount).toBe(1);
        expect(detail.body.members[0].code).toBe(user.userCode);
        expect(JSON.stringify(detail.body)).not.toContain("private title");
    });
});

describe("admin portal: plans and quotas", () => {
    it("limits a vault's books by its plan and lifts the limit when the plan is removed", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        const id = (await admin.agent.get("/api/admin/users").query({search: user.userCode})).body.items[0].id;
        const vaultId = (await admin.agent.get(`/api/admin/users/${id}`)).body.memberships[0].vaultId;

        const code = `tiny_${Date.now()}`;
        const plan = await admin.agent.post("/api/admin/plans").send({code, name: "Tiny", maxBooks: 1});
        expect(plan.status).toBe(201);
        expect((await admin.agent.put(`/api/admin/vaults/${vaultId}/plan`).send({planId: plan.body.plan.id})).status).toBe(200);

        expect((await addBook(user, "First")).status).toBeLessThan(300);
        const second = await addBook(user, "Second");
        expect(second.status).toBe(403);
        expect(JSON.stringify(second.body) + second.text).toContain("allows at most 1 books");

        await admin.agent.delete(`/api/admin/plans/${plan.body.plan.id}`);
        expect((await addBook(user, "Second")).status).toBeLessThan(300);
    });

    it("uses the default plan for vaults without one", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const plan = await admin.agent.post("/api/admin/plans").send({code: `def_${Date.now()}`, name: "Default tiny", maxBooks: 0});
        await admin.agent.put("/api/admin/plans/default").send({planId: plan.body.plan.id});
        try {
            const user = await createAuthenticatedUser(apps.main());
            expect((await addBook(user, "Nope")).status).toBe(403);
        } finally {
            await admin.agent.put("/api/admin/plans/default").send({planId: null});
            await admin.agent.delete(`/api/admin/plans/${plan.body.plan.id}`);
        }
    });

    it("validates plan limits", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await admin.agent.post("/api/admin/plans").send({code: "bad code!", name: "X"})).status).toBe(400);
        expect((await admin.agent.post("/api/admin/plans").send({code: `ok_${Date.now()}`, name: "X", maxBooks: -3})).status).toBe(400);
        expect((await admin.agent.post("/api/admin/plans").send({code: `ok2_${Date.now()}`, name: "X", maxMembers: 0})).status).toBe(400);
    });
});

describe("admin portal: security", () => {
    it("blocks an address everywhere and counts the blocked requests", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const ip = "203.0.113.77";
        expect((await admin.agent.post("/api/admin/security/blocked-ips").send({ip, reason: "test", hours: 1})).status).toBe(201);

        const blocked = await request(apps.main()).get("/api/rest/app/version").set("X-Forwarded-For", ip);
        expect(blocked.status).toBe(403);
        const other = await request(apps.main()).get("/api/rest/app/version").set("X-Forwarded-For", "203.0.113.78");
        expect(other.status).not.toBe(403);

        const events = await admin.agent.get("/api/admin/security/events").query({type: "blocked_ip_hit", ip});
        expect(events.body.items.length).toBeGreaterThan(0);

        expect((await admin.agent.delete(`/api/admin/security/blocked-ips/${ip}`)).status).toBe(200);
        expect((await request(apps.main()).get("/api/rest/app/version").set("X-Forwarded-For", ip)).status).not.toBe(403);
    });

    it("refuses to block the admin's own address and invalid addresses", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await admin.agent.post("/api/admin/security/blocked-ips").send({ip: "not-an-ip"})).status).toBe(400);
        const own = await admin.agent.post("/api/admin/security/blocked-ips").set("X-Forwarded-For", "198.51.100.9").send({ip: "198.51.100.9"});
        expect(own.status).toBe(409);
    });

    it("records rate-limit hits and failed logins as security events", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const ip = "198.51.100.44";
        for (let i = 0; i < 7; i++) {
            await request(apps.main()).post("/login").set("X-Forwarded-For", ip).send({username: "nobody", password: "x"});
        }
        const events = await admin.agent.get("/api/admin/security/events").query({ip});
        const types = events.body.items.map((e: any) => e.type);
        expect(types).toContain("login_failed");
        expect(types).toContain("rate_limited");

        const summary = await admin.agent.get("/api/admin/security/summary");
        expect(summary.body.events24h.length).toBeGreaterThan(0);
        const traffic = await admin.agent.get("/api/admin/security/traffic");
        expect(traffic.body.series).toHaveLength(60);
    });

    it("lists locked accounts and clears the lockout", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        for (let i = 0; i < 6; i++) {
            await request(apps.main()).post("/login").set("X-Forwarded-For", nextFakeIp()).send({username: user.userCode, password: "Wrong-Pass1!"});
        }
        const locked = await admin.agent.get("/api/admin/security/lockouts");
        const entry = locked.body.items.find((l: any) => l.code === user.userCode);
        expect(entry).toBeTruthy();
        expect((await admin.agent.post(`/api/admin/security/lockouts/${entry.userId}/clear`).send({})).status).toBe(200);
        const ok = await request(apps.main()).post("/login").set("X-Forwarded-For", nextFakeIp()).send({username: user.userCode, password: user.password});
        expect(ok.status).toBe(200);
    });
});

describe("admin portal: audit trail and logs", () => {
    it("records what admins do, and the database refuses to alter it", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.agent.put("/api/admin/settings").send({changes: {MAX_IMPORT_FILE_SIZE_MB: "12"}});
        await admin.agent.put("/api/admin/settings").send({changes: {MAX_IMPORT_FILE_SIZE_MB: null}});

        const audit = await admin.agent.get("/api/admin/logs/audit").query({action: "settings.update", adminId: 0 + Number((await admin.agent.get("/api/admin/auth/me")).body.id)});
        expect(audit.body.items.length).toBeGreaterThanOrEqual(2);
        expect(audit.body.items[0].adminEmail).toBe(admin.email);
        expect(audit.body.items[0].metadata.keys).toEqual(["MAX_IMPORT_FILE_SIZE_MB"]);

        await expect(pool().query("UPDATE admin_audit_log SET action = 'x'")).rejects.toThrow(/append-only/);
        await expect(pool().query("DELETE FROM admin_audit_log")).rejects.toThrow(/append-only/);
        await expect(pool().query("TRUNCATE admin_audit_log")).rejects.toThrow(/append-only/);
    });

    it("audits failed admin logins without a session", async () => {
        const probe = `probe_${Date.now()}@example.com`;
        await request(apps.admin()).post("/api/admin/auth/login").set("X-Forwarded-For", nextFakeIp()).send({email: probe, password: "nope"});
        const row = await pool().query("SELECT admin_email FROM admin_audit_log WHERE action = 'auth.login_failed' AND admin_email = $1", [probe]);
        expect(row.rowCount).toBe(1);
    });

    it("serves the sign-in activity and the server log", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await createAuthenticatedUser(apps.main());
        const activity = await admin.agent.get("/api/admin/logs/activity").query({action: "login"});
        expect(activity.status).toBe(200);
        expect(activity.body.items.length).toBeGreaterThan(0);
        const log = await admin.agent.get("/api/admin/logs/server").query({lines: 50});
        expect(log.status).toBe(200);
        expect(Array.isArray(log.body.lines)).toBe(true);
    });

    it("reports overview numbers and system information", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const overview = await admin.agent.get("/api/admin/overview");
        expect(overview.status).toBe(200);
        expect(overview.body.counts.users).toBeGreaterThan(0);
        expect(overview.body.signups).toHaveLength(30);
        expect(overview.body.logins).toHaveLength(14);
        const system = await admin.agent.get("/api/admin/system");
        expect(system.body.database).toBe("ok");
        expect(system.body.bootstrap.adminPort).toBeDefined();
    });
});

describe("admin portal: managing admins", () => {
    it("creates, restricts and removes admins, and never leaves the installation without a superadmin", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.reauth();
        const email = `second_${Date.now()}@example.com`;
        const created = await admin.agent.post("/api/admin/admins").send({email, name: "Second", password: ADMIN_PASSWORD, role: "readonly"});
        expect(created.status).toBe(201);
        expect((await admin.agent.post("/api/admin/admins").send({email: `w_${Date.now()}@example.com`, name: "Weak", password: "short", role: "readonly"})).status).toBe(400);

        const id = created.body.admin.id;
        expect((await admin.agent.patch(`/api/admin/admins/${id}`).send({role: "superadmin"})).status).toBe(200);
        expect((await admin.agent.patch(`/api/admin/admins/${id}`).send({disabled: true})).status).toBe(200);
        expect((await admin.agent.delete(`/api/admin/admins/${id}`)).status).toBe(200);

        const me = (await admin.agent.get("/api/admin/auth/me")).body.id;
        expect((await admin.agent.delete(`/api/admin/admins/${me}`)).status).toBe(403);
    });

    it("resets an admin's two-factor from the command-line path", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const {AdminAuthService} = await import("../../src/admin/services/AdminAuthService");
        const auth = new AdminAuthService(pool(), appService.getLogger(), appService.getJwtSecret());
        await auth.createOrReset({email: admin.email, name: "x", password: "Another-Passw0rd!y"});

        // The old session is gone and the next login has to enrol again.
        expect((await admin.agent.get("/api/admin/auth/me")).status).toBe(401);
        const login = await request(apps.admin()).post("/api/admin/auth/login").set("X-Forwarded-For", nextFakeIp()).send({email: admin.email, password: "Another-Passw0rd!y"});
        expect(login.body.next).toBe("enroll");
    });

    it("changes the own password and ends the other sessions", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const otherSession = request.agent(apps.admin());
        await otherSession.post("/api/admin/auth/login").set("X-Forwarded-For", nextFakeIp()).send({email: admin.email, password: admin.password});
        await otherSession.post("/api/admin/auth/2fa").set("X-Forwarded-For", nextFakeIp()).send({backupCode: admin.backupCodes.shift()});
        expect((await otherSession.get("/api/admin/auth/me")).status).toBe(200);

        const changed = await admin.agent.post("/api/admin/auth/password").set("X-Forwarded-For", nextFakeIp()).send({currentPassword: admin.password, newPassword: "Brand-New-Passw0rd!z"});
        expect(changed.status).toBe(200);
        expect((await admin.agent.get("/api/admin/auth/me")).status).toBe(200);
        expect((await otherSession.get("/api/admin/auth/me")).status).toBe(401);
        expect((await admin.agent.post("/api/admin/auth/password").set("X-Forwarded-For", nextFakeIp()).send({currentPassword: admin.password, newPassword: "Brand-New-Passw0rd!z"})).status).toBe(401);
    });
});

// Keep the import used in environments where a second-factor code is generated directly.
void generate;
