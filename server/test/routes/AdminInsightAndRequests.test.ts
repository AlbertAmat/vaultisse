import "../helpers/adminEnv";
import crypto from "crypto";
import http from "http";
import zlib from "zlib";
import {AddressInfo} from "net";
import {appService} from "../../src/AppService";
import {DataRequestService} from "../../src/admin/services/DataRequestService";
import {AnomalyService} from "../../src/admin/services/AnomalyService";
import {buildZip} from "../../src/admin/services/ZipWriter";
import {validateTarget} from "../../src/admin/services/WebhookService";
import {createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";
import {createAuthenticatedUser} from "../helpers/auth";

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();
type Admin = Awaited<ReturnType<typeof createLoggedInAdmin>>;
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(() => jest.restoreAllMocks());

const userId = async (admin: Admin, code: string) => (await admin.agent.get("/api/admin/users").query({search: code})).body.items[0].id as number;

/** Reads the files of a ZIP built by ZipWriter (local headers carry the sizes). */
function unzip(buffer: Buffer): Record<string, Buffer> {
    const files: Record<string, Buffer> = {};
    let offset = 0;
    while (buffer.readUInt32LE(offset) === 0x04034b50) {
        const compressed = buffer.readUInt32LE(offset + 18);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
        const data = buffer.subarray(offset + 30 + nameLength, offset + 30 + nameLength + compressed);
        files[name] = zlib.inflateRawSync(data);
        offset += 30 + nameLength + compressed;
    }
    return files;
}

describe("zip writer", () => {
    it("writes an archive that reads back, with the right checksums and UTF-8 names", () => {
        const zip = buildZip([{name: "a.txt", data: Buffer.from("hello world ".repeat(50))}, {name: "ñ/é.json", data: Buffer.from("{}")}]);
        expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
        const files = unzip(zip);
        expect(Object.keys(files)).toEqual(["a.txt", "ñ/é.json"]);
        expect(files["a.txt"].toString()).toBe("hello world ".repeat(50));
        expect(zlib.crc32(files["a.txt"])).toBe(zip.readUInt32LE(14));
    });
});

describe("overview charts", () => {
    it("returns what the charts need for the chosen period, and refuses other periods", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await pool().query("DELETE FROM security_events");
        await pool().query("INSERT INTO security_events (type, ip_address, bucket, count) VALUES ('login_failed', '198.51.100.1', date_trunc('minute', now()), 7), ('admin_login_failed', '198.51.100.2', date_trunc('minute', now()), 2), ('rate_limited', '198.51.100.1', date_trunc('minute', now()), 4)");
        await pool().query("INSERT INTO mail_log (to_address, subject, status) VALUES ('a@example.com', 'x', 'sent'), ('b@example.com', 'y', 'failed')");
        const res = await admin.agent.get("/api/admin/overview/charts").query({days: 7});
        expect(res.status).toBe(200);
        expect(res.body.days).toBe(7);
        for (const key of ["signups", "logins", "failedLogins", "emails", "growth"]) expect(res.body[key]).toHaveLength(7);
        const today = res.body.failedLogins[6];
        expect(today).toMatchObject({users: 7, admins: 2});
        expect(res.body.emails[6].sent).toBeGreaterThanOrEqual(1);
        expect(res.body.emails[6].failed).toBeGreaterThanOrEqual(1);
        expect(res.body.securityByType.find((t: any) => t.type === "rate_limited").total).toBe(4);
        const total = (await pool().query("SELECT COUNT(*)::int AS n FROM users")).rows[0].n;
        const s = res.body.accountStatus;
        expect(s.active + s.pending + s.disabled + s.unverified).toBe(total);
        expect(res.body.growth[6].total).toBeGreaterThanOrEqual(res.body.growth[0].total);
        expect((await admin.agent.get("/api/admin/overview/charts").query({days: 30})).body.signups).toHaveLength(30);
        expect((await admin.agent.get("/api/admin/overview/charts").query({days: 8})).status).toBe(400);
    });

    it("shows the vaults closest to their plan limits", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const owner = await createAuthenticatedUser(apps.main());
        const vault = (await pool().query("SELECT v.id FROM vault v JOIN vault_users vu ON vu.vault_id = v.id JOIN users u ON u.id = vu.user_id WHERE u.code = $1 LIMIT 1", [owner.userCode])).rows[0];
        expect(vault).toBeDefined();
        const plan = (await pool().query("INSERT INTO plans (code, name, max_members) VALUES ($1, 'Tiny', 1) RETURNING id", [`tiny_${Date.now()}`])).rows[0].id;
        await pool().query("UPDATE vault SET plan_id = $1 WHERE id = $2", [plan, vault.id]);
        const quota = (await admin.agent.get("/api/admin/overview/charts").query({days: 30})).body.quota;
        expect(quota.find((q: any) => q.id === vault.id)).toMatchObject({plan: "Tiny", percent: 100, limiting: "members"});
        const plans = (await admin.agent.get("/api/admin/overview/charts").query({days: 30})).body.plans;
        expect(plans.find((p: any) => p.name === "Tiny").vaults).toBeGreaterThanOrEqual(1);
    });
});

