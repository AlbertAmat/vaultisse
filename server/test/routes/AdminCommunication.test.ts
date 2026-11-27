import "../helpers/adminEnv";
import request from "supertest";
import {appService} from "../../src/AppService";
import {MailService} from "../../src/services/MailService";
import {createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";
import {createAuthenticatedUser, nextFakeIp, TEST_PASSWORD} from "../helpers/auth";

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();

type Admin = Awaited<ReturnType<typeof createLoggedInAdmin>>;
const setSettings = (admin: Admin, changes: Record<string, string | null>) => admin.agent.put("/api/admin/settings").send({changes});
// Changing the mail server needs a fresh password + code, like a secret.
const mailOn = async (admin: Admin) => { await admin.reauth(); return setSettings(admin, {SMTP_HOST: "smtp.example.invalid", SMTP_FROM: "Vaultisse <a@example.com>"}); };
const mailOff = async (admin: Admin) => { await admin.reauth(); return setSettings(admin, {SMTP_HOST: null, SMTP_FROM: null}); };
const userId = async (admin: Admin, code: string) => (await admin.agent.get("/api/admin/users").query({search: code})).body.items[0].id as number;
const waitFor = async <T>(read: () => Promise<T | undefined>, tries = 100): Promise<T> => {
    for (let i = 0; i < tries; i++) {
        const value = await read();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("timed out");
};
const addBook = (user: Awaited<ReturnType<typeof createAuthenticatedUser>>) =>
    user.agent.post("/api/rest/book").field("name", "B").field("description", "d").field("isbn", `97${Date.now()}`.slice(0, 13));

afterEach(() => jest.restoreAllMocks());

describe("announcements", () => {
    const notice = async () => (await request(apps.main()).get("/api/rest/app/notice")).body;

    it("are shown to everyone, most severe first, only between their start and end", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const hour = 60 * 60 * 1000;
        const info = await admin.agent.post("/api/admin/announcements").send({message: "Info message", level: "info"});
        const critical = await admin.agent.post("/api/admin/announcements").send({message: "Critical message", level: "critical"});
        const later = await admin.agent.post("/api/admin/announcements").send({message: "Scheduled message", level: "warning", startsAt: new Date(Date.now() + hour).toISOString()});
        const past = await admin.agent.post("/api/admin/announcements").send({message: "Expired message", level: "warning", startsAt: new Date(Date.now() - 2 * hour).toISOString(), endsAt: new Date(Date.now() - hour).toISOString()});
        expect([info, critical, later, past].map((r) => r.status)).toEqual([201, 201, 201, 201]);
        try {
            const shown = (await notice()).announcements.map((a: any) => a.message);
            expect(shown).toContain("Critical message");
            expect(shown.indexOf("Critical message")).toBeLessThan(shown.indexOf("Info message"));
            expect(shown).not.toContain("Scheduled message");
            expect(shown).not.toContain("Expired message");

            const list = (await admin.agent.get("/api/admin/announcements")).body.items;
            const stateOf = (message: string) => list.find((a: any) => a.message === message).state;
            expect([stateOf("Info message"), stateOf("Scheduled message"), stateOf("Expired message")]).toEqual(["active", "scheduled", "expired"]);

            // Switching one off, and editing one, take effect at once.
            const id = info.body.announcement.id;
            await admin.agent.put(`/api/admin/announcements/${id}`).send({message: "Info message", level: "info", enabled: false});
            expect((await notice()).announcements.map((a: any) => a.message)).not.toContain("Info message");
            await admin.agent.put(`/api/admin/announcements/${id}`).send({message: "Changed text", level: "warning", enabled: true});
            expect((await notice()).announcements.find((a: any) => a.message === "Changed text").level).toBe("warning");
        } finally {
            for (const r of [info, critical, later, past]) {
                await admin.agent.delete(`/api/admin/announcements/${r.body.announcement.id}`);
            }
        }
        expect((await notice()).announcements.map((a: any) => a.message)).not.toContain("Critical message");
    });

    it("validates what is written and is for superadmins only", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const post = (body: object) => admin.agent.post("/api/admin/announcements").send(body);
        expect((await post({message: "  ", level: "info"})).status).toBe(400);
        expect((await post({message: "x".repeat(501)})).status).toBe(400);
        expect((await post({message: "ok", level: "loud"})).status).toBe(400);
        expect((await post({message: "ok", startsAt: "not a date"})).status).toBe(400);
        expect((await post({message: "ok", startsAt: "2030-01-02T10:00:00Z", endsAt: "2030-01-02T09:00:00Z"})).status).toBe(400);
        const readonly = await createLoggedInAdmin(apps.admin(), "readonly");
        expect((await readonly.agent.get("/api/admin/announcements")).status).toBe(200);
        expect((await readonly.agent.post("/api/admin/announcements").send({message: "ok"})).status).toBe(403);
    });
});

