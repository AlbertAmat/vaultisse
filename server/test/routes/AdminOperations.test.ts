import "../helpers/adminEnv";
import request from "supertest";
import {appService} from "../../src/AppService";
import {classify} from "../../src/admin/routes/InactivityRoutes";
import {csvCell} from "../../src/admin/routes/TermsRoutes";
import {isPublicAddress} from "../../src/admin/services/AutoBlocker";
import {createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";
import {createAuthenticatedUser, nextFakeIp, TEST_PASSWORD} from "../helpers/auth";

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();

type Admin = Awaited<ReturnType<typeof createLoggedInAdmin>>;
const setSettings = (admin: Admin, changes: Record<string, string | null>) => admin.agent.put("/api/admin/settings").send({changes});
const userId = async (admin: Admin, code: string) => (await admin.agent.get("/api/admin/users").query({search: code})).body.items[0].id as number;
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(() => jest.restoreAllMocks());
const failLogin = (ip: string, username = "nobody") => request(apps.main()).post("/login").set("X-Forwarded-For", ip).send({username, password: "Wrong-Pass1!"});

describe("automatic IP blocking", () => {
    it("only ever considers public addresses", () => {
        for (const ip of ["198.51.100.7", "8.8.8.8", "2001:db8::1", "::ffff:203.0.113.5"]) expect(isPublicAddress(ip)).toBe(true);
        for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.20", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip", "224.0.0.1"]) expect(isPublicAddress(ip)).toBe(false);
        expect(isPublicAddress("172.32.0.1")).toBe(true);
    });

    it("blocks an address that keeps failing to sign in, records why, refuses it everywhere, and can be undone", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await setSettings(admin, {ADMIN_AUTOBLOCK_ENABLED: "true", ADMIN_AUTOBLOCK_THRESHOLD: "3", ADMIN_AUTOBLOCK_WINDOW_MIN: "10", ADMIN_AUTOBLOCK_HOURS: "1"});
        const ip = "198.51.100.77";
        try {
            for (let i = 0; i < 3; i++) await failLogin(ip);
            const entry = await (async () => {
                for (let i = 0; i < 40; i++) {
                    const found = (await admin.agent.get("/api/admin/security/blocked-ips")).body.items.find((b: any) => b.ipAddress === ip);
                    if (found) return found;
                    await settle(50);
                }
                throw new Error("not blocked");
            })();
            expect(entry).toMatchObject({automatic: true, blockedBy: null});
            expect(entry.reason).toMatch(/Automatic: 3 failed or refused logins in 10 minutes/);
            const hoursLeft = (new Date(entry.expiresAt).getTime() - Date.now()) / 3600000;
            expect(hoursLeft).toBeGreaterThan(0.9);
            expect(hoursLeft).toBeLessThanOrEqual(1.01);

            expect((await request(apps.main()).get("/api/rest/app/version").set("X-Forwarded-For", ip)).status).toBe(403);
            const audit = (await admin.agent.get("/api/admin/logs/audit").query({action: "security.auto_block"})).body.items.find((e: any) => e.entityLabel === ip);
            expect(audit).toMatchObject({adminEmail: null, ipAddress: ip});
            expect(audit.metadata).toMatchObject({failedLogins: 3, hours: 1});

            expect((await admin.agent.delete(`/api/admin/security/blocked-ips/${ip}`)).status).toBe(200);
            expect((await request(apps.main()).get("/api/rest/app/version").set("X-Forwarded-For", ip)).status).not.toBe(403);
        } finally {
            await setSettings(admin, {ADMIN_AUTOBLOCK_ENABLED: null, ADMIN_AUTOBLOCK_THRESHOLD: null, ADMIN_AUTOBLOCK_WINDOW_MIN: null, ADMIN_AUTOBLOCK_HOURS: null});
        }
    });

    it("also counts the attempts the login rate limiter refuses, so a hammering attacker reaches the threshold", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        // The login limiter allows 5 attempts per 5 minutes: with a threshold of 8, the 5 failures alone are not enough.
        await setSettings(admin, {ADMIN_AUTOBLOCK_ENABLED: "true", ADMIN_AUTOBLOCK_THRESHOLD: "8", ADMIN_AUTOBLOCK_WINDOW_MIN: "10", ADMIN_AUTOBLOCK_HOURS: "1"});
        const ip = "198.51.100.120";
        try {
            const statuses: number[] = [];
            for (let i = 0; i < 9; i++) statuses.push((await failLogin(ip)).status);
            expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
            expect(statuses.slice(5).some((s) => s === 429)).toBe(true);
            for (let i = 0; i < 40 && !appService.getBlockedIps().isBlocked(ip); i++) await settle(50);
            expect(appService.getBlockedIps().isBlocked(ip)).toBe(true);
            const reason = (await admin.agent.get("/api/admin/security/blocked-ips")).body.items.find((b: any) => b.ipAddress === ip).reason;
            expect(reason).toMatch(/Automatic: \d+ failed or refused logins/);
            await admin.agent.delete(`/api/admin/security/blocked-ips/${ip}`);
        } finally {
            await setSettings(admin, {ADMIN_AUTOBLOCK_ENABLED: null, ADMIN_AUTOBLOCK_THRESHOLD: null, ADMIN_AUTOBLOCK_WINDOW_MIN: null, ADMIN_AUTOBLOCK_HOURS: null});
        }
    });

    it("never blocks private addresses, addresses that signed in recently, or when it is switched off", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const blocker = appService.getAutoBlocker();
        const isBlocked = (ip: string) => appService.getBlockedIps().isBlocked(ip);
        await setSettings(admin, {ADMIN_AUTOBLOCK_ENABLED: "true", ADMIN_AUTOBLOCK_THRESHOLD: "3"});
        try {
            // A private address (think: everyone behind one proxy).
            expect(await blocker.decide("10.55.0.9", 50)).toBe(false);
            expect(isBlocked("10.55.0.9")).toBe(false);

            // A public address that a user signed in from a moment ago (a shared office address).
            const ip = "198.51.100.88";
            const code = `office_${Date.now()}`;
            await request(apps.main()).post("/register").set("X-Forwarded-For", ip).send({userName: code, email: `${code}@example.com`, name: "O", password: TEST_PASSWORD});
            expect((await request(apps.main()).post("/login").set("X-Forwarded-For", ip).send({username: code, password: TEST_PASSWORD})).status).toBe(200);
            for (let i = 0; i < 4; i++) await failLogin(ip);
            await settle(400);
            expect(isBlocked(ip)).toBe(false);
            expect(await blocker.decide(ip, 9)).toBe(false);

            // Switched off: nothing is counted at all.
            await setSettings(admin, {ADMIN_AUTOBLOCK_ENABLED: "false"});
            for (let i = 0; i < 4; i++) await failLogin("198.51.100.99");
            await settle(400);
            expect(isBlocked("198.51.100.99")).toBe(false);
        } finally {
            await setSettings(admin, {ADMIN_AUTOBLOCK_ENABLED: null, ADMIN_AUTOBLOCK_THRESHOLD: null});
        }
    });

    it("validates its settings", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await setSettings(admin, {ADMIN_AUTOBLOCK_THRESHOLD: "1"})).status).toBe(400);
        expect((await setSettings(admin, {ADMIN_AUTOBLOCK_HOURS: "0"})).status).toBe(400);
        const keys = (await admin.agent.get("/api/admin/settings")).body.groups.find((g: any) => g.id === "security").items.map((i: any) => i.key);
        expect(keys).toEqual(["ADMIN_AUTOBLOCK_ENABLED", "ADMIN_AUTOBLOCK_THRESHOLD", "ADMIN_AUTOBLOCK_WINDOW_MIN", "ADMIN_AUTOBLOCK_HOURS"]);
    });
});