describe("support notes and tags", () => {
    it("keeps private notes and tags on an account, filters by tag, and audits every change", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        const id = await userId(admin, user.userCode);

        const note = await admin.agent.post(`/api/admin/users/${id}/notes`).send({body: "Asked for a refund by phone"});
        expect(note.status).toBe(201);
        expect(note.body.notes[0]).toMatchObject({body: "Asked for a refund by phone", createdBy: admin.email});
        expect((await admin.agent.post(`/api/admin/users/${id}/notes`).send({body: "  "})).status).toBe(400);

        const tags = await admin.agent.put(`/api/admin/users/${id}/tags`).send({tags: ["VIP", " pending refund ", "vip"]});
        expect(tags.status).toBe(200);
        expect(tags.body.tags).toEqual(["vip", "pending-refund"]);
        expect((await admin.agent.put(`/api/admin/users/${id}/tags`).send({tags: ["<script>"]})).status).toBe(400);
        expect((await admin.agent.put(`/api/admin/users/${id}/tags`).send({tags: "vip"})).status).toBe(400);

        const detail = (await admin.agent.get(`/api/admin/users/${id}`)).body;
        expect(detail.notes).toHaveLength(1);
        expect(detail.user.tags.sort()).toEqual(["pending-refund", "vip"]);
        const listed = (await admin.agent.get("/api/admin/users").query({tag: "vip"})).body;
        expect(listed.items.map((u: any) => u.id)).toContain(id);
        expect(listed.items.find((u: any) => u.id === id)).toMatchObject({noteCount: 1});
        expect((await admin.agent.get("/api/admin/users").query({tag: "nobody-has-this"})).body.items).toHaveLength(0);
        expect((await admin.agent.get("/api/admin/users/tags")).body.items.find((t: any) => t.tag === "vip").count).toBeGreaterThanOrEqual(1);

        // The user never sees any of it.
        expect(JSON.stringify((await user.agent.get("/api/rest/user")).body)).not.toMatch(/refund|vip/i);

        const audit = (await admin.agent.get("/api/admin/logs/audit").query({action: "user."})).body.items.map((e: any) => e.action);
        expect(audit).toEqual(expect.arrayContaining(["user.note_add", "user.tags"]));
        expect((await admin.agent.delete(`/api/admin/users/${id}/notes/${detail.notes[0].id}`)).status).toBe(200);
        expect((await admin.agent.delete(`/api/admin/users/${id}/notes/${detail.notes[0].id}`)).status).toBe(404);
    });

    it("lets a read-only admin read but not write", async () => {
        const reader = await createLoggedInAdmin(apps.admin(), "readonly");
        const user = await createAuthenticatedUser(apps.main());
        const id = (await pool().query("SELECT id FROM users WHERE code = $1", [user.userCode])).rows[0].id;
        expect((await reader.agent.get(`/api/admin/users/${id}`)).status).toBe(200);
        expect((await reader.agent.post(`/api/admin/users/${id}/notes`).send({body: "x"})).status).toBe(403);
        expect((await reader.agent.put(`/api/admin/users/${id}/tags`).send({tags: ["x"]})).status).toBe(403);
    });
});

