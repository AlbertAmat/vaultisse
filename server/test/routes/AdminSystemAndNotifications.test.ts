import "../helpers/adminEnv";
import axios from "axios";
import request from "supertest";
import {appService} from "../../src/AppService";
import {MailService} from "../../src/services/MailService";
import {createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";
import {nextFakeIp, TEST_PASSWORD} from "../helpers/auth";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();
const notifier = () => appService.getNotifier();

let send: jest.SpyInstance;
beforeEach(() => {
    mockedAxios.get.mockReset();
    send = jest.spyOn(MailService.prototype, "sendReportingError").mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

type Admin = Awaited<ReturnType<typeof createLoggedInAdmin>>;
const setSettings = (admin: Admin, changes: Record<string, string | null>) => admin.agent.put("/api/admin/settings").send({changes});
// Changing the mail server needs a fresh password + code, like a secret.
const mailOn = async (admin: Admin) => { await admin.reauth(); return setSettings(admin, {SMTP_HOST: "smtp.example.invalid", SMTP_FROM: "Vaultisse <a@example.com>"}); };
const mailOff = async (admin: Admin) => { await admin.reauth(); return setSettings(admin, {SMTP_HOST: null, SMTP_FROM: null}); };
const history = async (admin: Admin) => (await admin.agent.get("/api/admin/notifications/history").query({pageSize: 100})).body.items as any[];
const waitFor = async <T>(read: () => Promise<T | undefined>): Promise<T> => {
    for (let i = 0; i < 40; i++) {
        const value = await read();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("timed out");
};

describe("System page", () => {
    it("reports the database's connection, status, size and tables, and the migrations that were run", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const res = await admin.agent.get("/api/admin/system/details");
        expect(res.status).toBe(200);
        const {database, migrations} = res.body;

        expect(database.status).toBe("ok");
        expect(database.connection).toMatchObject({name: process.env.DB_NAME, host: process.env.DB_HOST});
        expect(database.connection.port).toBe(Number(process.env.DB_PORT));
        expect(JSON.stringify(database)).not.toMatch(/password/i);
        expect(database.server.version).toMatch(/PostgreSQL/);
        expect(database.server.port).toBe(Number(process.env.DB_PORT));
        expect(database.sizeBytes).toBeGreaterThan(1_000_000);
        expect(database.connections.max).toBeGreaterThan(0);
        expect(database.largestTables.length).toBeGreaterThan(0);
        expect(database.largestTables[0].bytes).toBeGreaterThanOrEqual(database.largestTables[1].bytes);

        expect(migrations.total).toBeGreaterThan(5);
        const mine = migrations.items.find((m: any) => m.filename === "1.4.0.sql");
        expect(mine).toBeTruthy();
        expect(Date.now() - new Date(mine.appliedAt).getTime()).toBeLessThan(60 * 60 * 1000);
        expect(res.body.instanceUuid).toBe(appService.getInstanceUuid());
        expect(res.body.runtime.node).toBe(process.version);
    });

    it("warns when the database is over the size limit set for alerts", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await setSettings(admin, {ADMIN_NOTIFY_DB_SIZE_MB: "1"});
        try {
            const {database} = (await admin.agent.get("/api/admin/system/details")).body;
            expect(database.status).toBe("warning");
            expect(database.problems.join(" ")).toMatch(/larger than the 1 MB limit/);
        } finally {
            await setSettings(admin, {ADMIN_NOTIFY_DB_SIZE_MB: null});
        }
    });

    it("says whether a newer version exists, and only asks GitHub when allowed", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const check = () => admin.agent.post("/api/admin/system/check-updates").send({});
        process.env.APP_VERSION = "1.3.8";
        try {
            mockedAxios.get.mockResolvedValueOnce({status: 200, data: {tag_name: "v1.4.0", html_url: "https://example.test/r", published_at: "2026-11-01T00:00:00Z"}});
            const newer = (await check()).body;
            expect(newer).toMatchObject({installed: "1.3.8", latest: "1.4.0", updateAvailable: true, releaseUrl: "https://example.test/r", isDevBuild: false});
            expect(mockedAxios.get.mock.calls[0][0]).toContain("api.github.com/repos/");
            expect(JSON.stringify(mockedAxios.get.mock.calls[0])).not.toContain(appService.getInstanceUuid());

            mockedAxios.get.mockResolvedValueOnce({status: 200, data: {tag_name: "v1.3.8"}});
            expect((await check()).body.updateAvailable).toBe(false);

            mockedAxios.get.mockResolvedValueOnce({status: 404, data: {}});
            const none = (await check()).body;
            expect(none.updateAvailable).toBeNull();
            expect(none.error).toMatch(/No release/);

            mockedAxios.get.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));
            expect((await check()).body.error).toMatch(/Couldn't reach GitHub/);

            // Switched off: no request is made.
            await setSettings(admin, {ADMIN_UPDATE_CHECK: "false"});
            mockedAxios.get.mockClear();
            const off = (await check()).body;
            expect(off).toMatchObject({checkEnabled: false, updateAvailable: null});
            expect(mockedAxios.get).not.toHaveBeenCalled();
        } finally {
            delete process.env.APP_VERSION;
            await setSettings(admin, {ADMIN_UPDATE_CHECK: null});
        }
    });

    it("doesn't pretend to know about updates for a development build", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        mockedAxios.get.mockResolvedValueOnce({status: 200, data: {tag_name: "v9.9.9"}});
        const res = (await admin.agent.post("/api/admin/system/check-updates").send({})).body;
        expect(res).toMatchObject({installed: "dev", isDevBuild: true, updateAvailable: null});
    });
});