describe("inactive accounts preview", () => {
    const DAY = 24 * 60 * 60 * 1000;
    /** Makes an account look like it was last used `days` ago. */
    const age = async (code: string, days: number, warnedDaysAgo?: number) => {
        await pool().query(
            `UPDATE users SET created_date = NOW() - make_interval(days => $2), last_login_date = NOW() - make_interval(days => $2), last_activity_date = NULL,
                    deletion_warned_at = CASE WHEN $3::int IS NULL THEN NULL ELSE NOW() - make_interval(days => $3) END WHERE code = $1`,
            [code, days, warnedDaysAgo ?? null]
        );
        await pool().query("UPDATE user_sessions SET last_seen_date = NOW() - make_interval(days => $2) WHERE user_id = (SELECT id FROM users WHERE code = $1)", [code, days]);
    };

    it("works out where each account stands with the same rules as the real job", () => {
        const now = Date.now();
        const row = (daysAgo: number, warnedDaysAgo?: number) => ({id: 1, code: "x", name: "x", email: "x", lastActivity: new Date(now - daysAgo * DAY), warnedAt: warnedDaysAgo === undefined ? null : new Date(now - warnedDaysAgo * DAY)});
        expect(classify(row(40), 30, 7, now).status).toBe("to_warn");
        expect(classify(row(40, 2), 30, 7, now).status).toBe("warned");
        expect(classify(row(40, 10), 30, 7, now).status).toBe("due");
        expect(classify(row(10), 30, 7, now).status).toBe("upcoming");
        expect(classify(row(10), 30, 7, now).warnOn!.getTime()).toBeCloseTo(now + 13 * DAY, -4);
        expect(classify(row(40), 30, 0, now)).toMatchObject({status: "due", warnOn: null});
        expect(classify(row(20), 30, 0, now).deleteOn.getTime()).toBeCloseTo(now + 10 * DAY, -4);
    });

    it("lists who is warned, who is about to be, and who is next, and can keep an account", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const users: Record<string, Awaited<ReturnType<typeof createAuthenticatedUser>>> = {};
        for (const key of ["toWarn", "warned", "due", "soon", "far", "disabled"]) users[key] = await createAuthenticatedUser(apps.main(), key);
        await age(users.toWarn.userCode, 40);
        await age(users.warned.userCode, 40, 2);
        await age(users.due.userCode, 40, 10);
        await age(users.soon.userCode, 25);
        await age(users.far.userCode, 2);
        await age(users.disabled.userCode, 40);
        await pool().query("UPDATE users SET disabled = TRUE WHERE code = $1", [users.disabled.userCode]);
        await setSettings(admin, {SMTP_HOST: "smtp.example.invalid", SMTP_FROM: "a@example.com"});
        await setSettings(admin, {ACCOUNT_INACTIVITY_DAYS: "30", ACCOUNT_DELETION_NOTICE_DAYS: "7"});
        try {
            const res = (await admin.agent.get("/api/admin/inactivity").query({horizon: 14})).body;
            expect(res).toMatchObject({enabled: true, inactivityDays: 30, noticeDays: 7, simulated: false});
            const byCode = (code: string) => res.items.find((i: any) => i.code === code);
            expect(byCode(users.toWarn.userCode).status).toBe("to_warn");
            expect(byCode(users.warned.userCode).status).toBe("warned");
            expect(byCode(users.due.userCode).status).toBe("due");
            expect(byCode(users.soon.userCode).status).toBe("to_warn");
            expect(byCode(users.far.userCode)).toBeUndefined();
            expect(byCode(users.disabled.userCode)).toBeUndefined();
            expect(res.counts.due).toBeGreaterThanOrEqual(1);
            // The soonest deletion comes first.
            const dates = res.items.map((i: any) => new Date(i.deleteOn).getTime());
            expect(dates).toEqual([...dates].sort((a, b) => a - b));

            // "What if I set it to 5 days?": nothing is changed, but the 2-day-old account now shows up.
            const what = (await admin.agent.get("/api/admin/inactivity").query({days: 5, horizon: 14})).body;
            expect(what).toMatchObject({simulated: true, inactivityDays: 5, configuredDays: 30});
            expect(what.items.find((i: any) => i.code === users.far.userCode).status).toBe("upcoming");
            expect(what.items.find((i: any) => i.code === users.soon.userCode).status).toBe("due");
            expect((await admin.agent.get("/api/admin/inactivity").query({days: 0})).status).toBe(400);

            // Keeping an account restarts its clock and cancels its warning.
            const id = await userId(admin, users.warned.userCode);
            expect((await admin.agent.post(`/api/admin/inactivity/${id}/keep`).send({})).status).toBe(200);
            const after = (await admin.agent.get("/api/admin/inactivity").query({horizon: 14})).body;
            expect(after.items.find((i: any) => i.code === users.warned.userCode)).toBeUndefined();
            expect((await pool().query("SELECT deletion_warned_at FROM users WHERE id = $1", [id])).rows[0].deletion_warned_at).toBeNull();
            const readonly = await createLoggedInAdmin(apps.admin(), "readonly");
            expect((await readonly.agent.get("/api/admin/inactivity")).status).toBe(200);
            expect((await readonly.agent.post(`/api/admin/inactivity/${id}/keep`).send({})).status).toBe(403);
        } finally {
            await setSettings(admin, {ACCOUNT_INACTIVITY_DAYS: null, ACCOUNT_DELETION_NOTICE_DAYS: null, SMTP_HOST: null, SMTP_FROM: null});
        }
        const off = (await admin.agent.get("/api/admin/inactivity")).body;
        expect(off).toMatchObject({enabled: false, items: []});
    });
});