describe("data requests", () => {
    it("tracks an access request against its one-month deadline and exports the personal data without credentials", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main(), "Data Subject");
        const id = await userId(admin, user.userCode);
        await admin.agent.post(`/api/admin/users/${id}/notes`).send({body: "Private admin note"});

        const created = await admin.agent.post("/api/admin/data-requests").send({kind: "access", email: user.email.toUpperCase(), notes: "Asked by email"});
        expect(created.status).toBe(201);
        const request = created.body.item;
        expect(request).toMatchObject({kind: "access", status: "open", userId: id, subjectEmail: user.email.toUpperCase()});
        const days = (new Date(request.dueAt).getTime() - new Date(request.receivedAt).getTime()) / 86400000;
        expect(days).toBeGreaterThanOrEqual(28);
        expect(days).toBeLessThanOrEqual(31);
        expect(request.daysLeft).toBeGreaterThan(26);
        expect((await admin.agent.post("/api/admin/data-requests").send({kind: "access", email: "not-an-email"})).status).toBe(400);
        expect((await admin.agent.post("/api/admin/data-requests").send({kind: "nope", email: "a@example.com"})).status).toBe(400);

        // The export is a sensitive download: it needs a fresh verification, then a one-time link.
        expect((await admin.agent.post(`/api/admin/data-requests/export/${id}`).send({})).status).toBe(403);
        await admin.reauth();
        const ticket = await admin.agent.post(`/api/admin/data-requests/export/${id}`).send({});
        expect(ticket.status).toBe(200);
        const download = () => admin.agent.get(ticket.body.url).buffer(true).parse((res, done) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => done(null, Buffer.concat(chunks)));
        });
        const exported = await download();
        expect(exported.status).toBe(200);
        expect(exported.headers["content-type"]).toBe("application/zip");
        expect(exported.headers["content-disposition"]).toContain(`personal-data-${user.userCode}`);
        const files = unzip(exported.body as Buffer);
        expect(Object.keys(files)).toEqual(expect.arrayContaining(["README.txt", "account.json", "vault-memberships.json", "sign-in-sessions.json", "activity-log.json", "terms-acknowledgements.json", "emails-sent.json", "admin-notes.json", "data-requests.json"]));
        const account = JSON.parse(files["account.json"].toString());
        expect(account).toMatchObject({code: user.userCode, name: "Data Subject", email: user.email});
        expect(Object.keys(account)).not.toEqual(expect.arrayContaining(["password", "totp_secret", "opds_token_hash"]));
        const everything = Object.values(files).map((f) => f.toString("latin1")).join("\n");
        expect(everything).not.toMatch(/\$2[aby]\$/); // no bcrypt hash anywhere
        expect(JSON.parse(files["admin-notes.json"].toString()).notes[0].note).toBe("Private admin note");
        expect(JSON.parse(files["sign-in-sessions.json"].toString()).length).toBeGreaterThanOrEqual(1);
        expect(files["README.txt"].toString()).toMatch(/contents of your vaults/);
        expect((await admin.agent.get("/api/admin/logs/audit").query({action: "data_request.export"})).body.items.length).toBeGreaterThanOrEqual(1);
        // Single use, and useless to anyone else.
        expect((await admin.agent.get(ticket.body.url)).status).toBe(404);
        const other = await createLoggedInAdmin(apps.admin());
        await admin.reauth();
        const second = await admin.agent.post(`/api/admin/data-requests/export/${id}`).send({});
        expect((await other.agent.get(second.body.url)).status).toBe(404);

        const closed = await admin.agent.post(`/api/admin/data-requests/${request.id}/close`).send({outcome: "completed", resolution: "Export sent by email"});
        expect(closed.body.item).toMatchObject({status: "completed", resolution: "Export sent by email"});
        expect((await admin.agent.post(`/api/admin/data-requests/${request.id}/close`).send({outcome: "completed"})).status).toBe(409);
    });

    it("extends a deadline once with a reason, and refuses a refusal without one", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const created = (await admin.agent.post("/api/admin/data-requests").send({kind: "access", email: "stranger@example.com", name: "Stranger", receivedAt: new Date(Date.now() - 20 * 86400000).toISOString()})).body.item;
        expect(created.userId).toBeNull();
        expect((await admin.agent.post(`/api/admin/data-requests/${created.id}/extend`).send({})).status).toBe(400);
        const extended = await admin.agent.post(`/api/admin/data-requests/${created.id}/extend`).send({reason: "Complex request"});
        expect(extended.status).toBe(200);
        const months = (new Date(extended.body.item.dueAt).getTime() - new Date(created.receivedAt).getTime()) / 86400000;
        expect(months).toBeGreaterThanOrEqual(88);
        expect((await admin.agent.post(`/api/admin/data-requests/${created.id}/extend`).send({reason: "again"})).status).toBe(409);
        expect((await admin.agent.post(`/api/admin/data-requests/${created.id}/close`).send({outcome: "rejected"})).status).toBe(400);
        expect((await admin.agent.post(`/api/admin/data-requests/${created.id}/close`).send({outcome: "rejected", resolution: "Identity could not be verified"})).body.item.status).toBe("rejected");
        // An erasure of somebody with no account can't be carried out by the portal.
        const orphan = (await admin.agent.post("/api/admin/data-requests").send({kind: "erasure", email: "ghost@example.com"})).body.item;
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/data-requests/${orphan.id}/erase`).send({})).status).toBe(409);
    });

    it("carries out an erasure through the deletion flow and closes the request once the account is gone", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main(), "Erase Me");
        const id = await userId(admin, user.userCode);
        const request = (await admin.agent.post("/api/admin/data-requests").send({kind: "erasure", userId: id})).body.item;

        await admin.reauth();
        const scheduled = await admin.agent.post(`/api/admin/data-requests/${request.id}/erase`).send({});
        expect(scheduled.status).toBe(200);
        expect(scheduled.body.item.status).toBe("processing");
        expect(scheduled.body.item.deletionScheduledFor).not.toBeNull();
        // Not an access request: the export button and "erase" make sense for the right kind only.
        const access = (await admin.agent.post("/api/admin/data-requests").send({kind: "access", userId: id})).body.item;
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/data-requests/${access.id}/erase`).send({})).status).toBe(400);

        await admin.reauth();
        const done = await admin.agent.post(`/api/admin/data-requests/${request.id}/erase`).send({immediate: true});
        expect([200, 409]).toContain(done.status);
        if (done.status === 200) {
            const after = (await admin.agent.get("/api/admin/data-requests").query({status: "completed"})).body.items.find((r: any) => r.id === request.id);
            expect(after).toMatchObject({status: "completed", userId: null, resolution: "The account was erased."});
            expect(after.subjectEmail).toBe(user.email);
        }
    });

    it("counts overdue requests against the compliance score", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await pool().query("DELETE FROM data_requests");
        const control = async () => (await admin.agent.get("/api/admin/compliance")).body.controls.find((c: any) => c.id === "A.5.34");
        expect((await control()).measured.state).not.toBe("fail");
        await admin.agent.post("/api/admin/data-requests").send({kind: "access", email: "late@example.com", receivedAt: new Date(Date.now() - 60 * 86400000).toISOString()});
        const late = await control();
        expect(late.measured).toMatchObject({state: "fail"});
        expect(late.measured.detail).toMatch(/past the one-month deadline/);
    });

    it("reminds the admins about requests near their deadline", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await pool().query("DELETE FROM data_requests");
        await admin.agent.post("/api/admin/data-requests").send({kind: "erasure", email: "soon@example.com", receivedAt: new Date(Date.now() - 27 * 86400000).toISOString()});
        const notify = jest.spyOn(appService.getNotifier(), "notify").mockResolvedValue(true);
        await new DataRequestService(pool(), null as any).remind();
        const call = notify.mock.calls.find(([, request]) => request.event === "data_request.due");
        expect(call?.[0]).toBe("data_requests");
        expect(call?.[1].title).toMatch(/due in/);
    });
});

