/**
 * Account management (mounted at `/api/admin/users`).
 *
 * Only account metadata is ever exposed - never what is inside someone's libraries.
 *
 *  GET    /               ?search=&status=active|pending|disabled|pending_deletion|unverified&sort=&page=&pageSize=
 *  GET    /:id            account, vault memberships, live sessions, recent sign-in activity
 *  POST   /:id/approve    enable an account waiting for approval (and tell its owner if mail is on)
 *  POST   /:id/disable    lock an account out and end its sessions
 *  POST   /:id/enable     lift a lock
 *  POST   /:id/force-logout   end every session
 *  POST   /:id/reset-2fa  remove two-factor (lost phone)           [fresh verification]
 *  DELETE /:id            `{confirm: "<account code>", immediate?}` [fresh verification] schedules the deletion
 */
import {Router} from "express";
import {ConflictError, NotFoundError, ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {Pool} from "pg";
import {handle, idParam, paging, text} from "../http";
import {requireFreshAuth, requireSuperadmin} from "../middleware";
import {PlatformRepository, UserStatusFilter} from "../repositories/PlatformRepository";
import {AdminAuditService} from "../services/AdminAuditService";
import {DeletionService} from "../services/DeletionService";

const STATUSES: UserStatusFilter[] = ["active", "pending", "disabled", "pending_deletion", "unverified"];

/**
 * @param pool Database pool.
 * @param audit Admin audit trail.
 * @param deletions Deletion service.
 * @returns The router.
 */
export function usersRoutes(pool: Pool, audit: AdminAuditService, deletions: DeletionService): Router {
    const router = Router();
    const platform = new PlatformRepository(pool);

    const requireUser = async (id: number) => {
        const user = await platform.findUser(id);
        if (!user) {
            throw new NotFoundError("Account not found.");
        }
        return user;
    };

    router.get("/", handle(async (req, res) => {
        const {page, pageSize, limit, offset} = paging(req);
        const status = text(req.query.status);
        if (status && !STATUSES.includes(status as UserStatusFilter)) {
            throw new ValidationError("Unknown status.");
        }
        const sortParam = text(req.query.sort);
        const sort = sortParam === "lastLogin" || sortParam === "name" ? sortParam : "created";
        const {rows, total} = await platform.listUsers({search: text(req.query.search), status: status as UserStatusFilter | undefined}, sort, limit, offset);
        res.json({items: rows, total, page, pageSize});
    }));

    router.get("/:id", handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        const [memberships, sessionCount, activity] = await Promise.all([
            platform.userMemberships(id),
            platform.userSessionCount(id),
            platform.listActivity({actorId: id}, 20, 0),
        ]);
        res.json({user, memberships, sessionCount, recentActivity: activity.rows});
    }));

    router.post("/:id/approve", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        if (user.disabledReason !== "pending_approval") {
            throw new ConflictError("This account isn't waiting for approval.");
        }
        await platform.setUserDisabled(id, false, null);
        await audit.record(req, "user.approve", {entityType: "user", entityId: id, entityLabel: user.code});
        const mail = appService.getMailService();
        if (mail.isEnabled() && user.emailVerified) {
            void mail.send(user.email, "Your Vaultisse account was approved", `Hello ${user.name},\n\nYour account was approved. You can log in now:\n${mail.link("/login")}\n`);
        }
        res.json({user: await platform.findUser(id)});
    }));

    router.post("/:id/disable", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        if (user.disabledReason === "pending_deletion") {
            throw new ConflictError("A deletion is scheduled for this account; cancel it under Deletions first.");
        }
        await platform.setUserDisabled(id, true, "admin");
        await audit.record(req, "user.disable", {entityType: "user", entityId: id, entityLabel: user.code, metadata: {reason: text(req.body?.reason)?.slice(0, 200)}});
        res.json({user: await platform.findUser(id)});
    }));

    router.post("/:id/enable", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        if (user.disabledReason === "pending_deletion") {
            throw new ConflictError("A deletion is scheduled for this account; cancel it under Deletions instead.");
        }
        if (user.disabledReason === "pending_approval") {
            throw new ConflictError("This account is waiting for approval; use Approve.");
        }
        await platform.setUserDisabled(id, false, null);
        await audit.record(req, "user.enable", {entityType: "user", entityId: id, entityLabel: user.code});
        res.json({user: await platform.findUser(id)});
    }));

    router.post("/:id/force-logout", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        await platform.forceLogout(id);
        await audit.record(req, "user.force_logout", {entityType: "user", entityId: id, entityLabel: user.code});
        res.json({message: "Every session of this account was ended."});
    }));

    router.post("/:id/reset-2fa", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        await platform.resetUserTwoFactor(id);
        await audit.record(req, "user.reset_2fa", {entityType: "user", entityId: id, entityLabel: user.code});
        res.json({user: await platform.findUser(id)});
    }));

    router.delete("/:id", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        if (req.body?.confirm !== user.code) {
            throw new ValidationError(`Type the account's username (${user.code}) to confirm.`);
        }
        const result = await deletions.requestUserDeletion(req.admin!.id, id, req.body?.immediate === true);
        await audit.record(req, result.executed ? "user.delete" : "user.schedule_delete", {
            entityType: "user", entityId: id, entityLabel: user.code, metadata: {executeAfter: result.executeAfter, deletionId: result.deletionId},
        });
        res.json(result);
    }));

    return router;
}