describe("maintenance mode", () => {
    it("makes the whole app read-only, still lets people read and sign in, and ends when switched off", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        expect((await addBook(user)).status).toBeLessThan(300);

        // Turning it on needs a fresh verification, as it affects every user.
        const blocked = await admin.agent.put("/api/admin/announcements/maintenance").send({enabled: true, message: "Back at 23:00"});
        expect(blocked.status).toBe(403);
        expect(blocked.body.reauthRequired).toBe(true);
        await admin.reauth();
        expect((await admin.agent.put("/api/admin/announcements/maintenance").send({enabled: true, message: "Back at 23:00"})).status).toBe(200);
        try {
            const notice = (await request(apps.main()).get("/api/rest/app/notice")).body;
            expect(notice.maintenance).toEqual({message: "Back at 23:00"});

            // Changes are refused with the message...
            const write = await addBook(user);
            expect(write.status).toBe(503);
            expect(write.body).toEqual({message: "Back at 23:00", maintenance: true});
            const register = await request(apps.main()).post("/register").set("X-Forwarded-For", nextFakeIp()).send({userName: `m_${Date.now()}`, email: `m_${Date.now()}@example.com`, name: "M", password: TEST_PASSWORD});
            expect(register.status).toBe(503);
            // ...while reading and signing in keep working.
            expect((await user.agent.get("/api/rest/app/policy")).status).toBe(200);
            expect((await request(apps.main()).post("/login").set("X-Forwarded-For", nextFakeIp()).send({username: user.userCode, password: user.password})).status).toBe(200);
            // The admin console is not affected.
            expect((await admin.agent.get("/api/admin/overview")).status).toBe(200);
        } finally {
            await admin.agent.put("/api/admin/announcements/maintenance").send({enabled: false});
        }
        expect((await request(apps.main()).get("/api/rest/app/notice")).body.maintenance).toBeNull();
        expect((await addBook(user)).status).toBeLessThan(300);

        const audit = (await admin.agent.get("/api/admin/logs/audit").query({action: "maintenance."})).body.items.map((e: any) => e.action);
        expect(audit).toEqual(expect.arrayContaining(["maintenance.on", "maintenance.off"]));
    });

    it("uses a default message and survives a configuration reset", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.reauth();
        await admin.agent.put("/api/admin/announcements/maintenance").send({enabled: true});
        try {
            expect((await request(apps.main()).get("/api/rest/app/notice")).body.maintenance.message).toMatch(/maintenance mode/);
            await appService.getSettings().resetAll();
            expect(appService.getNotices().maintenance().enabled).toBe(true);
        } finally {
            await admin.agent.put("/api/admin/announcements/maintenance").send({enabled: false});
        }
    });
});

