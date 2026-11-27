/**
 * Preview of the automatic deletion of inactive accounts (mounted at `/api/admin/inactivity`), so nobody is
 * surprised: who has been warned, who is about to be, who is next, and when.
 *
 *  GET  /                ?days=N&horizon=D   the accounts that are, or within D days (default 30) will be, affected.
 *                        `days` simulates another inactivity period ("what if I set it to 180?") without changing anything.
 *  POST /:id/keep        counts the account as active now, which restarts its clock and cancels a warning
 *
 * The rules are exactly those of the real job (InactivityService): accounts that can't sign in anyway, borrowers
 * with copies on loan and the only admin of a shared vault are never deleted, so they are never listed.
 */
import {Router} from "express";
import {Pool} from "pg";
import {NotFoundError, ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {handle, idParam} from "../http";
import {requireSuperadmin} from "../middleware";
import {AdminAuditService} from "../services/AdminAuditService";

const DAY_MS = 24 * 60 * 60 * 1000;

export type InactivityStatus = "due" | "warned" | "to_warn" | "upcoming";

interface Row {
    id: number;
    code: string;
    name: string;
    email: string;
    lastActivity: Date;
    warnedAt: Date | null;
}

/**
 * @param row The account.
 * @param idleDays Inactivity period.
 * @param noticeDays Warning period (0 = no warning).
 * @param now Current time.
 * @returns Where the account stands and when it would be deleted.
 *
 * @example
 *   // idle 40 days, accounts deleted after 30, warned 7 days before:
 *   classify({..., lastActivity: <40 days ago>, warnedAt: null}, 30, 7, Date.now())
 *   //   -> {status: "to_warn" | "due" | ..., warnOn: <23 days after last activity>, deleteOn: <30 days after last activity>}
 */
export function classify(row: Row, idleDays: number, noticeDays: number, now: number): {status: InactivityStatus; warnOn: Date | null; deleteOn: Date} {
    const last = new Date(row.lastActivity).getTime();
    if (noticeDays > 0) {
        const warnOn = last + (idleDays - noticeDays) * DAY_MS;
        const warned = row.warnedAt ? new Date(row.warnedAt).getTime() : null;
        const deleteOn = (warned ?? Math.max(now, warnOn)) + noticeDays * DAY_MS;
        const status: InactivityStatus = deleteOn <= now ? "due" : warned ? "warned" : warnOn <= now ? "to_warn" : "upcoming";
        return {status, warnOn: new Date(warnOn), deleteOn: new Date(deleteOn)};
    }
    const deleteOn = last + idleDays * DAY_MS;
    return {status: deleteOn <= now ? "due" : "upcoming", warnOn: null, deleteOn: new Date(deleteOn)};
}

/**
 * @param pool Database pool.
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function inactivityRoutes(pool: Pool, audit: AdminAuditService): Router {
    const router = Router();

    router.get("/", handle(async (req, res) => {
        const settings = appService.getSettings();
        const configuredDays = Number(settings.get("ACCOUNT_INACTIVITY_DAYS")) || null;
        const configuredNotice = Number(settings.get("ACCOUNT_DELETION_NOTICE_DAYS")) || 0;

        const simulated = req.query.days !== undefined && req.query.days !== "";
        const idleDays = simulated ? Number(req.query.days) : configuredDays;
        if (simulated && (!Number.isInteger(idleDays) || (idleDays as number) < 1 || (idleDays as number) > 3650)) {
            throw new ValidationError("Days must be a whole number between 1 and 3650.");
        }
        const horizon = req.query.horizon === undefined ? 30 : Math.min(365, Math.max(0, Math.floor(Number(req.query.horizon)) || 0));
        const base = {
            enabled: configuredDays !== null,
            configuredDays,
            noticeDays: configuredNotice,
            mailEnabled: appService.getMailService().isEnabled(),
            simulated,
            horizonDays: horizon,
        };
        if (idleDays === null) {
            res.json({...base, inactivityDays: null, items: [], counts: {due: 0, warned: 0, toWarn: 0, upcoming: 0}});
            return;
        }
        // A notice period as long as the inactivity period makes no sense (the real job refuses it too).
        const notice = configuredNotice > 0 && configuredNotice < idleDays ? configuredNotice : 0;

        const result = await pool.query(
            `SELECT u.id, u.code, u.name, u.email, a.last_activity AS "lastActivity",
                    CASE WHEN u.deletion_warned_at > a.last_activity THEN u.deletion_warned_at END AS "warnedAt"
               FROM users u
               CROSS JOIN LATERAL (
                   SELECT GREATEST(u.created_date::timestamptz, u.last_login_date::timestamptz, u.last_activity_date,
                                   (SELECT MAX(s.last_seen_date) FROM user_sessions s WHERE s.user_id = u.id)) AS last_activity
               ) a
              WHERE a.last_activity <= NOW() - make_interval(days => $1)
                AND u.disabled = FALSE AND u.email_verified = TRUE
                AND NOT EXISTS (SELECT 1 FROM book_stocks b WHERE b.member_user_id = u.id AND b.status = 2)
                AND NOT EXISTS (
                    SELECT 1 FROM vault_users mine
                     WHERE mine.user_id = u.id AND mine.role = 1
                       AND EXISTS (SELECT 1 FROM vault_users o WHERE o.vault_id = mine.vault_id AND o.user_id <> u.id)
                       AND NOT EXISTS (SELECT 1 FROM vault_users o WHERE o.vault_id = mine.vault_id AND o.user_id <> u.id AND o.role = 1))
              ORDER BY a.last_activity
              LIMIT 500`,
            [Math.max(0, idleDays - horizon)]
        );
        const now = Date.now();
        const items = (result.rows as Row[])
            .map((row) => ({...row, ...classify(row, idleDays, notice, now)}))
            // Within the horizon only: accounts further away than that aren't "next".
            .filter((item) => item.status !== "upcoming" || item.deleteOn.getTime() <= now + horizon * DAY_MS)
            .sort((a, b) => a.deleteOn.getTime() - b.deleteOn.getTime());
        const count = (status: InactivityStatus) => items.filter((item) => item.status === status).length;
        res.json({
            ...base,
            inactivityDays: idleDays,
            noticeDays: notice,
            items,
            counts: {due: count("due"), warned: count("warned"), toWarn: count("to_warn"), upcoming: count("upcoming")},
        });
    }));

    router.post("/:id/keep", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const result = await pool.query(
            "UPDATE users SET last_activity_date = CURRENT_TIMESTAMP, deletion_warned_at = NULL WHERE id = $1 RETURNING code",
            [id]
        );
        if (!result.rows[0]) {
            throw new NotFoundError("Account not found.");
        }
        await audit.record(req, "user.keep_active", {entityType: "user", entityId: id, entityLabel: result.rows[0].code});
        res.json({message: "The account counts as active now."});
    }));

    return router;
}
