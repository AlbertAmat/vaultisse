import "../helpers/adminEnv";
import {appService} from "../../src/AppService";
import {ADMIN_PASSWORD, createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();
type Admin = Awaited<ReturnType<typeof createLoggedInAdmin>>;
afterEach(() => jest.restoreAllMocks());

const ageOf = (admin: Admin, days: number) => pool().query("UPDATE admin_users SET password_changed_at = NOW() - make_interval(days => $2), password_warned_on = NULL WHERE email = $1", [admin.email, days]);
const me = async (admin: Admin) => (await admin.agent.get("/api/admin/auth/me")).body;
const setSettings = (admin: Admin, changes: Record<string, string | null>) => admin.agent.put("/api/admin/settings").send({changes});

describe("password lifetime", () => {
    it("starts at 60 days with a reminder window of 5, and shows when the password expires", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const fresh = await me(admin);
        expect(fresh).toMatchObject({passwordExpired: false, passwordExpiryWarning: false, mustChangePassword: false});
        expect(fresh.passwordDaysLeft).toBe(60);
        expect(new Date(fresh.passwordExpiresAt).getTime()).toBeGreaterThan(Date.now() + 59 * 86400000);
        const row = (await admin.agent.get("/api/admin/admins")).body.items.find((a: any) => a.email === admin.email);
        expect(row).toMatchObject({passwordDaysLeft: 60, passwordExpired: false});
    });

    it("warns inside the last 5 days but lets the admin keep working", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await ageOf(admin, 56);
        const warned = await me(admin);
        expect(warned).toMatchObject({passwordDaysLeft: 4, passwordExpiryWarning: true, passwordExpired: false, mustChangePassword: false});
        expect((await admin.agent.get("/api/admin/overview")).status).toBe(200);
        await ageOf(admin, 54);
        expect((await me(admin)).passwordExpiryWarning).toBe(false);
    });

    it("blocks everything but changing the password once it has expired, and unblocks after the change", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await ageOf(admin, 61);
        const expired = await me(admin);
        expect(expired).toMatchObject({passwordExpired: true, mustChangePassword: true, passwordExpiryWarning: true});
        expect(expired.passwordDaysLeft).toBeLessThanOrEqual(-1);
        const blocked = await admin.agent.get("/api/admin/overview");
        expect(blocked.status).toBe(403);
        expect(blocked.body.passwordChangeRequired).toBe(true);
        expect((await admin.agent.get("/api/admin/users")).status).toBe(403);
        expect((await admin.agent.post("/api/admin/jobs/anomalies/run").send({})).status).toBe(403);
        expect((await admin.agent.get("/api/admin/admins")).body.items).toBeUndefined();

        const changed = await admin.agent.post("/api/admin/auth/password").send({currentPassword: ADMIN_PASSWORD, newPassword: "Another-Passw0rd!y1"});
        expect(changed.status).toBe(200);
        const after = await me(admin);
        expect(after).toMatchObject({passwordExpired: false, mustChangePassword: false, passwordExpiryWarning: false});
        expect(after.passwordDaysLeft).toBe(60);
        expect((await admin.agent.get("/api/admin/overview")).status).toBe(200);
    });

    it("refuses to go back to one of the last five passwords", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const change = (current: string, next: string) => admin.agent.post("/api/admin/auth/password").send({currentPassword: current, newPassword: next});
        expect((await change(ADMIN_PASSWORD, "Second-Passw0rd!aa")).status).toBe(200);
        const back = await change("Second-Passw0rd!aa", ADMIN_PASSWORD);
        expect(back.status).toBe(400);
        expect(back.body.message).toMatch(/last five/);
        expect((await change("Second-Passw0rd!aa", "Second-Passw0rd!aa")).status).toBe(400);
        expect((await change("Second-Passw0rd!aa", "Third-Passw0rd!bb1")).status).toBe(200);
        expect((await change("Third-Passw0rd!bb1", "Second-Passw0rd!aa")).status).toBe(400);
        // Only five are remembered: the hashes, never the passwords.
        const stored = (await pool().query("SELECT password_history FROM admin_users WHERE email = $1", [admin.email])).rows[0].password_history as string[];
        expect(stored).toHaveLength(2);
        expect(stored.every((h) => h.startsWith("$2"))).toBe(true);
    });

    it("validates the numbers, can be turned off, and follows a changed lifetime", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await setSettings(admin, {ADMIN_PASSWORD_MAX_AGE_DAYS: "3"})).status).toBe(400);
        expect((await setSettings(admin, {ADMIN_PASSWORD_MAX_AGE_DAYS: "30", ADMIN_PASSWORD_WARN_DAYS: "30"})).status).toBe(400);

        // Turned off with the environment variable (0 = never expires): even a very old password works.
        await ageOf(admin, 400);
        expect((await me(admin)).passwordExpired).toBe(true);
        process.env.ADMIN_PASSWORD_MAX_AGE_DAYS = "0";
        try {
            const free = await me(admin);
            expect(free).toMatchObject({passwordExpired: false, passwordExpiresAt: null, passwordDaysLeft: null, mustChangePassword: false});
            expect((await admin.agent.get("/api/admin/overview")).status).toBe(200);
            const row = (await admin.agent.get("/api/admin/admins")).body.items.find((a: any) => a.email === admin.email);
            expect(row).toMatchObject({passwordExpiresAt: null, passwordExpired: false});
        } finally {
            delete process.env.ADMIN_PASSWORD_MAX_AGE_DAYS;
        }

        // A longer lifetime saved in the console, with its own reminder window.
        await ageOf(admin, 0);
        expect((await setSettings(admin, {ADMIN_PASSWORD_MAX_AGE_DAYS: "90", ADMIN_PASSWORD_WARN_DAYS: "10"})).status).toBe(200);
        try {
            expect((await me(admin)).passwordDaysLeft).toBe(90);
            await ageOf(admin, 83);
            expect(await me(admin)).toMatchObject({passwordDaysLeft: 7, passwordExpiryWarning: true});
            await ageOf(admin, 79);
            expect((await me(admin)).passwordExpiryWarning).toBe(false);
        } finally {
            await ageOf(admin, 0);
            await setSettings(admin, {ADMIN_PASSWORD_MAX_AGE_DAYS: null, ADMIN_PASSWORD_WARN_DAYS: null});
        }
    });
});