describe("admin notifications", () => {
    it("lists the admins and lets each one subscribe or unsubscribe", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const other = await createLoggedInAdmin(apps.admin(), "readonly");
        const overview = (await admin.agent.get("/api/admin/notifications")).body;
        const me = overview.recipients.find((r: any) => r.email === admin.email);
        expect(me.notifyEmail).toBe(true);
        expect(typeof overview.mailEnabled).toBe("boolean");

        expect((await admin.agent.put("/api/admin/notifications/me").send({notifyEmail: false})).status).toBe(200);
        expect((await admin.agent.get("/api/admin/notifications")).body.recipients.find((r: any) => r.email === admin.email).notifyEmail).toBe(false);
        expect((await admin.agent.put("/api/admin/notifications/me").send({notifyEmail: "yes"})).status).toBe(400);

        // A read-only admin manages themselves but not others.
        expect((await other.agent.put("/api/admin/notifications/me").send({notifyEmail: false})).status).toBe(200);
        const id = overview.recipients.find((r: any) => r.email === admin.email).id;
        expect((await other.agent.patch(`/api/admin/notifications/recipients/${id}`).send({notifyEmail: true})).status).toBe(403);
        expect((await admin.agent.patch(`/api/admin/notifications/recipients/${id}`).send({notifyEmail: true})).status).toBe(200);
    });

    it("emails the subscribed admins when a new account waits for approval, and records it", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await mailOn(admin);
        await setSettings(admin, {REGISTRATION_REQUIRES_APPROVAL: "true"});
        try {
            const code = `waiting_${Date.now()}`;
            const reg = await request(apps.main()).post("/register").set("X-Forwarded-For", nextFakeIp()).send({userName: code, email: `${code}@example.com`, name: "Waiting Person", password: TEST_PASSWORD});
            expect(reg.status).toBeLessThan(300);

            const entry = await waitFor(async () => (await history(admin)).find((h) => h.type === "user_pending" && h.status === "sent"));
            expect(entry.subject).toMatch(/waiting for approval/);
            expect(entry.recipients).toBeGreaterThan(0);
            const call = send.mock.calls.find((c) => c[0] === admin.email);
            expect(call).toBeTruthy();
            expect(call![2]).toContain(code);
            expect(call![2]).toContain(appService.getInstanceUuid());
        } finally {
            await setSettings(admin, {REGISTRATION_REQUIRES_APPROVAL: null});
            await mailOff(admin);
        }
    });

    it("respects the per-event switch, each admin's subscription and the cooldown", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await mailOn(admin);
        try {
            // Switched off: nothing happens at all.
            await setSettings(admin, {ADMIN_NOTIFY_UPDATES: "false"});
            expect(await notifier().notify("updates", {title: "x", lines: ["x"]})).toBe(false);
            expect(send).not.toHaveBeenCalled();
            await setSettings(admin, {ADMIN_NOTIFY_UPDATES: null});

            // Unsubscribed admins are left out.
            await admin.agent.put("/api/admin/notifications/me").send({notifyEmail: false});
            const key = `k${Date.now()}`;
            await notifier().notify("updates", {title: "Hello", lines: ["a"], dedupeKey: key, cooldownMs: 60_000});
            expect(send.mock.calls.map((c) => c[0])).not.toContain(admin.email);

            // The same alert isn't repeated within its cooldown, then is when there is none.
            send.mockClear();
            expect(await notifier().notify("updates", {title: "Hello", lines: ["a"], dedupeKey: key, cooldownMs: 60_000})).toBe(false);
            expect(send).not.toHaveBeenCalled();
            expect(await notifier().notify("updates", {title: "Hello", lines: ["a"], dedupeKey: key})).toBe(true);
        } finally {
            await mailOff(admin);
        }
    });

    it("records what it skipped because email isn't set up", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await mailOff(admin);
        const title = `No mail ${Date.now()}`;
        expect(await notifier().notify("updates", {title, lines: ["a"]})).toBe(false);
        const entry = (await history(admin)).find((h) => h.subject === `[Vaultisse] ${title}`);
        expect(entry).toMatchObject({status: "skipped", recipients: 0});
        expect(entry.detail).toMatch(/Email isn't configured/);
        expect(send).not.toHaveBeenCalled();
    });

    it("doesn't let a skipped alert block the first real one once email works", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const key = `skip${Date.now()}`;
        await mailOff(admin);
        expect(await notifier().notify("updates", {title: "First", lines: ["a"], dedupeKey: key, cooldownMs: 60 * 60 * 1000})).toBe(false);
        await mailOn(admin);
        try {
            expect(await notifier().notify("updates", {title: "Second", lines: ["a"], dedupeKey: key, cooldownMs: 60 * 60 * 1000})).toBe(true);
            expect(send).toHaveBeenCalled();
        } finally {
            await mailOff(admin);
        }
    });

    it("raises an alert when failed logins and rate limiting pass the threshold", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await mailOn(admin);
        try {
            await pool().query("INSERT INTO security_events (type, ip_address, bucket, count) VALUES ('login_failed', '203.0.113.9', date_trunc('minute', NOW()), 80)");
            await notifier().runChecks();
            const entry = (await history(admin)).find((h) => h.type === "security" && /Unusual security activity/.test(h.subject));
            expect(entry).toBeTruthy();
            const call = send.mock.calls.find((c) => /Unusual security/.test(c[1]));
            expect(call![2]).toContain("203.0.113.9");

            // Not again right away.
            send.mockClear();
            await notifier().runChecks();
            expect(send.mock.calls.filter((c) => /Unusual security/.test(c[1]))).toHaveLength(0);
        } finally {
            await pool().query("DELETE FROM security_events WHERE ip_address = '203.0.113.9'");
            await mailOff(admin);
        }
    });

    it("alerts about a database that can't be reached, with the last known recipients", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await mailOn(admin);
        try {
            await notifier().recipients();
            jest.spyOn(appService.getSystemInfo(), "database").mockResolvedValue({
                status: "down", problems: ["The database can't be reached: connection refused"], connection: {mode: "tcp", host: "db", port: 5432, name: "x", user: "u"},
                server: null, latencyMs: null, sizeBytes: null, connections: null, largestTables: [],
            });
            // Recipients can't be read from the database either: the cached list is used.
            jest.spyOn(pool(), "query").mockRejectedValueOnce(new Error("connection refused"));
            await notifier().runChecks();
            const call = send.mock.calls.find((c) => /database can't be reached/.test(c[1]));
            expect(call).toBeTruthy();
            expect(call![2]).toContain("connection refused");
        } finally {
            jest.restoreAllMocks();
            await mailOff(admin);
        }
    });

    it("alerts when many emails are refused", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await mailOn(admin);
        try {
            for (let i = 0; i < 6; i++) {
                await pool().query("INSERT INTO mail_log (to_address, subject, status, error) VALUES ('x@example.com', 'probe', 'failed', 'Invalid login: 535')");
            }
            await notifier().runChecks();
            const call = send.mock.calls.find((c) => /failing to send/.test(c[1]));
            expect(call).toBeTruthy();
            expect(call![2]).toContain("535");
        } finally {
            await pool().query("DELETE FROM mail_log WHERE subject = 'probe'");
            await mailOff(admin);
        }
    });

    it("announces a start with the migrations it applied", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await mailOn(admin);
        await setSettings(admin, {ADMIN_NOTIFY_STARTUP: "true"});
        try {
            await (notifier() as any).announceStartup(new Date(Date.now() - 60 * 60 * 1000));
            const call = send.mock.calls.find((c) => /server started/.test(c[1]));
            expect(call![2]).toContain("1.4.0.sql");
        } finally {
            await setSettings(admin, {ADMIN_NOTIFY_STARTUP: null});
            await mailOff(admin);
        }
    });

    it("sends a test notification to the admin who asks, and says when email isn't set up", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await admin.agent.post("/api/admin/notifications/test").send({})).status).toBe(400);
        await mailOn(admin);
        try {
            const res = await admin.agent.post("/api/admin/notifications/test").send({});
            expect(res.body).toMatchObject({ok: true, to: admin.email});
            expect(send).toHaveBeenCalledWith(admin.email, "[Vaultisse] Test notification", expect.any(String));
        } finally {
            await mailOff(admin);
        }
    });
});