describe("bulk actions on accounts", () => {
    const post = (admin: Admin, body: object) => admin.agent.post("/api/admin/users/bulk").send(body);

    it("approves everyone who is waiting, in one go, and carries on past one that can't be", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await setSettings(admin, {REGISTRATION_REQUIRES_APPROVAL: "true"});
        const codes: string[] = [];
        try {
            for (let i = 0; i < 3; i++) {
                const code = `wait${i}_${Date.now()}`;
                codes.push(code);
                await request(apps.main()).post("/register").set("X-Forwarded-For", nextFakeIp()).send({userName: code, email: `${code}@example.com`, name: code, password: TEST_PASSWORD});
            }
        } finally {
            await setSettings(admin, {REGISTRATION_REQUIRES_APPROVAL: null});
        }
        const ids = await Promise.all(codes.map((code) => userId(admin, code)));
        const res = await post(admin, {action: "approve", status: "pending"});
        expect(res.status).toBe(200);
        expect(res.body.failed).toBe(0);
        for (const id of ids) expect(res.body.results.find((r: any) => r.id === id).ok).toBe(true);
        const login = await request(apps.main()).post("/login").set("X-Forwarded-For", nextFakeIp()).send({username: codes[0], password: TEST_PASSWORD});
        expect(login.status).toBe(200);

        // Approving again: each is reported as not waiting, nothing throws.
        const again = await post(admin, {action: "approve", ids});
        expect(again.body).toMatchObject({ok: 0, failed: 3});
        expect(again.body.results[0].message).toMatch(/isn't waiting for approval/);
        expect((await admin.agent.get("/api/admin/logs/audit").query({action: "user.approve", entityType: "user"})).body.items.length).toBeGreaterThanOrEqual(3);
    });

    it("disables, enables and signs out a selection, reporting what couldn't be done", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const a = await createAuthenticatedUser(apps.main());
        const b = await createAuthenticatedUser(apps.main());
        const ids = [await userId(admin, a.userCode), await userId(admin, b.userCode)];

        const disabled = await post(admin, {action: "disable", ids: [...ids, 999999999], reason: "spam"});
        expect(disabled.body).toMatchObject({ok: 2, failed: 1});
        expect(disabled.body.results.find((r: any) => r.id === 999999999)).toMatchObject({ok: false, message: "Account not found."});
        expect((await a.agent.get("/api/rest/app/policy")).status).toBe(401);
        expect((await b.agent.get("/api/rest/app/policy")).status).toBe(401);

        expect((await post(admin, {action: "enable", ids})).body.ok).toBe(2);
        const login = await request(apps.main()).post("/login").set("X-Forwarded-For", nextFakeIp()).send({username: a.userCode, password: a.password});
        expect(login.status).toBe(200);

        const out = await post(admin, {action: "force-logout", ids});
        expect(out.body.ok).toBe(2);
        // One audit entry per account, plus the summary.
        const disableEntries = (await admin.agent.get("/api/admin/logs/audit").query({action: "user.disable"})).body.items.filter((e: any) => ids.includes(e.entityId));
        expect(disableEntries).toHaveLength(2);
        expect(disableEntries[0].metadata.reason).toBe("spam");
        const summary = (await admin.agent.get("/api/admin/logs/audit").query({action: "user.bulk"})).body.items[0];
        expect(summary.metadata).toMatchObject({action: "force-logout", requested: 2, ok: 2});
    });

    it("schedules deletions only after a fresh verification and the typed word, with the usual grace period", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const a = await createAuthenticatedUser(apps.main());
        const ids = [await userId(admin, a.userCode)];
        const unverified = await post(admin, {action: "delete", ids, confirm: "DELETE"});
        expect(unverified.status).toBe(403);
        expect(unverified.body.reauthRequired).toBe(true);
        await admin.reauth();
        expect((await post(admin, {action: "delete", ids})).status).toBe(400);
        expect((await post(admin, {action: "delete", ids, confirm: "delete"})).status).toBe(400);
        const done = await post(admin, {action: "delete", ids, confirm: "DELETE"});
        expect(done.body).toMatchObject({ok: 1, failed: 0});
        const detail = (await admin.agent.get(`/api/admin/users/${ids[0]}`)).body.user;
        expect(detail.disabledReason).toBe("pending_deletion");
        expect(detail.deletionScheduledFor).not.toBeNull();
        expect((await pool().query("SELECT 1 FROM users WHERE id = $1", [ids[0]])).rowCount).toBe(1);
        // Already scheduled: reported, not repeated.
        expect((await post(admin, {action: "delete", ids, confirm: "DELETE"})).body.failed).toBe(1);
    });

    it("rejects bad requests and is for superadmins only", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await post(admin, {action: "explode", ids: [1]})).status).toBe(400);
        expect((await post(admin, {action: "disable"})).status).toBe(400);
        expect((await post(admin, {action: "disable", ids: []})).status).toBe(400);
        expect((await post(admin, {action: "disable", ids: Array.from({length: 501}, (_, i) => i + 1)})).status).toBe(400);
        const readonly = await createLoggedInAdmin(apps.admin(), "readonly");
        expect((await post(readonly, {action: "disable", ids: [1]})).status).toBe(403);
    });
});

