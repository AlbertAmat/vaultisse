import "../helpers/adminEnv";
import {appService} from "../../src/AppService";
import {runAdminCli} from "../../src/admin/AdminCli";
import {formatConfigTable} from "../../src/admin/services/ConfigReport";
import {maskEmail} from "../../src/admin/services/ConfigResetService";
import {MailService} from "../../src/services/MailService";
import {createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();

type Admin = Awaited<ReturnType<typeof createLoggedInAdmin>>;
const setSettings = (admin: Admin, changes: Record<string, string | null>) => admin.agent.put("/api/admin/settings").send({changes});
const mailOn = (admin: Admin) => setSettings(admin, {SMTP_HOST: "smtp.example.invalid", SMTP_FROM: "Vaultisse <a@example.com>"});
const savedCount = async () => (await pool().query("SELECT COUNT(*)::int AS n FROM app_settings WHERE key <> 'INSTANCE_UUID' AND key <> 'ONBOARDING_COMPLETED_AT' AND key NOT LIKE 'MAINTENANCE\\_%'")).rows[0].n;

let sentBodies: string[];
beforeEach(() => {
    sentBodies = [];
    jest.spyOn(MailService.prototype, "sendReportingError").mockImplementation(async (_to: string, _subject: string, text: string) => {
        sentBodies.push(text);
        return null;
    });
});
afterEach(() => jest.restoreAllMocks());

describe("configuration sources", () => {
    it("formats the env-vs-panel table and says which one wins", () => {
        const lines = formatConfigTable([
            {key: "SMTP_HOST", envValue: "smtp.old.com", panelValue: "smtp.new.com", applied: "panel", conflict: true},
            {key: "REGISTRATION_ENABLED", envValue: "true", panelValue: null, applied: "env", conflict: false},
            {key: "SMTP_PASSWORD", envValue: null, panelValue: "(set)", applied: "panel", conflict: false},
            {key: "MAX_EBOOK_FILE_SIZE_MB", envValue: null, panelValue: null, applied: "default", conflict: false},
        ]).join("\n");
        expect(lines).toContain("take priority over environment variables");
        expect(lines).toMatch(/SMTP_HOST\s+smtp\.old\.com\s+smtp\.new\.com\s+admin panel\s+env var IGNORED/);
        expect(lines).toMatch(/REGISTRATION_ENABLED\s+true\s+-\s+env var/);
        expect(lines).toContain("1 environment variable is being ignored");
        expect(lines).toContain("Danger zone");
        expect(lines).toContain("1 other setting uses its default");
        expect(lines).not.toContain("MAX_EBOOK_FILE_SIZE_MB");
        expect(formatConfigTable([{key: "A", envValue: null, panelValue: null, applied: "default", conflict: false}]).join("\n")).toContain("everything uses its default");
    });

    it("compares env and panel for every setting, hiding secrets", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        process.env.SMTP_USER = "env-user";
        process.env.LIBRARYTHING_API_KEY = "env-secret-key";
        try {
            await admin.reauth();
            await setSettings(admin, {MAX_IMPORT_FILE_SIZE_MB: "12", SMTP_USER: "panel-user", LIBRARYTHING_API_KEY: "panel-secret-key"});
            const rows = appService.getSettings().comparison();
            const row = (key: string) => rows.find((r) => r.key === key)!;
            expect(row("MAX_IMPORT_FILE_SIZE_MB")).toMatchObject({envValue: "10", panelValue: "12", applied: "panel", conflict: true});
            expect(row("SMTP_USER")).toMatchObject({envValue: "env-user", panelValue: "panel-user", applied: "panel", conflict: true});
            expect(row("LIBRARYTHING_API_KEY")).toMatchObject({envValue: "(set)", panelValue: "(set)", applied: "panel", conflict: true});
            expect(row("SMTP_HOST")).toMatchObject({applied: "default", conflict: false});
            expect(JSON.stringify(rows)).not.toContain("secret-key");

            // And the same facts reach the settings page, per setting.
            const items = (await admin.agent.get("/api/admin/settings")).body.groups.flatMap((g: any) => g.items);
            expect(items.find((i: any) => i.key === "SMTP_USER")).toMatchObject({source: "database", envSet: true, envValue: "env-user"});
            expect(items.find((i: any) => i.key === "LIBRARYTHING_API_KEY")).toMatchObject({envSet: true, envValue: null});
            expect(JSON.stringify(items)).not.toContain("secret-key");
        } finally {
            delete process.env.SMTP_USER;
            delete process.env.LIBRARYTHING_API_KEY;
            await setSettings(admin, {MAX_IMPORT_FILE_SIZE_MB: null, SMTP_USER: null, LIBRARYTHING_API_KEY: null});
        }
    });

    it("applies the admin panel value over the env var, and the env var again once the panel value is gone", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect(appService.getMaxImportFileSizeMb()).toBe(10);
        await setSettings(admin, {MAX_IMPORT_FILE_SIZE_MB: "33"});
        expect(appService.getMaxImportFileSizeMb()).toBe(33);
        await setSettings(admin, {MAX_IMPORT_FILE_SIZE_MB: null});
        expect(appService.getMaxImportFileSizeMb()).toBe(10);
    });
});