describe("password expiry reminders", () => {
    const mailTo = (spy: jest.SpyInstance, email: string) => spy.mock.calls.filter(([to]) => to === email);

    it("emails each admin near or past expiry once a day, with the date and the days left, and nobody else", async () => {
        const soon = await createLoggedInAdmin(apps.admin());
        const late = await createLoggedInAdmin(apps.admin());
        const fine = await createLoggedInAdmin(apps.admin());
        await ageOf(soon, 57);
        await ageOf(late, 70);
        const mail = appService.getMailService();
        jest.spyOn(mail, "isEnabled").mockReturnValue(true);
        const send = jest.spyOn(mail, "sendReportingError").mockResolvedValue(null);

        const first = await appService.getJobs().run("password-expiry", "manual");
        expect(first.status).toBe("ok");
        expect(first.message).toMatch(/reminders? sent/);
        const toSoon = mailTo(send, soon.email);
        expect(toSoon).toHaveLength(1);
        expect(toSoon[0][1]).toMatch(/expires in 3 days/);
        expect(toSoon[0][2]).toMatch(/expires on \d{4}-\d{2}-\d{2} \(3 days from now\)/);
        expect(toSoon[0][2]).not.toMatch(/Another-Passw0rd|password:/i);
        const toLate = mailTo(send, late.email);
        expect(toLate).toHaveLength(1);
        expect(toLate[0][1]).toMatch(/has expired/);
        expect(mailTo(send, fine.email)).toHaveLength(0);

        // Same day, second run (a restart, a manual run): nobody gets it twice.
        await appService.getJobs().run("password-expiry", "manual");
        expect(mailTo(send, soon.email)).toHaveLength(1);
        expect(mailTo(send, late.email)).toHaveLength(1);

        // Tomorrow: the reminder is sent again.
        await pool().query("UPDATE admin_users SET password_warned_on = CURRENT_DATE - 1 WHERE email = ANY($1)", [[soon.email, late.email]]);
        await appService.getJobs().run("password-expiry", "manual");
        expect(mailTo(send, soon.email)).toHaveLength(2);
        expect(mailTo(send, late.email)).toHaveLength(2);

        // Changing the password ends the reminders.
        await pool().query("UPDATE admin_users SET password_warned_on = NULL WHERE email = $1", [soon.email]);
        await ageOf(soon, 1);
        await appService.getJobs().run("password-expiry", "manual");
        expect(mailTo(send, soon.email)).toHaveLength(2);
    });

    it("says so when email isn't set up, sends nothing and tries again later", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await ageOf(admin, 58);
        const mail = appService.getMailService();
        jest.spyOn(mail, "isEnabled").mockReturnValue(false);
        const send = jest.spyOn(mail, "sendReportingError").mockResolvedValue(null);
        const run = await appService.getJobs().run("password-expiry", "manual");
        expect(run.message).toMatch(/not sent: email isn't set up/);
        expect(mailTo(send, admin.email)).toHaveLength(0);
        expect((await pool().query("SELECT password_warned_on FROM admin_users WHERE email = $1", [admin.email])).rows[0].password_warned_on).toBeNull();
        // The console still warns.
        expect(await me(admin)).toMatchObject({passwordExpiryWarning: true, passwordDaysLeft: 2});
    });

    it("does nothing while passwords never expire, and a failed send is retried", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await ageOf(admin, 59);
        const mail = appService.getMailService();
        jest.spyOn(mail, "isEnabled").mockReturnValue(true);
        const send = jest.spyOn(mail, "sendReportingError").mockResolvedValue("The mail server refused it.");
        await appService.getJobs().run("password-expiry", "manual");
        expect(mailTo(send, admin.email)).toHaveLength(1);
        expect((await pool().query("SELECT password_warned_on FROM admin_users WHERE email = $1", [admin.email])).rows[0].password_warned_on).toBeNull();
        await appService.getJobs().run("password-expiry", "manual");
        expect(mailTo(send, admin.email)).toHaveLength(2);

        process.env.ADMIN_PASSWORD_MAX_AGE_DAYS = "0";
        try {
            send.mockClear();
            const off = await appService.getJobs().run("password-expiry", "manual");
            expect(off.message).toBe("Passwords never expire");
            expect(send).not.toHaveBeenCalled();
        } finally {
            delete process.env.ADMIN_PASSWORD_MAX_AGE_DAYS;
        }
    });

    it("is one of the listed background jobs", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const job = (await admin.agent.get("/api/admin/jobs")).body.items.find((j: any) => j.id === "password-expiry");
        expect(job).toMatchObject({name: "Admin password reminders", schedule: "Every day", dangerous: false});
    });
});
