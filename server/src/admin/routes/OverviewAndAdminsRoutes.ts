/**
 * Overview numbers and admin account management (mounted at `/api/admin`).
 *
 *  GET    /overview         headline numbers plus signups/logins per day
 *  GET    /overview/charts  ?days=7|30|90   everything the overview charts show
 *  GET    /admins           every admin account
 *  GET    /admins/sessions  live admin sessions with a place for the address (a read-only admin sees their own)
 *  POST   /admins/sessions/:id/revoke   end somebody's session                    [fresh verification]
 *  POST   /admins           `{email, name, password, role}`  [fresh verification]  - the new admin sets up two-factor at first login
 *  PATCH  /admins/:id       `{role?, disabled?}`              [fresh verification]
 *  POST   /admins/:id/reset-2fa                              [fresh verification]
 *  DELETE /admins/:id                                         [fresh verification]
 */
import {Router} from "express";
import {NotFoundError, ValidationError} from "../../errors/DomainError";
import {Pool} from "pg";
import {handle, idParam} from "../http";
import {requireFreshAuth, requireSuperadmin} from "../middleware";
import {AdminUserRepository} from "../repositories/AdminUserRepository";
import {CHART_PERIODS, ChartsRepository} from "../repositories/ChartsRepository";
import {PlatformRepository} from "../repositories/PlatformRepository";
import {AdminAuditService} from "../services/AdminAuditService";
import {AdminAuthService, SESSION_IDLE_MS} from "../services/AdminAuthService";
import {locate} from "../services/GeoLocator";

/**
 * @param pool Database pool.
 * @param auth Admin auth service.
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function overviewAndAdminsRoutes(pool: Pool, auth: AdminAuthService, audit: AdminAuditService): Router {
    const router = Router();
    const platform = new PlatformRepository(pool);
    const admins = new AdminUserRepository(pool);
    const charts = new ChartsRepository(pool);

    router.get("/overview", handle(async (_req, res) => {
        const [counts, signups, logins] = await Promise.all([platform.overview(), platform.signupsPerDay(29), platform.loginsPerDay(13)]);
        res.json({counts, signups, logins});
    }));

    router.get("/overview/charts", handle(async (req, res) => {
        const days = req.query.days === undefined ? 30 : Number(req.query.days);
        if (!CHART_PERIODS.includes(days)) {
            throw new ValidationError(`The period must be one of ${CHART_PERIODS.join(", ")} days.`);
        }
        res.json(await charts.charts(days));
    }));

    router.get("/admins/sessions", handle(async (req, res) => {
        // A read-only admin sees their own sessions only.
        const rows = await admins.listLiveSessions(new Date(Date.now() - SESSION_IDLE_MS), req.admin!.role === "superadmin" ? undefined : req.admin!.id);
        res.json({items: rows.map((row) => {
            const place = row.ipAddress ? locate(row.ipAddress) : null;
            return {...row, country: place?.country ?? null, city: place?.city || null, current: row.id === req.admin!.sessionId};
        })});
    }));

    router.post("/admins/sessions/:id/revoke", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const id = idParam(req);
        if (id === req.admin!.sessionId) {
            throw new ValidationError("That is your own session: sign out instead.");
        }
        const revoked = await admins.revokeSessionById(id);
        if (!revoked) {
            throw new NotFoundError("That session is already over.");
        }
        await audit.record(req, "admin.session_revoke", {entityType: "admin", entityId: revoked.adminId, entityLabel: revoked.email, metadata: {sessionId: id}});
        res.json({message: "Session ended."});
    }));

    router.get("/admins", handle(async (_req, res) => {
        res.json({items: await auth.list()});
    }));

    router.post("/admins", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const admin = await auth.create({email: req.body?.email, name: req.body?.name, password: req.body?.password, role: req.body?.role ?? "readonly", mustChangePassword: true});
        await audit.record(req, "admin.create", {entityType: "admin", entityId: admin.id, entityLabel: admin.email, metadata: {role: admin.role}});
        res.status(201).json({admin});
    }));

    router.patch("/admins/:id", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const id = idParam(req);
        const admin = await auth.update(req.admin!, id, {
            role: req.body?.role,
            disabled: typeof req.body?.disabled === "boolean" ? req.body.disabled : undefined,
        });
        await audit.record(req, "admin.update", {entityType: "admin", entityId: id, entityLabel: admin.email, metadata: {role: req.body?.role, disabled: req.body?.disabled}});
        res.json({admin});
    }));

    router.post("/admins/:id/reset-2fa", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const id = idParam(req);
        const admin = await auth.resetTwoFactor(id);
        await audit.record(req, "admin.reset_2fa", {entityType: "admin", entityId: id, entityLabel: admin.email});
        res.json({admin});
    }));

    router.delete("/admins/:id", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const removed = await auth.remove(req.admin!, idParam(req));
        await audit.record(req, "admin.delete", {entityType: "admin", entityId: removed.id, entityLabel: removed.email});
        res.json({message: "Admin deleted."});
    }));

    return router;
}
