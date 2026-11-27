/**
 * The first start of the portal: with no admin yet, one is created with a generated password that is
 * printed once in the container output, and that admin has to change it before doing anything else.
 */
import "../helpers/adminEnv";
import request from "supertest";
import {generate} from "otplib";
import {appService} from "../../src/AppService";
import {ADMIN_PASSWORD, createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";
import {nextFakeIp} from "../helpers/auth";

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();
const post = (agent: ReturnType<typeof request.agent>, path: string, body: object) => agent.post(path).set("X-Forwarded-For", nextFakeIp()).send(body);

/** Logs in through password + two-factor enrolment and returns the agent plus the backup codes. */
async function signIn(email: string, password: string) {
    const agent = request.agent(apps.admin());
    expect((await post(agent, "/api/admin/auth/login", {email, password})).body.next).toBe("enroll");
    const start = await post(agent, "/api/admin/auth/enroll/start", {});
    const confirm = await post(agent, "/api/admin/auth/enroll/confirm", {code: await generate({secret: start.body.secret})});
    expect(confirm.status).toBe(200);
    return {agent, backupCodes: confirm.body.backupCodes as string[]};
}

describe("first admin", () => {
    let created: {email: string; password: string};
    let output = "";

    beforeAll(async () => {
        // A fresh installation has no admin at all.
        await pool().query("DELETE FROM admin_users");
        const spy = jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => { output += args.join(" ") + "\n"; });
        try {
            const result = await (appService as any).m_adminApp.ensureFirstAdmin(3001);
            expect(result).not.toBeNull();
            created = result;
        } finally {
            spy.mockRestore();
        }
    });

    it("prints a block with the username and password, and tells the admin to change it", () => {
        expect(output).toContain("ADMIN PORTAL");
        expect(output).toContain(`username: ${created.email}`);
        expect(output).toContain(`password: ${created.password}`);
        expect(output.toLowerCase()).toContain("change this password");
    });

    it("says which port it listens on and every address to open it at", () => {
        expect(output).toContain("listening on port 3001");
        expect(output).toContain("http://localhost:3001");
        const {AdminApp} = require("../../src/admin/AdminApp");
        const addresses: string[] = AdminApp.reachableAddresses(3001, "https://adm.example.com");
        expect(addresses[0]).toBe("https://adm.example.com   (ADMIN_URL)");
        expect(addresses[1]).toBe("http://localhost:3001");
        addresses.slice(2).forEach((address) => expect(address).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:3001$/));
    });

    it("generates a different strong password each time that satisfies the admin password rules", async () => {
        expect(created.password).toHaveLength(20);
        const {validateAdminPassword} = await import("../../src/admin/services/AdminAuthService");
        expect(() => validateAdminPassword(created.password)).not.toThrow();
        // Only created when there is nobody; a second call does nothing.
        expect(await (appService as any).m_adminApp.ensureFirstAdmin(3001)).toBeNull();
        expect((await pool().query("SELECT COUNT(*)::int AS n FROM admin_users")).rows[0].n).toBe(1);
    });

    it("keeps the password out of the log file the portal can display", async () => {
        const {readFileSync, existsSync} = await import("fs");
        const file = appService.getLogger().getLogFilePath();
        const log = existsSync(file) ? readFileSync(file, "utf8") : "";
        expect(log).not.toContain(created.password);
    });

    it("forces a password change: nothing works until the admin chooses their own", async () => {
        const {agent, backupCodes} = await signIn(created.email, created.password);

        const me = await agent.get("/api/admin/auth/me");
        expect(me.status).toBe(200);
        expect(me.body.mustChangePassword).toBe(true);

        for (const path of ["/api/admin/overview", "/api/admin/users", "/api/admin/settings", "/api/admin/logs/audit"]) {
            const res = await agent.get(path);
            expect({path, status: res.status, flag: res.body.passwordChangeRequired}).toEqual({path, status: 403, flag: true});
        }

        // Weak, unchanged, and wrong-current passwords are refused and the block stays.
        expect((await post(agent, "/api/admin/auth/password", {currentPassword: created.password, newPassword: "short"})).status).toBe(400);
        expect((await post(agent, "/api/admin/auth/password", {currentPassword: created.password, newPassword: created.password})).status).toBe(400);
        expect((await post(agent, "/api/admin/auth/password", {currentPassword: "wrong", newPassword: ADMIN_PASSWORD})).status).toBe(401);
        expect((await agent.get("/api/admin/overview")).status).toBe(403);

        const changed = await post(agent, "/api/admin/auth/password", {currentPassword: created.password, newPassword: ADMIN_PASSWORD});
        expect(changed.status).toBe(200);
        expect((await agent.get("/api/admin/auth/me")).body.mustChangePassword).toBe(false);
        expect((await agent.get("/api/admin/overview")).status).toBe(200);

        // The generated password no longer works; the new one does.
        const old = await post(request.agent(apps.admin()), "/api/admin/auth/login", {email: created.email, password: created.password});
        expect(old.status).toBe(401);
        const fresh = request.agent(apps.admin());
        expect((await post(fresh, "/api/admin/auth/login", {email: created.email, password: ADMIN_PASSWORD})).body.next).toBe("totp");
        expect((await post(fresh, "/api/admin/auth/2fa", {backupCode: backupCodes[0]})).status).toBe(200);
        expect((await fresh.get("/api/admin/overview")).status).toBe(200);
    });

    it("also makes admins created from the portal choose their own password", async () => {
        const boss = await createLoggedInAdmin(apps.admin());
        await boss.reauth();
        const email = `invited_${Date.now()}@example.com`;
        const made = await boss.agent.post("/api/admin/admins").send({email, name: "Invited", password: ADMIN_PASSWORD, role: "readonly"});
        expect(made.status).toBe(201);
        expect(made.body.admin.mustChangePassword).toBe(true);

        const {agent} = await signIn(email, ADMIN_PASSWORD);
        expect((await agent.get("/api/admin/overview")).status).toBe(403);
        expect((await post(agent, "/api/admin/auth/password", {currentPassword: ADMIN_PASSWORD, newPassword: "Another-Passw0rd!y"})).status).toBe(200);
        expect((await agent.get("/api/admin/overview")).status).toBe(200);
    });
});
