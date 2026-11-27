/**
 * Evaluates the compliance catalogue against the live installation: gathers the facts the checks need, runs
 * them and merges the result with what people recorded (owner, declared status, evidence, review dates).
 */
import {Pool} from "pg";
import {appService} from "../../AppService";
import {ComplianceRepository, ControlRecord, ControlStatus} from "../repositories/ComplianceRepository";
import {COMPLIANCE_CATALOG, CheckResult, ControlDef, Facts} from "./complianceCatalog";
import {RETENTION_ITEMS, RetentionService} from "./RetentionService";
import {findSetting} from "./settingsCatalog";

/** An admin whose access wasn't confirmed for this long counts as overdue. */
export const ACCESS_REVIEW_DAYS = 180;

export type ControlOutcome = "compliant" | "partial" | "gap" | "planned" | "not_assessed" | "not_applicable";

export interface ControlView {
    id: string;
    title: string;
    area: ControlDef["area"];
    summary: string;
    howTo: string;
    refs: {iso: string; gdpr?: string; soc2?: string};
    /** What the portal measured, or null when the control can't be measured. */
    measured: CheckResult | null;
    record: ControlRecord | null;
    outcome: ControlOutcome;
    reviewOverdue: boolean;
}

export interface Overview {
    generatedAt: string;
    /** 0-100, over the controls that apply. */
    score: number;
    counts: Record<ControlOutcome, number>;
    controls: ControlView[];
    attention: {kind: string; text: string; link: string}[];
}

const SCORE: Record<ControlOutcome, number | null> = {compliant: 1, partial: 0.5, gap: 0, planned: 0, not_assessed: 0, not_applicable: null};

/** @returns The outcome of a control from what was measured and what was declared. */
/**
 * Example:
 *   outcomeOf({state: "pass", detail: ""}, null)           // "compliant"   (measured, green)
 *   outcomeOf({state: "fail", detail: ""}, "implemented")  // "gap"         (a person cannot declare a failing check green)
 *   outcomeOf({state: "fail", detail: ""}, "not_applicable") // "not_applicable" (but they can declare it does not apply)
 *   outcomeOf(null, "planned")                              // "planned"     (not measurable: the declaration counts)
 */
export function outcomeOf(measured: CheckResult | null, declared: ControlStatus | null): ControlOutcome {
    if (declared === "not_applicable") return "not_applicable";
    if (measured) {
        return measured.state === "pass" ? "compliant" : measured.state === "warn" ? "partial" : "gap";
    }
    switch (declared) {
        case "implemented": return "compliant";
        case "partial": return "partial";
        case "planned": return "planned";
        default: return "not_assessed";
    }
}

const num = (value: string | undefined): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** Evaluates controls. */
export class ComplianceService {
    private readonly repo: ComplianceRepository;

    /**
     * @param pool Database pool.
     */
    public constructor(private readonly pool: Pool) {
        this.repo = new ComplianceRepository(pool);
    }

    private async scalar(sql: string, params: unknown[] = []): Promise<number> {
        const result = await this.pool.query(sql, params);
        return Number(Object.values(result.rows[0] ?? {})[0] ?? 0);
    }

