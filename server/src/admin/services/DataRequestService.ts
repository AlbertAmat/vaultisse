/**
 * GDPR requests from the people the app holds data about: access (art. 15) and erasure (art. 17).
 *
 * The portal tracks each request against its deadline (one month, art. 12(3), extendable once to three months
 * for complex requests), builds the personal-data export for an access request and carries out an erasure
 * through the normal deletion flow (grace period, protections for shared vaults). A request stays on record when the
 * account is gone: that record is the proof that it was answered.
 *
 * The export covers what is held *about the person*: profile, sign-in sessions and activity, memberships, terms
 * acceptances, emails sent to them and the notes admins keep on the account. It never includes the contents of a
 * vault (books, loans, ...): the portal doesn't read them. Credentials (password hash, two-factor secret, tokens) are
 * left out on purpose.
 */
import {Pool} from "pg";
import {ConflictError, NotFoundError, ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {AccountNotesRepository} from "../repositories/AccountNotesRepository";
import {PlatformRepository} from "../repositories/PlatformRepository";
import {DeletionService} from "./DeletionService";
import {buildZip} from "./ZipWriter";

export type RequestKind = "access" | "erasure";
export type RequestStatus = "open" | "processing" | "completed" | "rejected";

export interface DataRequest {
    id: number;
    kind: RequestKind;
    userId: number | null;
    userCode: string | null;
    subjectName: string | null;
    subjectEmail: string;
    receivedAt: Date;
    dueAt: Date;
    extendedAt: Date | null;
    extensionReason: string | null;
    status: RequestStatus;
    completedAt: Date | null;
    resolution: string | null;
    notes: string | null;
    deletionScheduledFor: Date | null;
    daysLeft: number | null;
    overdue: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
const WARN_DAYS = 5;

const SELECT = `SELECT r.id, r.kind, r.user_id AS "userId", u.code AS "userCode", r.subject_name AS "subjectName", r.subject_email AS "subjectEmail",
        r.received_at AS "receivedAt", r.due_at AS "dueAt", r.extended_at AS "extendedAt", r.extension_reason AS "extensionReason",
        r.status, r.completed_at AS "completedAt", r.resolution, r.notes,
        (SELECT d.execute_after FROM scheduled_deletions d WHERE d.entity_type = 'user' AND d.entity_id = r.user_id
            AND d.cancelled_at IS NULL AND d.executed_at IS NULL) AS "deletionScheduledFor"
   FROM data_requests r LEFT JOIN users u ON u.id = r.user_id`;

/** @returns The same date plus calendar months. */
function addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
}

/** Tracks and answers data requests. */
export class DataRequestService {
    private readonly platform: PlatformRepository;
    private readonly notes: AccountNotesRepository;

    /**
     * @param pool Database pool.
     * @param deletions Deletion service (to carry out an erasure).
     */
    public constructor(private readonly pool: Pool, private readonly deletions: DeletionService) {
        this.platform = new PlatformRepository(pool);
        this.notes = new AccountNotesRepository(pool);
    }

    private decorate(row: any): DataRequest {
        const open = row.status === "open" || row.status === "processing";
        const daysLeft = open ? Math.ceil((new Date(row.dueAt).getTime() - Date.now()) / DAY) : null;
        return {...row, daysLeft, overdue: open && daysLeft !== null && daysLeft < 0};
    }

    /**
     * Erasure requests whose account is gone were answered: close them.
     * @returns How many were closed.
     */
    public async settle(): Promise<number> {
        const result = await this.pool.query(
            `UPDATE data_requests SET status = 'completed', completed_at = CURRENT_TIMESTAMP, resolution = 'The account was erased.'
              WHERE kind = 'erasure' AND status = 'processing' AND user_id IS NULL`);
        return result.rowCount ?? 0;
    }

    /** @param status Optional filter ("active" = open or processing). @returns The requests, soonest deadline first. */
    public async list(status?: string): Promise<DataRequest[]> {
        await this.settle();
        const where = status === "active" ? "WHERE r.status IN ('open', 'processing')" : status ? "WHERE r.status = $1" : "";
        const result = await this.pool.query(`${SELECT} ${where} ORDER BY (r.status IN ('open', 'processing')) DESC, r.due_at`, status && status !== "active" ? [status] : []);
        return result.rows.map((row) => this.decorate(row));
    }

    /** @param id Request id. @returns The request, or null. */
    public async find(id: number): Promise<DataRequest | null> {
        const result = await this.pool.query(`${SELECT} WHERE r.id = $1`, [id]);
        return result.rows[0] ? this.decorate(result.rows[0]) : null;
    }

    /** @returns How many requests are open and how many of them are past their deadline. */
    public async counts(): Promise<{open: number; overdue: number}> {
        const result = await this.pool.query(
            `SELECT COUNT(*)::int AS open, COUNT(*) FILTER (WHERE due_at < CURRENT_TIMESTAMP)::int AS overdue
               FROM data_requests WHERE status IN ('open', 'processing')`);
        return result.rows[0];
    }

    /**
     * Logs a request.
     * @param input Who and what; either an account (`userId`) or an email address.
     * @param adminId Admin logging it.
     * @returns The new request.
     */
    public async create(input: {kind: RequestKind; userId?: number; email?: string; name?: string; receivedAt?: Date; notes?: string}, adminId: number): Promise<DataRequest> {
        let userId: number | null = null;
        let email = input.email?.trim() ?? "";
        let name = input.name?.trim() || null;
        if (input.userId !== undefined) {
            const user = await this.platform.findUser(input.userId);
            if (!user) throw new NotFoundError("Account not found.");
            userId = user.id;
            email = user.email;
            name = user.name;
        } else {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
                throw new ValidationError("Give the email address of the person (or choose their account).");
            }
            const match = await this.pool.query("SELECT id, name FROM users WHERE LOWER(email) = LOWER($1)", [email]);
            if (match.rows[0]) {
                userId = match.rows[0].id;
                name = name ?? match.rows[0].name;
            }
        }
        const receivedAt = input.receivedAt ?? new Date();
        if (receivedAt.getTime() > Date.now() + DAY) throw new ValidationError("The request can't be received in the future.");
        const result = await this.pool.query(
            `INSERT INTO data_requests (kind, user_id, subject_name, subject_email, received_at, due_at, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [input.kind, userId, name, email, receivedAt, addMonths(receivedAt, 1), input.notes?.trim().slice(0, 4000) || null, adminId]);
        const created = (await this.find(result.rows[0].id))!;
        void appService.getNotifier().notify("data_requests", {
            title: `A data ${created.kind === "erasure" ? "erasure" : "access"} request was logged`,
            lines: [`${created.subjectName ?? created.subjectEmail} asked ${created.kind === "erasure" ? "for their data to be erased" : "to see their data"}.`, `It must be answered by ${created.dueAt.toISOString().slice(0, 10)} (GDPR art. 12: one month).`],
            event: "data_request.created",
        });
        return created;
    }

    private async requireActive(id: number): Promise<DataRequest> {
        const request = await this.find(id);
        if (!request) throw new NotFoundError("Request not found.");
        if (request.status === "completed" || request.status === "rejected") throw new ConflictError("This request is already closed.");
        return request;
    }

    /**
     * Extends the deadline to three months from receipt, once (art. 12(3): complex requests or many requests).
     * @param id Request id.
     * @param reason Why (the person must be told).
     */
    public async extend(id: number, reason: string): Promise<void> {
        const request = await this.requireActive(id);
        if (request.extendedAt) throw new ConflictError("The deadline was already extended once.");
        if (!reason.trim()) throw new ValidationError("Say why the extension is needed: the person must be told within the first month.");
        await this.pool.query("UPDATE data_requests SET due_at = $2, extended_at = CURRENT_TIMESTAMP, extension_reason = $3 WHERE id = $1",
            [id, addMonths(new Date(request.receivedAt), 3), reason.trim().slice(0, 1000)]);
    }

    /**
     * Closes a request as answered or refused.
     * @param id Request id.
     * @param outcome `completed` or `rejected`.
     * @param resolution What was done, or why it was refused (required for a refusal).
     * @param adminId Admin closing it.
     */
    public async close(id: number, outcome: "completed" | "rejected", resolution: string, adminId: number): Promise<void> {
        await this.requireActive(id);
        if (outcome === "rejected" && !resolution.trim()) throw new ValidationError("A refusal needs a reason: the person is entitled to know it.");
        await this.pool.query("UPDATE data_requests SET status = $2, completed_at = CURRENT_TIMESTAMP, resolution = $3, handled_by = $4 WHERE id = $1",
            [id, outcome, resolution.trim().slice(0, 4000) || null, adminId]);
    }

    /**
     * Carries out an erasure request through the deletion flow.
     * @param id Request id.
     * @param adminId Admin carrying it out.
     * @param immediate Skip the grace period.
     * @returns When the account will be deleted (null when it already was).
     */
    public async erase(id: number, adminId: number, immediate: boolean): Promise<{executed: boolean; executeAfter: Date | null}> {
        const request = await this.requireActive(id);
        if (request.kind !== "erasure") throw new ValidationError("Only an erasure request can erase an account.");
        if (request.userId === null) throw new ConflictError("This request has no account to erase.");
        const result = await this.deletions.requestUserDeletion(adminId, request.userId, immediate);
        await this.pool.query("UPDATE data_requests SET status = 'processing', handled_by = $2 WHERE id = $1", [id, adminId]);
        if (result.executed) await this.settle();
        return {executed: result.executed, executeAfter: result.executeAfter ?? null};
    }

    /** Hourly: reminds the admins of requests that are close to their deadline or past it. */
    public async remind(): Promise<void> {
        await this.settle();
        for (const request of await this.list("active")) {
            if (request.daysLeft === null || request.daysLeft > WARN_DAYS) continue;
            await appService.getNotifier().notify("data_requests", {
                title: request.overdue ? `A data request is overdue (${request.kind})` : `A data request is due in ${request.daysLeft} day${request.daysLeft === 1 ? "" : "s"}`,
                lines: [`${request.subjectName ?? request.subjectEmail}: ${request.kind === "erasure" ? "erasure" : "access"} request received ${request.receivedAt.toISOString().slice(0, 10)}, due ${request.dueAt.toISOString().slice(0, 10)}.`, "Open Data requests in the console."],
                dedupeKey: `due:${request.id}`,
                cooldownMs: DAY,
                event: "data_request.due",
            });
        }
    }

    /**
     * Builds the personal-data export of one account.
     * @param userId Account id.
     * @returns The ZIP file and a file name for it.
     */
    public async exportAccount(userId: number): Promise<{zip: Buffer; fileName: string}> {
        const account = (await this.pool.query(
            `SELECT id, code, name, email, email_verified AS "emailVerified", language, region, theme, sidebar_rail AS "sidebarRail",
                    created_date AS "createdDate", last_login_date AS "lastLoginDate", last_activity_date AS "lastActivityDate",
                    disabled, is_public_institution AS "isPublicInstitution", totp_enabled AS "twoFactorEnabled",
                    (oidc_sub IS NOT NULL) AS "singleSignOn", oidc_issuer AS "singleSignOnIssuer", (image IS NOT NULL) AS "hasProfilePicture"
               FROM users WHERE id = $1`, [userId])).rows[0];
        if (!account) throw new NotFoundError("Account not found.");
        const image = (await this.pool.query("SELECT image FROM users WHERE id = $1", [userId])).rows[0]?.image as Buffer | null;
        const query = async (sql: string, params: unknown[]) => (await this.pool.query(sql, params)).rows;
        const [sessions, activity, tos, security, emails, requests] = await Promise.all([
            query(`SELECT ip_address AS "ipAddress", user_agent AS "userAgent", created_date AS "createdDate", last_seen_date AS "lastSeenDate", revoked_date AS "revokedDate"
                     FROM user_sessions WHERE user_id = $1 ORDER BY id DESC LIMIT 2000`, [userId]),
            query(`SELECT action, entity_type AS "entityType", entity_id AS "entityId", metadata, created_date AS "createdDate"
                     FROM activity_log WHERE actor_id = $1 ORDER BY id DESC LIMIT 5000`, [userId]),
            query(`SELECT sent_date AS "askedAt", accepted_date AS "acceptedAt" FROM user_terms_of_service_acknowledgements WHERE user_id = $1`, [userId]),
            query(`SELECT sent_date AS "askedAt", accepted_date AS "acceptedAt" FROM user_security_notice_acknowledgements WHERE user_id = $1`, [userId]),
            query(`SELECT subject, status, created_date AS "sentAt" FROM mail_log WHERE LOWER(to_address) = LOWER($1) ORDER BY id DESC LIMIT 1000`, [account.email]),
            query(`SELECT kind, received_at AS "receivedAt", due_at AS "dueAt", status, completed_at AS "completedAt", resolution FROM data_requests WHERE user_id = $1 ORDER BY id`, [userId]),
        ]);
        const memberships = await this.platform.userMemberships(userId);
        const accountNotes = await this.notes.notes(userId);
        const tags = await this.notes.tags(userId);
        const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        const now = new Date();
        const readme = [
            `Personal data export for ${account.name} (${account.code})`,
            `Prepared on ${now.toISOString()} by the administrators of this Vaultisse installation.`,
            "",
            "What is in this archive",
            "  account.json                  your profile and settings",
            "  vault-memberships.json        the vaults you belong to and your role in each",
            "  sign-in-sessions.json         devices and addresses you signed in from",
            "  activity-log.json             sign-ins and other recorded actions",
            "  terms-acknowledgements.json   when you were asked to accept the terms and notices, and when you accepted",
            "  emails-sent.json              the emails this installation sent you (subject and outcome, not the text)",
            "  admin-notes.json              notes and labels the administrators keep about your account",
            "  data-requests.json            your data requests and how they were answered",
            "",
            "What is not in it",
            "  - The contents of your vaults (books, notes, loans, borrowers, files). The administrators' console never reads them.",
            "    They stay available to you, and to the members of those vaults, in the application.",
            "  - Your password (kept only as a one-way hash), your two-factor secret and access tokens, for your security.",
            "",
            "Questions about this data can be sent to the administrators of this installation.",
        ].join("\n");
        const files = [
            {name: "README.txt", data: Buffer.from(`${readme}\n`, "utf8")},
            {name: "account.json", data: json(account)},
            {name: "vault-memberships.json", data: json(memberships.map((m) => ({vault: m.vaultName, role: m.role, status: m.status === 1 ? "member" : m.status === 0 ? "pending" : "rejected"})))},
            {name: "sign-in-sessions.json", data: json(sessions)},
            {name: "activity-log.json", data: json(activity)},
            {name: "terms-acknowledgements.json", data: json({termsOfService: tos, securityNotice: security})},
            {name: "emails-sent.json", data: json(emails)},
            {name: "admin-notes.json", data: json({tags, notes: accountNotes.map((n) => ({note: n.body, writtenBy: n.createdBy, writtenAt: n.createdDate}))})},
            {name: "data-requests.json", data: json(requests)},
            ...(image && image.length > 0 ? [{name: "profile-picture.bin", data: image}] : []),
        ];
        return {zip: buildZip(files), fileName: `personal-data-${account.code}-${now.toISOString().slice(0, 10)}.zip`};
    }
}
