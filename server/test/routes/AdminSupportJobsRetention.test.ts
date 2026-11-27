import "../helpers/adminEnv";
import {appService} from "../../src/AppService";
import {createLoggedInAdmin, setupAdminTestApp} from "../helpers/adminAuth";
import {createAuthenticatedUser, ITestUser} from "../helpers/auth";

const apps = setupAdminTestApp();
const pool = () => appService.getDatabasePool();
type Admin = Awaited<ReturnType<typeof createLoggedInAdmin>>;
afterEach(() => jest.restoreAllMocks());

const userId = async (code: string) => (await pool().query("SELECT id FROM users WHERE code = $1", [code])).rows[0].id as number;
const vaultOf = async (user: ITestUser) => (await pool().query(
    "SELECT v.id, v.name FROM vault v JOIN vault_users vu ON vu.vault_id = v.id WHERE vu.user_id = $1 ORDER BY v.id LIMIT 1", [await userId(user.userCode)])).rows[0] as {id: number; name: string};
const setSettings = (admin: Admin, changes: Record<string, string | null>) => admin.agent.put("/api/admin/settings").send({changes});

describe("background jobs", () => {
    it("lists every job and records a manual run with who started it", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const list = (await admin.agent.get("/api/admin/jobs")).body.items;
        const ids = list.map((j: any) => j.id);
        expect(ids).toEqual(expect.arrayContaining(["health-checks", "deletions", "retention", "data-requests", "anomalies", "update-check", "inactive-accounts"]));
        expect(list.find((j: any) => j.id === "deletions")).toMatchObject({dangerous: true, schedule: "Every hour", running: false});

        const run = await admin.agent.post("/api/admin/jobs/anomalies/run").send({});
        expect(run.status).toBe(200);
        expect(run.body.run).toMatchObject({jobId: "anomalies", trigger: "manual", status: "ok", message: "Checked", runBy: admin.email});
        expect(run.body.run.durationMs).toBeGreaterThanOrEqual(0);
        const after = (await admin.agent.get("/api/admin/jobs")).body.items.find((j: any) => j.id === "anomalies");
        expect(after.lastRun).toMatchObject({status: "ok", trigger: "manual"});
        expect(new Date(after.nextRunAt).getTime()).toBeGreaterThan(Date.now());
        const history = (await admin.agent.get("/api/admin/jobs/anomalies/history")).body.items;
        expect(history[0].id).toBe(run.body.run.id);
        expect((await admin.agent.get("/api/admin/jobs/nope/history")).status).toBe(404);
        expect((await admin.agent.post("/api/admin/jobs/nope/run").send({})).status).toBe(404);
        expect((await admin.agent.get("/api/admin/logs/audit").query({action: "job.run"})).body.items[0]).toMatchObject({entityLabel: "anomalies"});
    });

    it("asks for a fresh verification before running a job that deletes data, and lets a read-only admin only look", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        expect((await admin.agent.post("/api/admin/jobs/deletions/run").send({})).status).toBe(403);
        await admin.reauth();
        const run = await admin.agent.post("/api/admin/jobs/deletions/run").send({});
        expect(run.status).toBe(200);
        expect(run.body.run.status).toBe("ok");
        const reader = await createLoggedInAdmin(apps.admin(), "readonly");
        expect((await reader.agent.get("/api/admin/jobs")).status).toBe(200);
        expect((await reader.agent.post("/api/admin/jobs/anomalies/run").send({})).status).toBe(403);
    });

    it("records a failure with its message, alerts the admins once, and shows it in the overview", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const jobs = appService.getJobs();
        jobs.register({id: "boom", name: "Broken job", description: "x", schedule: "Never", everyMs: 1000, run: async () => { throw new Error("the disk is full"); }});
        const notify = jest.spyOn(appService.getNotifier(), "notify").mockResolvedValue(true);
        const run = await admin.agent.post("/api/admin/jobs/boom/run").send({});
        expect(run.status).toBe(200);
        expect(run.body.run).toMatchObject({status: "failed", message: "the disk is full"});
        expect(notify).toHaveBeenCalledWith("jobs", expect.objectContaining({dedupeKey: "job:boom", title: expect.stringContaining("Broken job")}));
        const listed = (await admin.agent.get("/api/admin/jobs")).body.items.find((j: any) => j.id === "boom");
        expect(listed.recentFailures).toBeGreaterThanOrEqual(1);
        expect((await admin.agent.get("/api/admin/overview")).body.counts.failedJobs).toBeGreaterThanOrEqual(1);
        const control = (await admin.agent.get("/api/admin/compliance")).body.controls.find((c: any) => c.id === "A.8.16");
        expect(control.measured).toMatchObject({state: "warn"});
        expect(control.measured.detail).toMatch(/background job/);
        // A later good run clears it.
        jobs.register({id: "boom", name: "Broken job", description: "x", schedule: "Never", everyMs: 1000, run: async () => "fixed"});
        await admin.agent.post("/api/admin/jobs/boom/run").send({});
        expect((await admin.agent.get("/api/admin/jobs")).body.items.find((j: any) => j.id === "boom").lastRun.status).toBe("ok");
    });

    it("refuses to start a job that is already running, and a scheduled run skips it quietly", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const jobs = appService.getJobs();
        let release: () => void = () => undefined;
        jobs.register({id: "slow", name: "Slow job", description: "x", schedule: "Never", everyMs: 1000, run: () => new Promise<string>((resolve) => { release = () => resolve("done"); })});
        const first = admin.agent.post("/api/admin/jobs/slow/run").send({}).then((r) => r);
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect((await admin.agent.get("/api/admin/jobs")).body.items.find((j: any) => j.id === "slow").running).toBe(true);
        expect((await admin.agent.post("/api/admin/jobs/slow/run").send({})).status).toBe(409);
        await jobs.runScheduled("slow");
        release();
        expect((await first).body.run.message).toBe("done");
        expect((await pool().query("SELECT COUNT(*)::int AS n FROM job_runs WHERE job_id = 'slow'")).rows[0].n).toBe(1);
    });
});