describe("danger zone: reset to environment variables", () => {
    it("needs a fresh verification, a typed confirmation and the emailed code, and then resets everything saved", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.reauth();
        await mailOn(admin);
        await setSettings(admin, {MAX_IMPORT_FILE_SIZE_MB: "33", REGISTRATION_ENABLED: "false", ADMIN_NOTIFY_STARTUP: "true"});
        expect(await savedCount()).toBeGreaterThanOrEqual(5);
        expect(appService.isRegistrationEnabled()).toBe(false);

        // Step 1: the code goes to the admin's own address, never to the browser.
        const asked = await admin.agent.post("/api/admin/settings/reset/request").send({});
        expect(asked.status).toBe(200);
        expect(asked.body.sentTo).toBe(maskEmail(admin.email));
        expect(asked.body.sentTo).not.toBe(admin.email);
        expect(JSON.stringify(asked.body)).not.toMatch(/\d{6}/);
        const code = /code is: (\d{6})/.exec(sentBodies.at(-1)!)![1];

        // Another request right away is refused.
        expect((await admin.agent.post("/api/admin/settings/reset/request").send({})).status).toBe(400);

        // Step 2: the confirmation word, and the code, must both be right. Nothing changes until then.
        expect((await admin.agent.post("/api/admin/settings/reset/confirm").send({code, confirm: "reset"})).status).toBe(400);
        const wrong = await admin.agent.post("/api/admin/settings/reset/confirm").send({code: "000000", confirm: "RESET"});
        expect(wrong.status).toBe(400);
        expect(wrong.body.message).toMatch(/4 tries left/);
        expect(await savedCount()).toBeGreaterThanOrEqual(5);

        const done = await admin.agent.post("/api/admin/settings/reset/confirm").send({code, confirm: "RESET"});
        expect(done.status).toBe(200);
        expect(done.body.removed).toBeGreaterThanOrEqual(5);

        // Back to the environment variables and defaults, applied at once.
        expect(await savedCount()).toBe(0);
        expect(appService.getMaxImportFileSizeMb()).toBe(10);
        expect(appService.isRegistrationEnabled()).toBe(true);
        expect(appService.getMailService().isEnabled()).toBe(false);
        // Not configuration: the instance id stays, and so does the record that setup was done.
        expect((await pool().query("SELECT 1 FROM app_settings WHERE key = 'INSTANCE_UUID'")).rowCount).toBe(1);
        const audit = await admin.agent.get("/api/admin/logs/audit").query({action: "settings.reset_all"});
        expect(audit.body.items[0].metadata.removed).toBe(done.body.removed);

        // The code was single use.
        await admin.reauth();
        expect((await admin.agent.post("/api/admin/settings/reset/confirm").send({code, confirm: "RESET"})).status).toBe(400);
    });

    it("refuses without email set up, for read-only admins and without re-verification", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        // Not re-verified.
        const unverified = await admin.agent.post("/api/admin/settings/reset/request").send({});
        expect(unverified.status).toBe(403);
        expect(unverified.body.reauthRequired).toBe(true);
        // Verified, but there is no email to send a code with.
        await admin.reauth();
        const nomail = await admin.agent.post("/api/admin/settings/reset/request").send({});
        expect(nomail.status).toBe(400);
        expect(nomail.body.message).toMatch(/config:reset/);
        // Read-only.
        const readonly = await createLoggedInAdmin(apps.admin(), "readonly");
        expect((await readonly.agent.post("/api/admin/settings/reset/request").send({})).status).toBe(403);
        expect((await readonly.agent.post("/api/admin/settings/reset/confirm").send({code: "123456", confirm: "RESET"})).status).toBe(403);
    });

    it("locks a code after five wrong tries", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.reauth();
        await mailOn(admin);
        try {
            await admin.agent.post("/api/admin/settings/reset/request").send({});
            const code = /code is: (\d{6})/.exec(sentBodies.at(-1)!)![1];
            const wrongCode = code === "111111" ? "222222" : "111111";
            let last: any;
            for (let i = 0; i < 5; i++) {
                last = await admin.agent.post("/api/admin/settings/reset/confirm").send({code: wrongCode, confirm: "RESET"});
            }
            expect(last.body.message).toMatch(/Too many wrong codes/);
            // Even the right code no longer works.
            expect((await admin.agent.post("/api/admin/settings/reset/confirm").send({code, confirm: "RESET"})).status).toBe(400);
            expect((await pool().query("SELECT 1 FROM app_settings WHERE key = 'SMTP_HOST'")).rowCount).toBe(1);
        } finally {
            await setSettings(admin, {SMTP_HOST: null, SMTP_FROM: null});
        }
    });

    it("can also be done on the server with config:reset, without the console", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await setSettings(admin, {MAX_IMPORT_FILE_SIZE_MB: "44"});
        expect(await savedCount()).toBe(1);
        expect(await runAdminCli("config:reset", ["--yes"])).toBe(0);
        expect(await savedCount()).toBe(0);
        expect((await pool().query("SELECT 1 FROM app_settings WHERE key = 'INSTANCE_UUID'")).rowCount).toBe(1);
        await appService.applyPortalSettings();
    });
});