describe("webhooks", () => {
    let server: http.Server;
    let url: string;
    const received: {headers: http.IncomingHttpHeaders; body: any; raw: string}[] = [];

    beforeAll(async () => {
        process.env.ALLOW_HTTP = "true";
        process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE = "true";
        server = http.createServer((req, res) => {
            let raw = "";
            req.on("data", (c) => (raw += c));
            req.on("end", () => {
                received.push({headers: req.headers, body: JSON.parse(raw || "{}"), raw});
                res.writeHead(req.url === "/fail" ? 500 : 200).end("ok");
            });
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
        delete process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE;
        await new Promise((resolve) => server.close(resolve));
    });
    beforeEach(async () => {
        received.length = 0;
        await pool().query("DELETE FROM webhooks");
    });

    it("only accepts targets that can reach the place they are meant for", () => {
        expect(() => validateTarget("slack", {url: "https://hooks.slack.com/services/T0/B0/xxxx"})).not.toThrow();
        expect(() => validateTarget("slack", {url: "https://evil.example.com/services/T0/B0/xxxx"})).toThrow(/Slack webhook/);
        expect(() => validateTarget("slack", {url: "https://hooks.slack.com.evil.com/services/T0"})).toThrow();
        expect(() => validateTarget("discord", {url: "https://discord.com/api/webhooks/123/abc"})).not.toThrow();
        expect(() => validateTarget("discord", {url: "https://discord.com.evil.com/api/webhooks/123/abc"})).toThrow();
        expect(() => validateTarget("telegram", {token: "123456:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789", chatId: "-1001234567"})).not.toThrow();
        expect(() => validateTarget("telegram", {token: "nope", chatId: "-100123"})).toThrow(/bot token/);
        expect(() => validateTarget("telegram", {token: "123456:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789", chatId: "me"})).toThrow(/chat id/);
        expect(() => validateTarget("generic", {url: "ftp://example.com"})).toThrow();
        expect(() => validateTarget("generic", {url: "https://user:pass@example.com/x"})).toThrow(/credentials/);
    });

    it("refuses private targets unless that was allowed on purpose", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE = "false";
        await admin.reauth();
        const made = await admin.agent.post("/api/admin/webhooks").send({name: "Internal", kind: "generic", url: `${url}/hook`, events: ["account.created"]});
        expect(made.status).toBe(201);
        const test = await admin.agent.post(`/api/admin/webhooks/${made.body.item.id}/test`).send({});
        expect(test.body).toMatchObject({ok: false});
        expect(test.body.error).toMatch(/private or local/);
        expect(received).toHaveLength(0);
        process.env.ADMIN_WEBHOOKS_ALLOW_PRIVATE = "true";
    });

    it("sends signed events to subscribers only, hides the secret, logs deliveries and honours disable", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await admin.agent.post("/api/admin/webhooks").send({name: "x", kind: "generic", url, events: ["account.created"]})).status).toBe(403); // needs fresh verification
        await admin.reauth();
        expect((await admin.agent.post("/api/admin/webhooks").send({name: "x", kind: "carrier-pigeon", url, events: ["account.created"]})).status).toBe(400);
        await admin.reauth();
        expect((await admin.agent.post("/api/admin/webhooks").send({name: "x", kind: "generic", url, events: ["not.an.event"]})).status).toBe(400);
        await admin.reauth();
        const made = await admin.agent.post("/api/admin/webhooks").send({name: "Ops hook", kind: "generic", url: `${url}/secret-path-123`, secret: "s3cret-signing-key", events: ["incident.opened", "ip.blocked"]});
        expect(made.status).toBe(201);
        expect(JSON.stringify(made.body)).not.toMatch(/s3cret-signing-key|secret-path-123/);
        const id = made.body.item.id;
        const stored = (await pool().query("SELECT target FROM webhooks WHERE id = $1", [id])).rows[0].target;
        expect(stored).toMatch(/^enc:v1:/);
        expect(stored).not.toContain("secret-path-123");

        // An incident is announced; an account registration is not (not subscribed).
        await admin.agent.post("/api/admin/compliance/incidents").send({title: "Leaked backup", severity: "high", personalData: true});
        await createAuthenticatedUser(apps.main());
        await settle();
        expect(received).toHaveLength(1);
        const hit = received[0];
        expect(hit.body).toMatchObject({event: "incident.opened", title: "Security incident (high): Leaked backup"});
        expect(hit.body.instance).toBe(appService.getInstanceUuid());
        expect(hit.headers["x-vaultisse-event"]).toBe("incident.opened");
        expect(hit.headers["x-vaultisse-signature"]).toBe(`sha256=${crypto.createHmac("sha256", "s3cret-signing-key").update(hit.raw).digest("hex")}`);

        await admin.agent.post("/api/admin/security/blocked-ips").send({ip: "198.51.100.200", reason: "scanner", hours: 1});
        await settle();
        expect(received.map((r) => r.body.event)).toEqual(["incident.opened", "ip.blocked"]);

        const list = (await admin.agent.get("/api/admin/webhooks")).body;
        expect(list.events.length).toBeGreaterThan(8);
        expect(list.items[0]).toMatchObject({name: "Ops hook", kind: "generic", enabled: true, lastStatus: "sent"});
        expect(list.items[0].targetHint).toMatch(/127\.0\.0\.1/);
        const deliveries = (await admin.agent.get(`/api/admin/webhooks/${id}/deliveries`)).body.items;
        expect(deliveries.map((d: any) => d.event).sort()).toEqual(["incident.opened", "ip.blocked"]);

        // Pause it: nothing more arrives.
        expect((await admin.agent.patch(`/api/admin/webhooks/${id}`).send({enabled: false})).body.item.enabled).toBe(false);
        await admin.agent.post("/api/admin/compliance/incidents").send({title: "Another", severity: "low"});
        await settle();
        expect(received).toHaveLength(2);

        // Rename without touching the target (no fresh verification needed), then remove.
        expect((await admin.agent.put(`/api/admin/webhooks/${id}`).send({name: "Renamed", events: ["incident.opened"]})).body.item).toMatchObject({name: "Renamed", events: ["incident.opened"]});
        expect((await admin.agent.delete(`/api/admin/webhooks/${id}`)).status).toBe(200);
        expect((await admin.agent.delete(`/api/admin/webhooks/${id}`)).status).toBe(404);
    });

    it("records a failing delivery and the test button reports it", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.reauth();
        const made = await admin.agent.post("/api/admin/webhooks").send({name: "Broken", kind: "generic", url: `${url}/fail`, events: ["system.alert"]});
        const test = await admin.agent.post(`/api/admin/webhooks/${made.body.item.id}/test`).send({});
        expect(test.body).toMatchObject({ok: false});
        expect(test.body.error).toMatch(/HTTP 500/);
        const item = (await admin.agent.get("/api/admin/webhooks")).body.items[0];
        expect(item).toMatchObject({lastStatus: "failed"});
        expect((await admin.agent.post("/api/admin/webhooks/999999/test").send({})).status).toBe(404);
    });

    it("announces new accounts and forwards the alerts the portal raises, even with email off", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.reauth();
        await admin.agent.post("/api/admin/webhooks").send({name: "All", kind: "generic", url, events: ["account.created", "anomaly.detected"]});
        const user = await createAuthenticatedUser(apps.main(), "Fresh Face");
        await appService.getNotifier().notify("anomaly", {title: "Burst", lines: ["many"]});
        await settle();
        const events = received.map((r) => r.body.event);
        expect(events).toContain("account.created");
        expect(events).toContain("anomaly.detected");
        const created = received.find((r) => r.body.event === "account.created")!;
        expect(created.body.title).toContain(user.userCode);
        // No email address is sent to a third party.
        expect(created.raw).not.toContain(user.email);
    });
});