describe("data retention", () => {
    const old = (days: number) => `NOW() - INTERVAL '${days} days'`;

    it("shows each period, how much there is and how much is already past it", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const res = await admin.agent.get("/api/admin/retention");
        expect(res.status).toBe(200);
        expect(res.body.auditFloorDays).toBe(90);
        const byId = Object.fromEntries(res.body.items.map((i: any) => [i.id, i]));
        expect(Object.keys(byId)).toEqual(expect.arrayContaining(["activity_log", "security_events", "mail_log", "admin_notifications", "webhook_deliveries", "job_runs", "admin_audit_log"]));
        expect(byId.activity_log).toMatchObject({days: 0, defaultDays: 0, personal: true});
        expect(byId.mail_log).toMatchObject({days: 90, defaultDays: 90});
        expect(byId.admin_audit_log.minDays).toBe(90);

        await pool().query(`INSERT INTO mail_log (to_address, subject, status, created_date) VALUES ('a@example.com', 'old one', 'sent', ${old(200)})`);
        await setSettings(admin, {RETENTION_MAIL_LOG_DAYS: "30"});
        try {
            const after = (await admin.agent.get("/api/admin/retention")).body.items.find((i: any) => i.id === "mail_log");
            expect(after.days).toBe(30);
            expect(after.overdue).toBeGreaterThanOrEqual(1);
            expect(new Date(after.oldest).getTime()).toBeLessThan(Date.now() - 190 * 86400000);
        } finally {
            await setSettings(admin, {RETENTION_MAIL_LOG_DAYS: null});
        }
    });

    it("the purge job deletes what is past its period, keeps the rest, and keeps what has no period", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await pool().query("DELETE FROM mail_log");
        await pool().query(`INSERT INTO mail_log (to_address, subject, status, created_date) VALUES ('a@example.com', 'ancient', 'sent', ${old(120)}), ('b@example.com', 'fresh', 'sent', ${old(2)})`);
        await pool().query(`INSERT INTO activity_log (action, metadata, created_date) VALUES ('login', '{"ip":"198.51.100.1"}', ${old(900)})`);
        await setSettings(admin, {RETENTION_MAIL_LOG_DAYS: "30"});
        try {
            await admin.reauth();
            const run = await admin.agent.post("/api/admin/jobs/retention/run").send({});
            expect(run.body.run.status).toBe("ok");
            expect(run.body.run.message).toMatch(/Removed 1 from mail log/);
            expect((await pool().query("SELECT subject FROM mail_log")).rows.map((r) => r.subject)).toEqual(["fresh"]);
            // The activity log has no period by default: nothing of it is removed.
            expect((await pool().query("SELECT COUNT(*)::int AS n FROM activity_log WHERE created_date < NOW() - INTERVAL '800 days'")).rows[0].n).toBeGreaterThanOrEqual(1);
            await setSettings(admin, {RETENTION_ACTIVITY_LOG_DAYS: "365"});
            await admin.reauth();
            const second = await admin.agent.post("/api/admin/jobs/retention/run").send({});
            expect(second.body.run.message).toMatch(/from activity log/);
            expect((await pool().query("SELECT COUNT(*)::int AS n FROM activity_log WHERE created_date < NOW() - INTERVAL '800 days'")).rows[0].n).toBe(0);
        } finally {
            await setSettings(admin, {RETENTION_MAIL_LOG_DAYS: null, RETENTION_ACTIVITY_LOG_DAYS: null});
        }
    });

    it("lets the audit trail shrink only after 90 days, only through the setting, and records that it did", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        // The database itself refuses to touch the trail.
        await expect(pool().query("DELETE FROM admin_audit_log WHERE id = (SELECT MIN(id) FROM admin_audit_log)")).rejects.toThrow(/append-only/);
        await pool().query(`INSERT INTO admin_audit_log (action, created_date) VALUES ('test.ancient', ${old(150)}), ('test.recent', ${old(20)})`);
        const client = await pool().connect();
        try {
            await client.query("BEGIN");
            await client.query("SET LOCAL vaultisse.audit_retention = 'on'");
            // Even with the switch on, a young entry stays.
            await expect(client.query("DELETE FROM admin_audit_log WHERE action = 'test.recent'")).rejects.toThrow(/append-only/);
        } finally {
            await client.query("ROLLBACK");
            client.release();
        }
        expect((await setSettings(admin, {RETENTION_AUDIT_DAYS: "30"})).status).toBe(400);
        expect((await setSettings(admin, {RETENTION_AUDIT_DAYS: "90"})).status).toBe(200);
        try {
            await admin.reauth();
            const run = await admin.agent.post("/api/admin/jobs/retention/run").send({});
            expect(run.body.run.message).toMatch(/from admin audit log/);
            const actions = (await pool().query("SELECT action FROM admin_audit_log WHERE action LIKE 'test.%'")).rows.map((r) => r.action);
            expect(actions).toEqual(["test.recent"]);
            expect((await admin.agent.get("/api/admin/logs/audit").query({action: "retention.purge"})).body.items[0].metadata).toMatchObject({olderThanDays: 90});
        } finally {
            await setSettings(admin, {RETENTION_AUDIT_DAYS: null});
        }
    });

    it("flags a sign-in log that is kept forever on the compliance page", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        await pool().query("DELETE FROM data_requests");
        const control = async () => (await admin.agent.get("/api/admin/compliance")).body.controls.find((c: any) => c.id === "A.5.34");
        expect((await control()).measured).toMatchObject({state: "warn"});
        expect((await control()).measured.detail).toMatch(/kept forever/);
        await setSettings(admin, {RETENTION_ACTIVITY_LOG_DAYS: "365"});
        try {
            expect((await control()).measured.detail).not.toMatch(/sign-in log/);
        } finally {
            await setSettings(admin, {RETENTION_ACTIVITY_LOG_DAYS: null});
        }
    });
});