describe("broadcast email", () => {
    const broadcastService = () => (appService as any).m_adminApp.broadcasts;
    let sent: {to: string; subject: string; text: string}[];
    beforeEach(() => {
        sent = [];
        jest.spyOn(MailService.prototype, "send").mockImplementation(async (to: string, subject: string, text: string) => { sent.push({to, subject, text}); return true; });
        jest.spyOn(MailService.prototype, "sendReportingError").mockImplementation(async (to: string, subject: string, text: string) => { sent.push({to, subject, text}); return null; });
        broadcastService().paceMs = 0;
    });

    it("previews the exact audience and the email as it will read, without sending anything", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main(), "Preview Person");
        const disabled = await createAuthenticatedUser(apps.main(), "Disabled Person");
        await admin.agent.post(`/api/admin/users/${await userId(admin, disabled.userCode)}/disable`).send({});
        await mailOn(admin);
        try {
            const audiences = (await admin.agent.get("/api/admin/broadcast/audiences")).body;
            expect(audiences.mailEnabled).toBe(true);
            const all = audiences.items.find((a: any) => a.value === "all");
            const preview = (await admin.agent.post("/api/admin/broadcast/preview").send({audience: "all", subject: "Hello {name}", body: "Dear {name}, the library is closed on Saturday."})).body;
            expect(preview.count).toBe(all.count);
            const enabledWithVerifiedMail = (await pool().query("SELECT COUNT(*)::int AS n FROM users WHERE disabled = FALSE AND email_verified = TRUE")).rows[0].n;
            expect(preview.count).toBe(enabledWithVerifiedMail);
            expect(preview.sample.length).toBeLessThanOrEqual(5);
            preview.sample.forEach((address: string) => expect(address).toMatch(/^.\*+@/));
            expect(preview.email.subject).toBe("Hello Test Admin");
            expect(preview.email.text).toContain("Dear Test Admin, the library is closed on Saturday.");
            expect(preview.email.text).toContain("service message");
            expect(sent).toHaveLength(0);

            // Disabled accounts are never addressed.
            const recipients = (await broadcastService().recipients("all")).map((r: any) => r.email);
            expect(recipients).toContain(user.email);
            expect(recipients).not.toContain(disabled.email);
            expect((await admin.agent.post("/api/admin/broadcast/preview").send({audience: "nobody", subject: "s", body: "b"})).status).toBe(400);
            expect((await admin.agent.post("/api/admin/broadcast/preview").send({audience: "all", subject: " ", body: "b"})).status).toBe(400);
        } finally {
            await mailOff(admin);
        }
    });

    it("narrows the audience by vault admin, activity and two-factor", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const fresh = await createAuthenticatedUser(apps.main());
        const ids = async (audience: string) => (await broadcastService().recipients(audience)).map((r: any) => r.email);
        expect(await ids("vault_admins")).toContain(fresh.email); // everyone owns their personal vault
        expect(await ids("active_30")).toContain(fresh.email);
        expect(await ids("no_two_factor")).toContain(fresh.email);
        await pool().query("UPDATE users SET totp_enabled = TRUE WHERE code = $1", [fresh.userCode]);
        expect(await ids("no_two_factor")).not.toContain(fresh.email);
        await pool().query("UPDATE users SET last_login_date = NOW() - INTERVAL '90 days', last_activity_date = NULL WHERE code = $1", [fresh.userCode]);
        await pool().query("UPDATE user_sessions SET last_seen_date = NOW() - INTERVAL '90 days' WHERE user_id = (SELECT id FROM users WHERE code = $1)", [fresh.userCode]);
        expect(await ids("active_30")).not.toContain(fresh.email);
        void admin;
    });

    it("needs email, a fresh verification and the count that was previewed, then sends one personal email each", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main(), "Greta Gardener");
        const body = {audience: "all", subject: "News for {name}", body: "Hello {name}!"};
        // No email set up.
        await admin.reauth();
        expect((await admin.agent.post("/api/admin/broadcast").send({...body, expectedCount: 1})).status).toBe(400);
        await mailOn(admin);
        try {
            const count = (await admin.agent.post("/api/admin/broadcast/preview").send(body)).body.count;
            // A stale count is refused: the admin must have seen the real number.
            const stale = await admin.agent.post("/api/admin/broadcast").send({...body, expectedCount: count + 1});
            expect(stale.status).toBe(409);
            expect((await admin.agent.post("/api/admin/broadcast").send({...body})).status).toBe(400);

            const started = await admin.agent.post("/api/admin/broadcast").send({...body, expectedCount: count});
            expect(started.status).toBe(202);
            const id = started.body.broadcast.id;
            const done = await waitFor(async () => {
                const b = (await admin.agent.get(`/api/admin/broadcast/${id}`)).body.broadcast;
                return b.status === "done" ? b : undefined;
            });
            expect(done).toMatchObject({recipients: count, sent: count, failed: 0});
            expect(sent).toHaveLength(count);
            const mine = sent.find((m) => m.to === user.email)!;
            expect(mine.subject).toBe("News for Greta Gardener");
            expect(mine.text).toContain("Hello Greta Gardener!");

            const history = (await admin.agent.get("/api/admin/broadcast")).body.items;
            expect(history[0]).toMatchObject({id, status: "done", createdBy: admin.email});
            const audit = (await admin.agent.get("/api/admin/logs/audit").query({action: "broadcast.send"})).body.items[0];
            expect(audit.metadata.recipients).toBe(count);
        } finally {
            await mailOff(admin);
        }
    });

    it("counts failed deliveries, can be cancelled, and one at a time", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await createAuthenticatedUser(apps.main());
        await createAuthenticatedUser(apps.main());
        await mailOn(admin);
        await admin.reauth();
        try {
            // Failures are counted, not fatal.
            let calls = 0;
            jest.spyOn(MailService.prototype, "send").mockImplementation(async () => (++calls % 2 === 0 ? false : true));
            const body = {audience: "all", subject: "s", body: "b"};
            const count = (await admin.agent.post("/api/admin/broadcast/preview").send(body)).body.count;
            const a = await admin.agent.post("/api/admin/broadcast").send({...body, expectedCount: count});
            const finished = await waitFor(async () => {
                const b = (await admin.agent.get(`/api/admin/broadcast/${a.body.broadcast.id}`)).body.broadcast;
                return b.status === "done" ? b : undefined;
            });
            expect(finished.failed).toBeGreaterThan(0);
            expect(finished.sent + finished.failed).toBe(count);

            // Slow sending: a second broadcast is refused, and the first can be cancelled part-way.
            broadcastService().paceMs = 60;
            const slow = await admin.agent.post("/api/admin/broadcast").send({...body, expectedCount: count});
            expect(slow.status).toBe(202);
            expect((await admin.agent.post("/api/admin/broadcast").send({...body, expectedCount: count})).status).toBe(409);
            expect((await admin.agent.post(`/api/admin/broadcast/${slow.body.broadcast.id}/cancel`).send({})).status).toBe(200);
            const cancelled = await waitFor(async () => {
                const b = (await admin.agent.get(`/api/admin/broadcast/${slow.body.broadcast.id}`)).body.broadcast;
                return b.status !== "sending" ? b : undefined;
            });
            expect(cancelled.status).toBe("cancelled");
            expect(cancelled.sent + cancelled.failed).toBeLessThan(count);
            expect((await admin.agent.post(`/api/admin/broadcast/${slow.body.broadcast.id}/cancel`).send({})).status).toBe(409);
        } finally {
            broadcastService().paceMs = 0;
            await mailOff(admin);
        }
    });

    it("sends a test only to the admin, marks a broadcast that was cut off by a restart, and is for superadmins", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await mailOn(admin);
        try {
            const test = await admin.agent.post("/api/admin/broadcast/test").send({subject: "Hi {name}", body: "Body"});
            expect(test.body).toMatchObject({ok: true, to: admin.email});
            expect(sent).toHaveLength(1);
            expect(sent[0]).toMatchObject({to: admin.email, subject: "[Test] Hi Test Admin"});

            const row = await pool().query("INSERT INTO broadcasts (subject, body, audience, recipients, status) VALUES ('Cut off', 'b', 'all', 10, 'sending') RETURNING id");
            await broadcastService().markInterrupted();
            expect((await admin.agent.get(`/api/admin/broadcast/${row.rows[0].id}`)).body.broadcast.status).toBe("interrupted");

            const readonly = await createLoggedInAdmin(apps.admin(), "readonly");
            expect((await readonly.agent.get("/api/admin/broadcast")).status).toBe(200);
            expect((await readonly.agent.post("/api/admin/broadcast/test").send({subject: "s", body: "b"})).status).toBe(403);
            expect((await readonly.agent.post("/api/admin/broadcast").send({audience: "all", subject: "s", body: "b", expectedCount: 1})).status).toBe(403);
        } finally {
            await mailOff(admin);
        }
    });
});
