/**
 * With ADMIN_ENABLED unset (the default) the portal must not exist at all and the server must behave as
 * it did before it was added: env vars configure it, plans don't limit anything, nothing listens on an admin port.
 */
import request from "supertest";
import {appService} from "../../src/AppService";
import {runAdminCli} from "../../src/admin/AdminCli";
import {AdminAuthService} from "../../src/admin/services/AdminAuthService";
import {createAuthenticatedUser} from "../helpers/auth";
import {setupTestApp} from "../helpers/testApp";

const app = setupTestApp();

describe("admin portal switched off", () => {
    it("has no admin listener and no admin app", () => {
        expect(appService.isAdminEnabled()).toBe(false);
        expect(appService.getAdminServer()).toBeNull();
        expect(appService.getAdminApp()).toBeNull();
    });

    it("does not serve the admin API on the main port", async () => {
        const res = await request(app).get("/api/admin/overview");
        expect(res.status).not.toBe(200);
        expect(res.body.items).toBeUndefined();
    });

    it("still has an instance id, which is recreated if the row is missing", async () => {
        const pool = appService.getDatabasePool();
        const id = appService.getInstanceUuid();
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect((await pool.query("SELECT value FROM app_settings WHERE key = 'INSTANCE_UUID'")).rows[0].value).toBe(id);
        const {SettingsRepository} = await import("../../src/admin/repositories/SettingsRepository");
        // Present: unchanged. Missing: a new one is created and then stays.
        expect(await new SettingsRepository(pool).ensureInstanceUuid()).toBe(id);
        await pool.query("DELETE FROM app_settings WHERE key = 'INSTANCE_UUID'");
        const fresh = await new SettingsRepository(pool).ensureInstanceUuid();
        expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
        expect(await new SettingsRepository(pool).ensureInstanceUuid()).toBe(fresh);
        await pool.query("UPDATE app_settings SET value = $1 WHERE key = 'INSTANCE_UUID'", [id]);
    });

    it("ignores settings stored in the database", async () => {
        await appService.getDatabasePool().query("INSERT INTO app_settings (key, value) VALUES ('REGISTRATION_ENABLED', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false'");
        try {
            await appService.applyPortalSettings();
            expect(appService.isRegistrationEnabled()).toBe(true);
            expect(appService.getSettings().get("REGISTRATION_ENABLED")).toBeUndefined();
        } finally {
            await appService.getDatabasePool().query("DELETE FROM app_settings WHERE key = 'REGISTRATION_ENABLED'");
        }
    });

    it("does not enforce plans", async () => {
        const pool = appService.getDatabasePool();
        const plan = await pool.query("INSERT INTO plans (code, name, max_books, is_default) VALUES ($1, 'Zero', 0, TRUE) RETURNING id", [`zero_${Date.now()}`]);
        try {
            const user = await createAuthenticatedUser(app);
            const res = await user.agent.post("/api/rest/book").field("name", "Allowed").field("description", "d").field("isbn", `98${Date.now()}`);
            expect(res.status).toBeLessThan(300);
        } finally {
            await pool.query("DELETE FROM plans WHERE id = $1", [plan.rows[0].id]);
        }
    });

    it("can still create an admin from the command line, and says the portal is off", async () => {
        const email = `cli_${Date.now()}@example.com`;
        process.env.ADMIN_PASSWORD = "A-Long-Enough-Passw0rd";
        try {
            expect(await runAdminCli("admin:create", ["--email", email, "--name", "Cli Admin"])).toBe(0);
            const auth = new AdminAuthService(appService.getDatabasePool(), appService.getLogger(), appService.getJwtSecret());
            expect((await auth.list()).some((admin) => admin.email === email && admin.role === "superadmin")).toBe(true);
            // Creating the same one again is refused; resetting works.
            expect(await runAdminCli("admin:create", ["--email", email])).toBe(1);
            expect(await runAdminCli("admin:reset", ["--email", email])).toBe(0);
            expect(await runAdminCli("admin:reset", ["--email", "nobody@example.com"])).toBe(1);
            expect(await runAdminCli("admin:create", [])).toBe(2);
        } finally {
            delete process.env.ADMIN_PASSWORD;
        }
    });
});
