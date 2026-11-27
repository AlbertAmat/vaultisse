/**
 * Test helpers for the admin portal: bring the app up with the portal on, and create admins that are logged
 * in through the real login + two-factor enrolment flow (not a database shortcut).
 */
import request from "supertest";
import {Express} from "express";
import {generate} from "otplib";
import {appService} from "../../src/AppService";
import {AdminAuthService} from "../../src/admin/services/AdminAuthService";
import {nextFakeIp} from "./auth";

export const ADMIN_PASSWORD = "Admin-Passw0rd!x";

/** Starts the main app and the admin portal for a test file, and tears both down afterwards. */
export function setupAdminTestApp(): {main: () => Express; admin: () => Express} {
    beforeAll(async () => {
        await appService.init();
    });
    afterAll(async () => {
        await appService.stopAdmin();
        await new Promise<void>((resolve) => appService.getServer()?.close(() => resolve()));
        await appService.getDatabasePool().end();
    });
    return {main: () => appService.getApp(), admin: () => appService.getAdminApp()!};
}

export interface TestAdmin {
    agent: ReturnType<typeof request.agent>;
    email: string;
    password: string;
    /** One-time backup codes from enrolment; each can be used once (for a second login or a re-verification). */
    backupCodes: string[];
    /** Re-verifies the session (password + a backup code), unlocking dangerous actions for 5 minutes. */
    reauth: () => Promise<void>;
}

/**
 * Creates an admin and logs it in, including setting up two-factor.
 * @param app The admin Express app.
 * @param role Role of the new admin.
 */
export async function createLoggedInAdmin(app: Express, role: "superadmin" | "readonly" = "superadmin"): Promise<TestAdmin> {
    const email = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
    const auth = new AdminAuthService(appService.getDatabasePool(), appService.getLogger(), appService.getJwtSecret());
    await auth.create({email, name: "Test Admin", password: ADMIN_PASSWORD, role});

    const agent = request.agent(app);
    const post = (path: string, body: object) => agent.post(path).set("X-Forwarded-For", nextFakeIp()).send(body);

    const login = await post("/api/admin/auth/login", {email, password: ADMIN_PASSWORD});
    if (login.status !== 200 || login.body.next !== "enroll") {
        throw new Error(`Admin login failed: ${login.status} ${JSON.stringify(login.body)}`);
    }
    const start = await post("/api/admin/auth/enroll/start", {});
    const confirm = await post("/api/admin/auth/enroll/confirm", {code: await generate({secret: start.body.secret})});
    if (confirm.status !== 200) {
        throw new Error(`Admin enrolment failed: ${confirm.status} ${JSON.stringify(confirm.body)}`);
    }

    const backupCodes: string[] = confirm.body.backupCodes;
    return {
        agent, email, password: ADMIN_PASSWORD, backupCodes,
        reauth: async () => {
            const res = await post("/api/admin/auth/reauth", {password: ADMIN_PASSWORD, backupCode: backupCodes.shift()});
            if (res.status !== 200) {
                throw new Error(`Re-verification failed: ${res.status} ${JSON.stringify(res.body)}`);
            }
        },
    };
}