describe("change an email address", () => {
    it("changes it, tells nobody it can't, refuses duplicates and keeps full addresses out of the audit trail", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const user = await createAuthenticatedUser(apps.main());
        const other = await createAuthenticatedUser(apps.main());
        const id = await userId(user.userCode);
        const newEmail = `new_${Date.now()}@example.org`;

        expect((await admin.agent.post(`/api/admin/users/${id}/email`).send({email: newEmail})).status).toBe(403); // fresh verification
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/users/${id}/email`).send({email: "not an email"})).status).toBe(400);
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/users/${id}/email`).send({email: user.email.toUpperCase()})).status).toBe(400);
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/users/${id}/email`).send({email: other.email})).status).toBe(409);
        await admin.reauth();
        const done = await admin.agent.post(`/api/admin/users/${id}/email`).send({email: newEmail});
        expect(done.status).toBe(200);
        // Email is not set up in tests, so nobody can verify: the address counts as verified.
        expect(done.body).toMatchObject({email: newEmail, verified: true, notified: false});
        expect(done.body.user.email).toBe(newEmail);
        expect((await pool().query("SELECT email, email_verified FROM users WHERE id = $1", [id])).rows[0]).toMatchObject({email: newEmail, email_verified: true});

        const audit = (await admin.agent.get("/api/admin/logs/audit").query({action: "user.change_email"})).body.items[0];
        expect(audit.entityLabel).toBe(user.userCode);
        expect(JSON.stringify(audit)).not.toContain(newEmail);
        expect(JSON.stringify(audit)).not.toContain(user.email);
        expect(audit.metadata.to).toMatch(/^n\*\*\*@example\.org$/);
    });
});

describe("transfer a vault", () => {
    const addMember = (vaultId: number, id: number, role: number, status: number) =>
        pool().query("INSERT INTO vault_users (vault_id, user_id, role, status) VALUES ($1, $2, $3, $4)", [vaultId, id, role, status]);
    const roleOf = async (vaultId: number, id: number) => (await pool().query("SELECT role FROM vault_users WHERE vault_id = $1 AND user_id = $2", [vaultId, id])).rows[0]?.role;

    it("makes another member the admin and demotes, keeps or removes the previous admin", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const owner = await createAuthenticatedUser(apps.main());
        const heir = await createAuthenticatedUser(apps.main());
        const pending = await createAuthenticatedUser(apps.main());
        const vault = await vaultOf(owner);
        const ownerId = await userId(owner.userCode);
        const heirId = await userId(heir.userCode);
        await addMember(vault.id, heirId, 0, 1);
        await addMember(vault.id, await userId(pending.userCode), 0, 0);

        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/vaults/${vault.id}/transfer`).send({toUserId: await userId(pending.userCode)})).status).toBe(409);
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/vaults/${vault.id}/transfer`).send({toUserId: 999999})).status).toBe(400);
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/vaults/${vault.id}/transfer`).send({toUserId: heirId, previous: "burn"})).status).toBe(400);

        await admin.reauth();
        const kept = await admin.agent.post(`/api/admin/vaults/${vault.id}/transfer`).send({toUserId: heirId, previous: "keep"});
        expect(kept.body).toMatchObject({newAdmin: heir.userCode, changed: 0});
        expect([await roleOf(vault.id, heirId), await roleOf(vault.id, ownerId)]).toEqual([1, 1]);

        await admin.reauth();
        const demoted = await admin.agent.post(`/api/admin/vaults/${vault.id}/transfer`).send({toUserId: heirId, previous: "demote"});
        expect(demoted.body.changed).toBe(1);
        expect([await roleOf(vault.id, heirId), await roleOf(vault.id, ownerId)]).toEqual([1, 0]);

        await pool().query("UPDATE vault_users SET role = 1 WHERE vault_id = $1 AND user_id = $2", [vault.id, ownerId]);
        await admin.reauth();
        const removed = await admin.agent.post(`/api/admin/vaults/${vault.id}/transfer`).send({toUserId: heirId, previous: "remove"});
        expect(removed.body.changed).toBe(1);
        expect(await roleOf(vault.id, ownerId)).toBeUndefined();
        expect(await roleOf(vault.id, heirId)).toBe(1);
        expect((await admin.agent.get("/api/admin/logs/audit").query({action: "vault.transfer"})).body.items.length).toBeGreaterThanOrEqual(3);
    });
});

