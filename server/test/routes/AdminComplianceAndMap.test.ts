import "../helpers/adminEnv";
import {appService} from "../../src/AppService";
import {outcomeOf} from "../../src/admin/services/ComplianceService";
import {locate} from "../../src/admin/services/GeoLocator";
import {createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();

type Admin = Awaited<ReturnType<typeof createLoggedInAdmin>>;
const control = async (admin: Admin, id: string) => {
    const body = (await admin.agent.get("/api/admin/compliance")).body;
    return body.controls.find((c: any) => c.id === id);
};

describe("compliance", () => {
    it("combines what the portal measured with what a person declared", () => {
        expect(outcomeOf({state: "pass", detail: ""}, null)).toBe("compliant");
        expect(outcomeOf({state: "warn", detail: ""}, null)).toBe("partial");
        expect(outcomeOf({state: "fail", detail: ""}, "implemented")).toBe("gap");
        expect(outcomeOf({state: "fail", detail: ""}, "not_applicable")).toBe("not_applicable");
        expect(outcomeOf(null, "implemented")).toBe("compliant");
        expect(outcomeOf(null, "planned")).toBe("planned");
        expect(outcomeOf(null, null)).toBe("not_assessed");
    });

    it("lists the controls with live results, a score and what needs attention", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const res = await admin.agent.get("/api/admin/compliance");
        expect(res.status).toBe(200);
        expect(res.body.controls.length).toBeGreaterThan(25);
        expect(res.body.score).toBeGreaterThanOrEqual(0);
        expect(res.body.score).toBeLessThanOrEqual(100);
        const ids = res.body.controls.map((c: any) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(await control(admin, "A.8.15")).toMatchObject({outcome: "compliant", measured: {state: "pass"}, refs: {iso: "ISO/IEC 27001:2022 A.8.15"}});
        // Not measurable by the portal: a person has to declare it.
        expect(await control(admin, "A.8.13")).toMatchObject({measured: null, outcome: "not_assessed"});
    });

    it("lets a person declare a control, requires a reason for 'not applicable', and keeps who reviewed it", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await admin.agent.put("/api/admin/compliance/controls/A.9.9").send({status: "implemented"})).status).toBe(404);
        expect((await admin.agent.put("/api/admin/compliance/controls/A.8.13").send({status: "implemented", evidenceUrl: "javascript:alert(1)"})).status).toBe(400);
        expect((await admin.agent.put("/api/admin/compliance/controls/A.7.1").send({status: "not_applicable"})).status).toBe(400);

        expect((await admin.agent.put("/api/admin/compliance/controls/A.8.13").send({
            status: "implemented", owner: "Ops", justification: "Nightly pg_dump to S3", evidenceUrl: "https://example.com/backup-policy", nextReviewAt: "2020-01-01", reviewed: true,
        })).status).toBe(200);
        const backup = await control(admin, "A.8.13");
        expect(backup).toMatchObject({outcome: "compliant", reviewOverdue: true, record: {owner: "Ops", reviewedBy: admin.email, nextReviewAt: "2020-01-01"}});

        expect((await admin.agent.put("/api/admin/compliance/controls/A.7.1").send({status: "not_applicable", justification: "Hosted by a certified provider"})).status).toBe(200);
        expect((await control(admin, "A.7.1")).outcome).toBe("not_applicable");

        const csv = await admin.agent.get("/api/admin/compliance/export.csv");
        expect(csv.status).toBe(200);
        expect(csv.headers["content-type"]).toMatch(/text\/csv/);
        expect(csv.text).toContain("A.7.1,Physical security perimeters,No,Not applicable");
        expect(csv.text).toContain("Nightly pg_dump to S3");
        const audit = (await admin.agent.get("/api/admin/logs/audit").query({action: "compliance.control"})).body.items;
        expect(audit.length).toBeGreaterThanOrEqual(2);
    });

    it("turns the policy control red when a policy is past its review date, and green when it is current", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await pool().query("DELETE FROM compliance_register");
        expect((await control(admin, "A.5.1")).measured.state).toBe("warn");

        const created = await admin.agent.post("/api/admin/compliance/register").send({kind: "policy", title: "Information security policy", version: "1.0", approvedAt: "2020-01-01", nextReviewAt: "2020-06-01"});
        expect(created.status).toBe(201);
        expect((await control(admin, "A.5.1")).measured.state).toBe("fail");

        const id = created.body.item.id;
        expect((await admin.agent.put(`/api/admin/compliance/register/${id}`).send({title: "Information security policy", version: "1.1", nextReviewAt: "2999-01-01"})).status).toBe(200);
        expect((await control(admin, "A.5.1")).measured.state).toBe("pass");

        expect((await admin.agent.post("/api/admin/compliance/register").send({kind: "bogus", title: "x"})).status).toBe(400);
        expect((await admin.agent.post("/api/admin/compliance/register").send({kind: "risk", title: ""})).status).toBe(400);
        expect((await admin.agent.get("/api/admin/compliance/register").query({kind: "policy"})).body.items).toHaveLength(1);
        expect((await admin.agent.delete(`/api/admin/compliance/register/${id}`)).status).toBe(200);
        expect((await admin.agent.delete(`/api/admin/compliance/register/${id}`)).status).toBe(404);
    });

    it("flags a personal-data incident that wasn't reported within 72 hours, and clears once it is", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await pool().query("DELETE FROM security_incidents");
        expect((await control(admin, "A.5.26")).measured.state).toBe("pass");

        const detectedAt = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
        const created = await admin.agent.post("/api/admin/compliance/incidents").send({title: "Mailbox export leaked", severity: "high", detectedAt, personalData: true});
        expect(created.status).toBe(201);
        const overview = (await admin.agent.get("/api/admin/compliance")).body;
        expect(overview.controls.find((c: any) => c.id === "A.5.26")).toMatchObject({outcome: "gap"});
        expect(overview.attention.some((a: any) => a.kind === "incident" && /72 hours/.test(a.text))).toBe(true);

        const id = created.body.item.id;
        const update = await admin.agent.put(`/api/admin/compliance/incidents/${id}`).send({
            title: "Mailbox export leaked", severity: "high", status: "resolved", detectedAt, personalData: true, authorityNotifiedAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
        });
        expect(update.status).toBe(200);
        expect(update.body.item.resolvedAt).not.toBeNull();
        expect((await control(admin, "A.5.26")).measured.state).toBe("pass");
        expect((await admin.agent.post("/api/admin/compliance/incidents").send({title: "x", severity: "nope"})).status).toBe(400);
        expect((await admin.agent.put("/api/admin/compliance/incidents/999999").send({title: "x", severity: "low"})).status).toBe(404);
    });

    it("tracks the review of admin access", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await pool().query("UPDATE admin_users SET access_reviewed_at = NULL, access_reviewed_by = NULL");
        expect((await control(admin, "A.5.18")).measured.state).toBe("warn");
        const before = (await admin.agent.get("/api/admin/compliance/access")).body.items;
        expect(before.every((a: any) => a.accessReviewedAt === null)).toBe(true);

        const done = await admin.agent.post("/api/admin/compliance/access").send({});
        expect(done.status).toBe(200);
        expect(done.body.confirmed).toBeGreaterThanOrEqual(1);
        expect((await control(admin, "A.5.18")).measured.state).toBe("pass");
        const after = (await admin.agent.get("/api/admin/compliance/access")).body.items.find((a: any) => a.email === admin.email);
        expect(after).toMatchObject({reviewedBy: admin.email});

        await pool().query("UPDATE admin_users SET access_reviewed_at = CURRENT_TIMESTAMP - INTERVAL '400 days'");
        expect((await control(admin, "A.5.18")).measured.state).toBe("fail");
    });

    it("lets a read-only admin look but not change anything", async () => {
        const reader = await createLoggedInAdmin(apps.admin(), "readonly");
        expect((await reader.agent.get("/api/admin/compliance")).status).toBe(200);
        expect((await reader.agent.get("/api/admin/compliance/export.csv")).status).toBe(200);
        expect((await reader.agent.put("/api/admin/compliance/controls/A.8.13").send({status: "implemented"})).status).toBe(403);
        expect((await reader.agent.post("/api/admin/compliance/register").send({kind: "policy", title: "x"})).status).toBe(403);
        expect((await reader.agent.post("/api/admin/compliance/incidents").send({title: "x", severity: "low"})).status).toBe(403);
        expect((await reader.agent.post("/api/admin/compliance/access").send({})).status).toBe(403);
    });
});