    /** @returns The facts every check works from. */
    public async facts(): Promise<Facts> {
        const settings = appService.getSettings();
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const staleBefore = new Date(Date.now() - ACCESS_REVIEW_DAYS * 24 * 60 * 60 * 1000);
        const admins = (await this.pool.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE role = 'superadmin')::int AS superadmins,
                    COUNT(*) FILTER (WHERE NOT totp_enabled)::int AS "without2fa",
                    COUNT(*) FILTER (WHERE access_reviewed_at IS NULL)::int AS "neverReviewed",
                    COUNT(*) FILTER (WHERE access_reviewed_at < $1)::int AS "staleReview"
               FROM admin_users WHERE NOT disabled`, [staleBefore])).rows[0];
        const [triggers, entries, changes, events, blocked, usersTotal, users2fa, tosAccepted] = await Promise.all([
            this.scalar("SELECT COUNT(*)::int FROM pg_trigger WHERE tgrelid = 'admin_audit_log'::regclass AND NOT tgisinternal"),
            this.scalar("SELECT COUNT(*)::int FROM admin_audit_log WHERE created_date >= $1", [since]),
            this.scalar("SELECT COUNT(*)::int FROM admin_audit_log WHERE created_date >= $1 AND action LIKE 'settings.%'", [since]),
            this.scalar("SELECT COALESCE(SUM(count), 0)::int FROM security_events WHERE bucket >= $1", [since]),
            this.scalar("SELECT COUNT(*)::int FROM blocked_ips WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP"),
            this.scalar("SELECT COUNT(*)::int FROM users"),
            this.scalar("SELECT COUNT(*)::int FROM users WHERE totp_enabled"),
            this.scalar("SELECT COUNT(*)::int FROM user_terms_of_service_acknowledgements WHERE accepted_date IS NOT NULL"),
        ]);
        const incidents = (await this.pool.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status IN ('open', 'contained'))::int AS open,
                    COUNT(*) FILTER (WHERE personal_data AND authority_notified_at IS NULL AND detected_at < CURRENT_TIMESTAMP - INTERVAL '72 hours' AND status <> 'closed')::int AS "overdueNotification"
               FROM security_incidents`)).rows[0];
        const reg = (await this.pool.query(
            `SELECT kind, COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                    COUNT(*) FILTER (WHERE status = 'active' AND next_review_at < CURRENT_DATE)::int AS overdue
               FROM compliance_register GROUP BY kind`)).rows;
        const register: Facts["register"] = {policy: {active: 0, overdue: 0}, supplier: {active: 0, overdue: 0}, risk: {active: 0, overdue: 0}, asset: {active: 0, overdue: 0}};
        for (const row of reg) {
            register[row.kind as keyof Facts["register"]] = {active: row.active, overdue: row.overdue};
        }
        const dataRequests = (await this.pool.query(
            `SELECT COUNT(*)::int AS open, COUNT(*) FILTER (WHERE due_at < CURRENT_TIMESTAMP)::int AS overdue FROM data_requests WHERE status IN ('open', 'processing')`)).rows[0];
        const retention = new RetentionService(this.pool);
        const days = (id: string) => retention.days(RETENTION_ITEMS.find((item) => item.id === id)!);
        const jobsFailing = await appService.getJobs().failingCount().catch(() => 0);
        const highRisks = await this.scalar("SELECT COUNT(*)::int FROM compliance_register WHERE kind = 'risk' AND status = 'active' AND rating = 'high'");

        const value = (key: string): string => {
            const raw = settings.get(key);
            return raw === undefined || raw === "" ? String(findSetting(key)?.defaultValue ?? "") : raw;
        };
        const adminConfig = appService.getAdminConfig();
        // Don't let a slow or offline update check hold the page up.
        const update = await Promise.race([
            appService.getUpdateChecker().status().catch(() => null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
        ]);

        return {
            admins: {...admins, reviewDays: ACCESS_REVIEW_DAYS},
            audit: {appendOnly: triggers >= 1, entries30d: entries, changes30d: changes},
            security: {events30d: events, autoBlock: value("ADMIN_AUTOBLOCK_ENABLED") === "true", allowedIps: adminConfig.allowedIps.length, blockedNow: blocked},
            users: {total: usersTotal, with2fa: users2fa, tosAccepted},
            config: {
                https: (process.env.FRONT_END_URL ?? "").startsWith("https://"),
                adminHttps: (adminConfig.url ?? "").startsWith("https://"),
                encryptionKey: !!process.env.SETTINGS_ENCRYPTION_KEY,
                mailConfigured: !!settings.get("SMTP_HOST"),
                inactivityDays: num(value("ACCOUNT_INACTIVITY_DAYS")),
                deletionGraceDays: num(value("ADMIN_DELETION_GRACE_DAYS")),
                adminAlerts: value("ADMIN_NOTIFY_SECURITY") === "true",
                dbSizeAlert: num(value("ADMIN_NOTIFY_DB_SIZE_MB")) > 0,
                updateCheck: value("ADMIN_UPDATE_CHECK") !== "false",
                sessionHours: num(process.env.SESSION_TIME) / 3600000,
                separatePort: true,
            },
            update: {known: !!update?.latest, available: update?.updateAvailable ?? null, installed: update?.installed ?? "unknown", latest: update?.latest ?? null},
            incidents,
            register,
            highRisks,
            dataRequests,
            retention: {activityDays: days("activity_log"), securityDays: days("security_events"), mailDays: days("mail_log")},
            jobsFailing,
        };
    }

    /** @returns Every control with its measured result, what was recorded and the outcome, plus what needs attention. */
    public async overview(): Promise<Overview> {
        const [facts, records] = await Promise.all([this.facts(), this.repo.controlRecords()]);
        const today = new Date().toISOString().slice(0, 10);
        const controls: ControlView[] = COMPLIANCE_CATALOG.map((def) => {
            const record = records.get(def.id) ?? null;
            let measured: CheckResult | null = null;
            if (def.check) {
                try {
                    measured = def.check(facts);
                } catch {
                    measured = {state: "warn", detail: "This check couldn't be run."};
                }
            }
            return {
                id: def.id, title: def.title, area: def.area, summary: def.summary, howTo: def.howTo,
                refs: {iso: `ISO/IEC 27001:2022 ${def.id}`, gdpr: def.refs.gdpr, soc2: def.refs.soc2},
                measured, record, outcome: outcomeOf(measured, record?.status ?? null),
                reviewOverdue: !!record?.nextReviewAt && record.nextReviewAt < today,
            };
        });
        const counts: Record<ControlOutcome, number> = {compliant: 0, partial: 0, gap: 0, planned: 0, not_assessed: 0, not_applicable: 0};
        let total = 0;
        let points = 0;
        for (const control of controls) {
            counts[control.outcome] += 1;
            const score = SCORE[control.outcome];
            if (score !== null) {
                total += 1;
                points += score;
            }
        }
        const attention: Overview["attention"] = [];
        if (facts.incidents.overdueNotification > 0) {
            attention.push({kind: "incident", text: `${facts.incidents.overdueNotification} personal-data incident(s) not reported to the authority within 72 hours.`, link: "incidents"});
        }
        if (facts.incidents.open > 0) {
            attention.push({kind: "incident", text: `${facts.incidents.open} incident(s) still open.`, link: "incidents"});
        }
        if (facts.dataRequests.overdue > 0) {
            attention.push({kind: "request", text: `${facts.dataRequests.overdue} data request(s) are past their deadline.`, link: "controls"});
        }
        if (facts.admins.neverReviewed + facts.admins.staleReview > 0) {
            attention.push({kind: "access", text: `${facts.admins.neverReviewed + facts.admins.staleReview} admin(s) need an access review.`, link: "access"});
        }
        const overdue = Object.values(facts.register).reduce((sum, r) => sum + r.overdue, 0);
        if (overdue > 0) {
            attention.push({kind: "register", text: `${overdue} register entr${overdue === 1 ? "y is" : "ies are"} past the review date.`, link: "registers"});
        }
        const controlsOverdue = controls.filter((c) => c.reviewOverdue).length;
        if (controlsOverdue > 0) {
            attention.push({kind: "control", text: `${controlsOverdue} control(s) are past their review date.`, link: "controls"});
        }
        if (facts.highRisks > 0) {
            attention.push({kind: "risk", text: `${facts.highRisks} high risk(s) in the register.`, link: "registers"});
        }
        return {generatedAt: new Date().toISOString(), score: total === 0 ? 0 : Math.round((100 * points) / total), counts, controls, attention};
    }
}