describe("clear a vault", () => {
    async function seed(owner: ITestUser) {
        const vault = await vaultOf(owner);
        const q = async (sql: string, params: unknown[] = []) => (await pool().query(sql, params)).rows;
        const author = (await q("INSERT INTO authors (vault_id, name) VALUES ($1, 'An Author') RETURNING id", [vault.id]))[0].id;
        const category = (await q("INSERT INTO categories (vault_id, name) VALUES ($1, 'Fiction') RETURNING id", [vault.id]))[0].id;
        const location = (await q("INSERT INTO locations (vault_id, name) VALUES ($1, 'Shelf A') RETURNING id", [vault.id]))[0].id;
        const group = (await q("INSERT INTO customer_groups (vault_id, name) VALUES ($1, 'Class 1') RETURNING id", [vault.id]))[0].id;
        const customer = (await q("INSERT INTO customers (vault_id, name, group_id) VALUES ($1, 'A Borrower', $2) RETURNING id", [vault.id, group]))[0].id;
        const book = (await q("INSERT INTO books (vault_id, name, category_id) VALUES ($1, 'A Secret Title', $2) RETURNING id", [vault.id, category]))[0].id;
        await q("INSERT INTO book_authors (book_id, author_id, vault_id) VALUES ($1, $2, $3)", [book, author, vault.id]);
        const code = `s${Math.random().toString(36).slice(2, 11)}`;
        await q("INSERT INTO book_stocks (book_id, vault_id, code, status, location_id, customer_id, loaned_at) VALUES ($1, $2, $3, 2, $4, $5, NOW())", [book, vault.id, code, location, customer]);
        await q("INSERT INTO loan_history (book_id, book_name, stock_code, customer_id, loaned_at, vault_id) VALUES ($1, 'A Secret Title', $2, $3, NOW(), $4)", [book, code, customer, vault.id]);
        return {vault, code};
    }
    const count = async (table: string, vaultId: number) => Number((await pool().query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE vault_id = $1`, [vaultId])).rows[0].n);

    it("shows counts only, asks to type the vault name, and clears just what was chosen", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const owner = await createAuthenticatedUser(apps.main());
        const {vault, code} = await seed(owner);

        const counts = await admin.agent.get(`/api/admin/vaults/${vault.id}/content`);
        expect(counts.body.counts).toMatchObject({books: 1, copies: 1, authors: 1, categories: 1, locations: 1, groups: 1, customers: 1, history: 1});
        expect(JSON.stringify(counts.body)).not.toMatch(/Secret Title|Borrower|Author/);

        expect((await admin.agent.post(`/api/admin/vaults/${vault.id}/clear`).send({scopes: ["authors"], confirm: vault.name})).status).toBe(403); // fresh verification
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/vaults/${vault.id}/clear`).send({scopes: ["authors"], confirm: "wrong"})).status).toBe(400);
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/vaults/${vault.id}/clear`).send({scopes: ["secrets"], confirm: vault.name})).status).toBe(400);
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/vaults/${vault.id}/clear`).send({scopes: [], confirm: vault.name})).status).toBe(400);

        await admin.reauth();
        const some = await admin.agent.post(`/api/admin/vaults/${vault.id}/clear`).send({scopes: ["authors", "categories", "locations", "groups", "card"], confirm: vault.name});
        expect(some.status).toBe(200);
        expect(some.body.removed).toMatchObject({authors: 1, categories: 1, locations: 1, groups: 1});
        expect(some.body.counts).toMatchObject({authors: 0, categories: 0, locations: 0, groups: 0, books: 1, customers: 1, history: 1});
        expect((await pool().query("SELECT location_id FROM book_stocks WHERE code = $1", [code])).rows[0].location_id).toBeNull();
        expect((await pool().query("SELECT category_id FROM books WHERE vault_id = $1", [vault.id])).rows[0].category_id).toBeNull();

        // Borrowers: the copy on loan to them goes back on the shelf, and their loans go with them.
        await admin.reauth();
        const borrowers = await admin.agent.post(`/api/admin/vaults/${vault.id}/clear`).send({scopes: ["customers"], confirm: vault.name});
        expect(borrowers.body.removed).toMatchObject({customers: 1, history: 1});
        expect((await pool().query("SELECT status, customer_id, loaned_at FROM book_stocks WHERE code = $1", [code])).rows[0]).toEqual({status: 0, customer_id: null, loaned_at: null});
        expect(await count("books", vault.id)).toBe(1);

        const audit = (await admin.agent.get("/api/admin/logs/audit").query({action: "vault.clear"})).body.items[0];
        expect(JSON.stringify(audit)).not.toMatch(/Secret Title|Borrower/);
        expect(audit.entityLabel).toBe(vault.name);
    });

    it("empties the books with their copies and loan history, and leaves the vault and its members", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const owner = await createAuthenticatedUser(apps.main());
        const {vault} = await seed(owner);
        await admin.reauth();
        const res = await admin.agent.post(`/api/admin/vaults/${vault.id}/clear`).send({scopes: ["books"], confirm: vault.name});
        expect(res.status).toBe(200);
        expect(res.body.removed).toMatchObject({books: 1, copies: 1, history: 1});
        expect(res.body.counts).toMatchObject({books: 0, copies: 0, history: 0});
        expect(await count("book_stocks", vault.id)).toBe(0);
        expect(await count("customers", vault.id)).toBe(1); // borrowers untouched
        expect(await count("vault_users", vault.id)).toBeGreaterThanOrEqual(1);
        expect((await pool().query("SELECT 1 FROM vault WHERE id = $1", [vault.id])).rowCount).toBe(1);
        // The owner still gets into the empty vault.
        expect((await owner.agent.get("/api/rest/user/sessions")).status).toBe(200);
    });
});