describe("first-run onboarding", () => {
    it("is offered until someone completes it, once per installation", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await pool().query("DELETE FROM app_settings WHERE key = 'ONBOARDING_COMPLETED_AT'");
        expect((await admin.agent.get("/api/admin/onboarding")).body).toEqual({completed: false, completedAt: null});

        const readonly = await createLoggedInAdmin(apps.admin(), "readonly");
        expect((await readonly.agent.post("/api/admin/onboarding/complete").send({})).status).toBe(403);
        expect((await readonly.agent.get("/api/admin/onboarding")).body.completed).toBe(false);

        expect((await admin.agent.post("/api/admin/onboarding/complete").send({})).status).toBe(200);
        const again = (await readonly.agent.get("/api/admin/onboarding")).body;
        expect(again.completed).toBe(true);
        expect(new Date(again.completedAt).getTime()).toBeLessThan(Date.now() + 1000);

        // It is a plain row: not an editable setting, and a configuration reset leaves it.
        const keys = (await admin.agent.get("/api/admin/settings")).body.groups.flatMap((g: any) => g.items.map((i: any) => i.key));
        expect(keys).not.toContain("ONBOARDING_COMPLETED_AT");
        expect((await setSettings(admin, {ONBOARDING_COMPLETED_AT: "x"})).status).toBe(400);
        await appService.getSettings().resetAll();
        expect((await admin.agent.get("/api/admin/onboarding")).body.completed).toBe(true);
    });
});
