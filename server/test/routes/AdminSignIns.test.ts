import "../helpers/adminEnv";
import request from "supertest";
import {appService} from "../../src/AppService";
import {createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();
afterEach(() => jest.restoreAllMocks());

const RU = "95.173.136.70";
const RU2 = "5.255.255.70";
const GB = "81.2.69.142";
const failure = (ip: string, email: string, stage = "password", ago = "10 minutes") =>
    pool().query("INSERT INTO admin_audit_log (action, admin_email, ip_address, metadata, created_date) VALUES ('auth.login_failed', $1, $2, $3, NOW() - $4::interval)", [email, ip, JSON.stringify({stage}), ago]);
const success = (ip: string, email: string, ago = "1 hour") =>
    pool().query("INSERT INTO admin_audit_log (action, admin_email, ip_address, created_date) VALUES ('auth.login', $1, $2, NOW() - $3::interval)", [email, ip, ago]);

describe("admin sign-in history", () => {
    it("shows an address from Russia with five failed attempts, where it is, what it tried and whether it is blocked", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const ip = `95.173.${100 + Math.floor(Math.random() * 100)}.${1 + Math.floor(Math.random() * 200)}`;
        for (const email of ["admin@vaultisse.local", "admin@vaultisse.local", "root@example.com", "administrator@example.com", "admin@vaultisse.local"]) await failure(ip, email, "password", "20 minutes");
        await success(GB, "owner@example.com");

        const res = await admin.agent.get("/api/admin/admin-signins").query({days: 7});
        expect(res.status).toBe(200);
        const source = res.body.sources.find((s: any) => s.ip === ip);
        expect(source).toMatchObject({failed: 5, ok: 0, emails: 3, country: "RU", stages: ["password"], blocked: false, suspicious: true});
        expect(new Date(source.lastSeen).getTime()).toBeGreaterThan(Date.now() - 3600000);
        expect(res.body.countries.find((c: any) => c.country === "RU").failed).toBeGreaterThanOrEqual(5);
        expect(res.body.summary.failed).toBeGreaterThanOrEqual(5);
        expect(res.body.summary.failedIps).toBeGreaterThanOrEqual(1);
        expect(res.body.summary.countries).toBeGreaterThanOrEqual(2);
        const good = res.body.sources.find((s: any) => s.ip === GB);
        expect(good).toMatchObject({country: "GB", failed: 0, suspicious: false});

        // The timeline covers the whole period, empty days included.
        expect(res.body.unit).toBe("day");
        expect(res.body.timeline).toHaveLength(8);
        expect(res.body.timeline.reduce((sum: number, b: any) => sum + b.failed, 0)).toBeGreaterThanOrEqual(5);

        // Blocking it from the Security page shows up here.
        await admin.agent.post("/api/admin/security/blocked-ips").send({ip, reason: "Failed admin sign-ins", hours: 24});
        const after = await admin.agent.get("/api/admin/admin-signins").query({days: 7});
        expect(after.body.sources.find((s: any) => s.ip === ip).blocked).toBe(true);
        await admin.agent.delete(`/api/admin/security/blocked-ips/${encodeURIComponent(ip)}`);
    });

    it("lists the individual attempts with filters, and a day view by the hour", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const ip = `5.255.${100 + Math.floor(Math.random() * 100)}.${1 + Math.floor(Math.random() * 200)}`;
        await failure(ip, "a@example.com", "password", "5 minutes");
        await failure(ip, "a@example.com", "second factor", "4 minutes");
        await success(ip, "a@example.com", "3 minutes");
        const all = await admin.agent.get("/api/admin/admin-signins/attempts").query({days: 1, ip});
        expect(all.body.total).toBe(3);
        expect(all.body.items.map((i: any) => [i.result, i.stage])).toEqual([["ok", null], ["failed", "second factor"], ["failed", "password"]]);
        expect(all.body.items[0]).toMatchObject({ip, email: "a@example.com", country: "RU"});
        const failed = await admin.agent.get("/api/admin/admin-signins/attempts").query({days: 1, ip, result: "failed"});
        expect(failed.body.total).toBe(2);
        expect((await admin.agent.get("/api/admin/admin-signins/attempts").query({result: "maybe"})).status).toBe(400);
        const hourly = await admin.agent.get("/api/admin/admin-signins").query({days: 1});
        expect(hourly.body.unit).toBe("hour");
        expect(hourly.body.timeline.length).toBeGreaterThanOrEqual(24);
        expect((await admin.agent.get("/api/admin/admin-signins").query({days: 3})).status).toBe(400);
    });

    it("counts the attempts the rate limiter refused, even from an address that never reached the password check", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const ip = `77.88.${100 + Math.floor(Math.random() * 100)}.${1 + Math.floor(Math.random() * 200)}`;
        await pool().query("INSERT INTO security_events (type, ip_address, bucket, count, detail) VALUES ('rate_limited', $1, date_trunc('minute', now()), 12, 'admin-login')", [ip]);
        const res = await admin.agent.get("/api/admin/admin-signins").query({days: 7});
        expect(res.body.sources.find((s: any) => s.ip === ip)).toMatchObject({failed: 0, limited: 12, suspicious: true, country: "RU"});
        expect(res.body.summary.limited).toBeGreaterThanOrEqual(12);
    });

    it("records real failed attempts through the sign-in page, so an attack is visible straight away", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const ip = `178.154.${100 + Math.floor(Math.random() * 100)}.${1 + Math.floor(Math.random() * 200)}`;
        for (let i = 0; i < 5; i++) {
            const res = await request(apps.admin()).post("/api/admin/auth/login").set("X-Forwarded-For", ip).send({email: `ghost${i}@example.com`, password: "Wrong-Passw0rd!x"});
            expect(res.status).toBe(401);
        }
        const res = await admin.agent.get("/api/admin/admin-signins").query({days: 1});
        expect(res.body.sources.find((s: any) => s.ip === ip)).toMatchObject({failed: 5, emails: 5, country: "RU", suspicious: true, stages: ["password"]});
        const overview = (await admin.agent.get("/api/admin/overview")).body.counts;
        expect(overview.adminFailed24h).toBeGreaterThanOrEqual(5);
        expect(overview.adminFailedIps24h).toBeGreaterThanOrEqual(1);
        const charts = (await admin.agent.get("/api/admin/overview/charts").query({days: 7})).body;
        expect(charts.adminSignIns).toHaveLength(7);
        expect(charts.adminSignIns[6].failed).toBeGreaterThanOrEqual(5);
    });

    it("tells the admins who is attacking: addresses, places and how many emails were tried", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const ip = `213.180.${100 + Math.floor(Math.random() * 100)}.${1 + Math.floor(Math.random() * 200)}`;
        for (let i = 0; i < 4; i++) await failure(ip, `target${i}@example.com`, "password", "2 minutes");
        await pool().query("INSERT INTO security_events (type, ip_address, bucket, count) VALUES ('admin_login_failed', $1, date_trunc('minute', now()), 4)", [ip]);
        const notify = jest.spyOn(appService.getNotifier(), "notify").mockResolvedValue(true);
        await appService.getNotifier().runChecks();
        const call = notify.mock.calls.find(([, r]) => r.dedupeKey === "admin-logins");
        expect(call).toBeDefined();
        const text = call![1].lines.join("\n");
        expect(text).toContain(ip);
        expect(text).toMatch(/Russia/);
        expect(text).toMatch(/4 failed/);
        expect(text).toMatch(/4 different emails tried/);
        expect(admin.email).toBeTruthy();
    });

    it("is readable by a read-only admin and by nobody who is signed out", async () => {
        const reader = await createLoggedInAdmin(apps.admin(), "readonly");
        expect((await reader.agent.get("/api/admin/admin-signins")).status).toBe(200);
        expect((await reader.agent.get("/api/admin/admin-signins/attempts")).status).toBe(200);
        expect((await request(apps.admin()).get("/api/admin/admin-signins")).status).toBe(401);
        expect((await request(apps.admin()).get("/api/admin/admin-signins/attempts")).status).toBe(401);
    });
});