describe("merge two accounts", () => {
    it("moves memberships and what the account created or borrowed, folds shared vaults, and removes the duplicate", async () => {
        const admin = await createLoggedInAdmin(apps.admin());
        const keep = await createAuthenticatedUser(apps.main(), "Keeper");
        const dupe = await createAuthenticatedUser(apps.main(), "Duplicate");
        const keepId = await userId(keep.userCode);
        const dupeId = await userId(dupe.userCode);
        const keepVault = await vaultOf(keep);
        const dupeVault = await vaultOf(dupe);
        // The duplicate is admin of a vault the keeper only belongs to as a normal member.
        await pool().query("INSERT INTO vault_users (vault_id, user_id, role, status) VALUES ($1, $2, 0, 1)", [dupeVault.id, keepId]);
        const sharedBefore = (await pool().query("SELECT role FROM vault_users WHERE vault_id = $1 AND user_id = $2", [dupeVault.id, keepId])).rows[0].role;
        expect(sharedBefore).toBe(0);
        // Something the duplicate created, something it has borrowed, notes and tags.
        const book = (await pool().query("INSERT INTO books (vault_id, name, user_created) VALUES ($1, 'Made by the duplicate', $2) RETURNING id", [keepVault.id, dupeId])).rows[0].id;
        await pool().query("INSERT INTO activity_log (actor_id, action) VALUES ($1, 'something')", [dupeId]);
        await admin.agent.post(`/api/admin/users/${dupeId}/notes`).send({body: "Duplicate account, same person"});
        await admin.agent.put(`/api/admin/users/${dupeId}/tags`).send({tags: ["vip"]});
        const before = (await pool().query("SELECT COUNT(*)::int AS n FROM vault_users WHERE user_id = $1", [dupeId])).rows[0].n;

        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/users/${keepId}/merge`).send({sourceId: dupeId, confirm: "wrong"})).status).toBe(400);
        await admin.reauth();
        expect((await admin.agent.post(`/api/admin/users/${keepId}/merge`).send({sourceId: keepId, confirm: keep.userCode})).status).toBe(400);
        const stillThere = await pool().query("SELECT 1 FROM users WHERE id = $1", [dupeId]);
        expect(stillThere.rowCount).toBe(1);

        await admin.reauth();
        const done = await admin.agent.post(`/api/admin/users/${keepId}/merge`).send({sourceId: dupeId, confirm: dupe.userCode});
        expect(done.status).toBe(200);
        expect(done.body.vaultsMoved + done.body.vaultsCombined).toBe(before);
        expect(done.body.vaultsCombined).toBe(1);
        expect(done.body.rowsReassigned).toBeGreaterThanOrEqual(2);

        expect((await pool().query("SELECT 1 FROM users WHERE id = $1", [dupeId])).rowCount).toBe(0);
        // The keeper now belongs to the duplicate's vault as admin, and owns the duplicate's personal vault too.
        expect((await pool().query("SELECT role FROM vault_users WHERE vault_id = $1 AND user_id = $2", [dupeVault.id, keepId])).rows[0].role).toBe(1);
        expect((await pool().query("SELECT user_created FROM books WHERE id = $1", [book])).rows[0].user_created).toBe(keepId);
        expect((await pool().query("SELECT COUNT(*)::int AS n FROM activity_log WHERE actor_id = $1 AND action = 'something'", [keepId])).rows[0].n).toBe(1);
        const detail = (await admin.agent.get(`/api/admin/users/${keepId}`)).body;
        expect(detail.notes.map((n: any) => n.body)).toContain("Duplicate account, same person");
        expect(detail.user.tags).toContain("vip");
        expect((await admin.agent.get("/api/admin/logs/audit").query({action: "user.merge"})).body.items[0]).toMatchObject({entityLabel: keep.userCode});
        // The duplicate can no longer sign in; the keeper still can.
        expect((await dupe.agent.get("/api/rest/user/sessions")).status).toBe(401);
        expect((await keep.agent.get("/api/rest/user/sessions")).status).toBe(200);
    });
});