describe("terms acceptance report", () => {
    it("counts who accepted, who was asked, and who wasn't, and lists them", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const accepted = await createAuthenticatedUser(apps.main(), "Accepted Person");
        const asked = await createAuthenticatedUser(apps.main(), "Asked Person");
        const never = await createAuthenticatedUser(apps.main(), "Never Asked");
        const id = async (u: typeof accepted) => userId(admin, u.userCode);
        await pool().query("DELETE FROM user_terms_of_service_acknowledgements WHERE user_id = ANY($1)", [[await id(accepted), await id(asked), await id(never)]]);
        await pool().query("INSERT INTO user_terms_of_service_acknowledgements (user_id, accepted_date) VALUES ($1, NOW())", [await id(accepted)]);
        await pool().query("INSERT INTO user_terms_of_service_acknowledgements (user_id) VALUES ($1)", [await id(asked)]);

        const summary = (await admin.agent.get("/api/admin/terms/summary")).body;
        for (const doc of ["tos", "security"]) {
            expect(summary[doc].accepted + summary[doc].pending + summary[doc].never).toBe(summary[doc].total);
        }
        expect(summary.tos.accepted).toBeGreaterThanOrEqual(1);
        expect(summary.tos.pending).toBeGreaterThanOrEqual(1);
        expect(summary.tos.never).toBeGreaterThanOrEqual(1);

        const list = async (status: string) => (await admin.agent.get("/api/admin/terms/list").query({doc: "tos", status, search: "Person", pageSize: 100})).body.items.map((i: any) => i.code);
        expect(await list("accepted")).toContain(accepted.userCode);
        expect(await list("accepted")).not.toContain(asked.userCode);
        expect(await list("pending")).toContain(asked.userCode);
        expect((await admin.agent.get("/api/admin/terms/list").query({doc: "tos", status: "never", search: never.userCode})).body.items[0]).toMatchObject({status: "never", acceptedDate: null});
        const row = (await admin.agent.get("/api/admin/terms/list").query({doc: "tos", search: accepted.userCode})).body.items[0];
        expect(row).toMatchObject({status: "accepted"});
        expect(row.acceptedDate).toBeTruthy();
        expect((await admin.agent.get("/api/admin/terms/list").query({doc: "other"})).status).toBe(400);
        expect((await admin.agent.get("/api/admin/terms/list").query({status: "maybe"})).status).toBe(400);
    });

    it("exports a CSV that is safe to open in a spreadsheet", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const evil = await createAuthenticatedUser(apps.main(), "=HYPERLINK(\"http://evil.example\")");
        const res = await admin.agent.get("/api/admin/terms/export.csv").query({doc: "tos", search: evil.userCode});
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.headers["content-disposition"]).toContain("terms-of-service-acceptance.csv");
        const lines = res.text.replace(/^﻿/, "").trim().split("\r\n");
        expect(lines[0]).toBe("username,name,email,account_disabled,status,asked,accepted");
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
        expect(lines[1]).not.toMatch(/(^|,)=/);

        expect(csvCell("+1")).toBe("'+1");
        expect(csvCell("-1")).toBe("'-1");
        expect(csvCell("@x")).toBe("'@x");
        expect(csvCell("a,b")).toBe('"a,b"');
        expect(csvCell('say "hi"')).toBe('"say ""hi"""');
        expect(csvCell(null)).toBe("");
        expect((await admin.agent.get("/api/admin/terms/export.csv").query({doc: "security"})).headers["content-disposition"]).toContain("security-notice");
    });
});