describe("admin sessions", () => {
    it("lists live sessions, marks the current one, and ends somebody else's with a fresh verification", async () => {
        const boss = await createLoggedInAdmin(apps.admin());
        const other = await createLoggedInAdmin(apps.admin());
        const reader = await createLoggedInAdmin(apps.admin(), "readonly");

        const all = (await boss.agent.get("/api/admin/admins/sessions")).body.items;
        expect(all.find((s: any) => s.adminEmail === boss.email)).toMatchObject({current: true});
        const theirs = all.find((s: any) => s.adminEmail === other.email);
        expect(theirs).toMatchObject({current: false});
        expect(theirs).toHaveProperty("country");
        const own = (await reader.agent.get("/api/admin/admins/sessions")).body.items;
        expect(own.every((s: any) => s.adminEmail === reader.email)).toBe(true);

        expect((await boss.agent.post(`/api/admin/admins/sessions/${theirs.id}/revoke`).send({})).status).toBe(403);
        await boss.reauth();
        const mine = all.find((s: any) => s.current);
        expect((await boss.agent.post(`/api/admin/admins/sessions/${mine.id}/revoke`).send({})).status).toBe(400);
        expect((await boss.agent.post(`/api/admin/admins/sessions/${theirs.id}/revoke`).send({})).status).toBe(200);
        expect((await boss.agent.post(`/api/admin/admins/sessions/${theirs.id}/revoke`).send({})).status).toBe(404);
        expect((await other.agent.get("/api/admin/overview")).status).toBe(401);
        expect((await boss.agent.get("/api/admin/overview")).status).toBe(200);
        expect((await reader.agent.post(`/api/admin/admins/sessions/${mine.id}/revoke`).send({})).status).toBe(403);
        expect((await boss.agent.get("/api/admin/logs/audit").query({action: "admin.session_revoke"})).body.items[0]).toMatchObject({entityLabel: other.email});
    });
});

