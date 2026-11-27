/**
 * Admin notifications (mounted at `/api/admin/notifications`). Which events send an email is edited with the
 * settings API (group "notifications"); this router covers who receives them and what was sent.
 *
 *  GET   /                   whether email is set up, and the admins with their subscription
 *  GET   /history            ?page=&pageSize=  what was emailed, and what was skipped
 *  PUT   /me                 `{notifyEmail}` subscribe / unsubscribe yourself
 *  PATCH /recipients/:id     `{notifyEmail}` the same for another admin (superadmin)
 *  POST  /test               sends a test notification to yourself
 */
import {Router} from "express";
import {Pool} from "pg";
import {NotFoundError, ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {handle, idParam, paging} from "../http";
import {requireSuperadmin} from "../middleware";
import {AdminUserRepository} from "../repositories/AdminUserRepository";
import {AdminAuditService} from "../services/AdminAuditService";

/**
 * @param pool Database pool.
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function notificationsRoutes(pool: Pool, audit: AdminAuditService): Router {
    const router = Router();
    const admins = new AdminUserRepository(pool);

    router.get("/", handle(async (req, res) => {
        const list = await admins.list();
        res.json({
            mailEnabled: appService.getMailService().isEnabled(),
            me: req.admin!.id,
            recipients: list.map((admin) => ({id: admin.id, email: admin.email, name: admin.name, role: admin.role, disabled: admin.disabled, notifyEmail: admin.notifyEmail})),
        });
    }));

    router.get("/history", handle(async (req, res) => {
        const {page, pageSize, limit, offset} = paging(req);
        const {rows, total} = await appService.getNotifier().listHistory(limit, offset);
        res.json({items: rows, total, page, pageSize});
    }));

    const setFlag = async (id: number, value: unknown) => {
        if (typeof value !== "boolean") {
            throw new ValidationError("notifyEmail must be true or false.");
        }
        const admin = await admins.findById(id);
        if (!admin) {
            throw new NotFoundError("Admin not found.");
        }
        await admins.setNotifyEmail(id, value);
        return admin;
    };

    router.put("/me", handle(async (req, res) => {
        const admin = await setFlag(req.admin!.id, req.body?.notifyEmail);
        await audit.record(req, "notifications.subscribe", {entityType: "admin", entityId: admin.id, entityLabel: admin.email, metadata: {notifyEmail: req.body.notifyEmail}});
        res.json({notifyEmail: req.body.notifyEmail});
    }));

    router.patch("/recipients/:id", requireSuperadmin, handle(async (req, res) => {
        const admin = await setFlag(idParam(req), req.body?.notifyEmail);
        await audit.record(req, "notifications.subscribe", {entityType: "admin", entityId: admin.id, entityLabel: admin.email, metadata: {notifyEmail: req.body.notifyEmail}});
        res.json({notifyEmail: req.body.notifyEmail});
    }));

    router.post("/test", handle(async (req, res) => {
        const mail = appService.getMailService();
        if (!mail.isEnabled()) {
            throw new ValidationError("Email isn't configured: set it up under Settings > Email first.");
        }
        const error = await mail.sendReportingError(
            req.admin!.email,
            "[Vaultisse] Test notification",
            "This is a test of the admin notifications. If you can read it, the portal can reach you by email.\n\nInstance " + appService.getInstanceUuid()
        );
        res.json({ok: error === null, error, to: req.admin!.email});
    }));

    return router;
}