describe("login map", () => {
    it("places an address offline, and never a private or invalid one", () => {
        expect(locate("81.2.69.142")).toMatchObject({country: "GB"});
        expect(locate("::ffff:81.2.69.142")).toMatchObject({country: "GB"});
        expect(locate("192.168.1.5")).toBeNull();
        expect(locate("127.0.0.1")).toBeNull();
        expect(locate("not-an-ip")).toBeNull();
    });

    it("groups sign-ins and failed attempts by place, counts what can't be placed, and shows no identities", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = (await pool().query("INSERT INTO users (code, name, email, password) VALUES ($1, 'Map User', $2, 'x') RETURNING id", [`map_${Date.now()}`, `map_${Date.now()}@example.com`])).rows[0].id;
        await pool().query("DELETE FROM activity_log WHERE action = 'login'");
        await pool().query("DELETE FROM security_events");
        const login = (ip: string, ageDays = 0) => pool().query(
            "INSERT INTO activity_log (actor_id, action, metadata, created_date) VALUES ($1, 'login', $2, CURRENT_TIMESTAMP - make_interval(days => $3))", [user, JSON.stringify({ip}), ageDays]);
        await login("81.2.69.142");
        await login("81.2.69.142");
        await login("10.0.0.5");
        await login("81.2.69.142", 100);
        await pool().query("INSERT INTO security_events (type, ip_address, bucket, count) VALUES ('login_failed', '81.2.69.142', date_trunc('minute', now()), 4), ('login_failed', '203.0.113.9', date_trunc('minute', now()), 2)");

        const res = await admin.agent.get("/api/admin/map/logins").query({days: 30});
        expect(res.status).toBe(200);
        expect(res.body.available).toBe(true);
        expect(res.body.totals).toMatchObject({logins: 3, failed: 6});
        expect(res.body.totals.unlocated).toBeGreaterThanOrEqual(1);
        const gb = res.body.points.find((p: any) => p.country === "GB");
        expect(gb).toMatchObject({logins: 2, failed: 4, accounts: 1, addresses: 1});
        expect(typeof gb.lat).toBe("number");
        expect(JSON.stringify(res.body)).not.toMatch(/Map User|map_\d+|@example\.com|81\.2\.69\.142/);

        const year = await admin.agent.get("/api/admin/map/logins").query({days: 365});
        expect(year.body.totals.logins).toBe(4);
        expect((await admin.agent.get("/api/admin/map/logins").query({days: 5})).status).toBe(400);
    });
});