describe("anomaly alerts", () => {
    const service = () => new AnomalyService(pool(), appService.getLogger());
    const GB = "81.2.69.142";
    const JP = "202.12.27.33";
    const FR = "62.4.2.1";

    it("tells the admins when an admin signs in from a country that admin never used", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const adminId = (await pool().query("SELECT id FROM admin_users WHERE email = $1", [admin.email])).rows[0].id;
        // The admin's own history: every session so far was from the United Kingdom.
        await pool().query("UPDATE admin_sessions SET ip_address = $2 WHERE admin_id = $1", [adminId, GB]);
        const notify = jest.spyOn(appService.getNotifier(), "notify").mockResolvedValue(true);

        await service().adminSignedIn({id: adminId, email: admin.email}, GB, new Date());
        expect(notify).not.toHaveBeenCalled();
        await service().adminSignedIn({id: adminId, email: admin.email}, "10.0.0.8", new Date());
        expect(notify).not.toHaveBeenCalled();
        await service().adminSignedIn({id: adminId, email: admin.email}, JP, new Date());
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0]).toBe("anomaly");
        expect(notify.mock.calls[0][1]).toMatchObject({event: "admin.login_new_country", dedupeKey: `admin-country:${adminId}:JP`});
        expect(notify.mock.calls[0][1].title).toContain("Japan");
        expect(notify.mock.calls[0][1].lines.join(" ")).toContain("United Kingdom");
        const audited = await boss(admin).get("/api/admin/logs/audit").query({action: "admin.login_new_country"});
        expect(audited.body.items[0].entityLabel).toBe(admin.email);

        // No history at all: the first sign-in is never "new".
        notify.mockClear();
        await service().adminSignedIn({id: 987654321, email: "new@example.com"}, FR, new Date());
        expect(notify).not.toHaveBeenCalled();
    });

    const boss = (admin: Admin) => admin.agent;

    it("spots users signing in from a country nobody used in months, once", async () => {
        await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        const id = (await pool().query("SELECT id FROM users WHERE code = $1", [user.userCode])).rows[0].id;
        await pool().query("DELETE FROM activity_log WHERE action = 'login'");
        const notify = jest.spyOn(appService.getNotifier(), "notify").mockResolvedValue(true);
        const login = (ip: string, ago: string) => pool().query("INSERT INTO activity_log (actor_id, action, metadata, created_date) VALUES ($1, 'login', $2, NOW() - $3::interval)", [id, JSON.stringify({ip}), ago]);

        // A young installation has nothing to compare with.
        await login(JP, "5 minutes");
        await service().check();
        expect(notify).not.toHaveBeenCalled();

        await login(GB, "40 days");
        await login(GB, "10 minutes");
        await service().check();
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][1]).toMatchObject({dedupeKey: "country:JP", cooldownMs: 14 * 86400000});
        expect(notify.mock.calls[0][1].title).toContain("Japan");
    });

    it("spots a burst of new accounts", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await admin.reauth();
        await admin.agent.put("/api/admin/settings").send({changes: {ADMIN_NOTIFY_ANOMALY_SIGNUPS_PER_HOUR: "2"}});
        const notify = jest.spyOn(appService.getNotifier(), "notify").mockResolvedValue(true);
        try {
            await pool().query("UPDATE users SET created_date = NOW() - INTERVAL '2 days'");
            await pool().query("DELETE FROM activity_log WHERE action = 'login'");
            await createAuthenticatedUser(apps.main());
            await service().check();
            expect(notify.mock.calls.find(([, r]) => r.dedupeKey === "signup-burst")).toBeUndefined();
            await createAuthenticatedUser(apps.main());
            await createAuthenticatedUser(apps.main());
            await service().check();
            const burst = notify.mock.calls.find(([, r]) => r.dedupeKey === "signup-burst");
            expect(burst?.[1].title).toMatch(/burst of new accounts: 3/);
        } finally {
            await admin.reauth();
            await admin.agent.put("/api/admin/settings").send({changes: {ADMIN_NOTIFY_ANOMALY_SIGNUPS_PER_HOUR: null}});
        }
    });
});
