/**
 * Account management (mounted at `/api/admin/users`).
 *
 * Only account metadata is ever exposed - never what is inside someone's libraries.
 *
 *  GET    /               ?search=&status=active|pending|disabled|pending_deletion|unverified&sort=&page=&pageSize=
 *  GET    /tags           every tag in use
 *  PUT    /:id/tags       `{tags}` replace the tags;  POST /:id/notes `{body}`;  DELETE /:id/notes/:noteId   (private admin notes)
 *  GET    /:id            account, vault memberships, live sessions, recent sign-in activity
 *  POST   /:id/email      `{email, verified?}` change the address                    [fresh verification]
 *  POST   /:id/merge      `{sourceId, confirm}` fold another account into this one    [fresh verification]
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
import {AccountSupportService, maskEmail} from "../services/AccountSupportService";
import {AccountNotesRepository} from "../repositories/AccountNotesRepository";
import {PlatformRepository, UserStatusFilter} from "../repositories/PlatformRepository";
import {AdminAuditService} from "../services/AdminAuditService";
import {DeletionService} from "../services/DeletionService";
import {ACCOUNT_ACTIONS, AccountAction, AccountActions} from "../services/AccountActions";

const MAX_BULK = 500;
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
    const actions = new AccountActions(pool, audit, deletions);
    const notes = new AccountNotesRepository(pool);
    const support = new AccountSupportService(pool);

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
        const {rows, total} = await platform.listUsers({search: text(req.query.search), status: status as UserStatusFilter | undefined, tag: text(req.query.tag)}, sort, limit, offset);
        res.json({items: rows, total, page, pageSize});
    }));

    router.get("/tags", handle(async (_req, res) => {
        res.json({items: await notes.allTags()});
    }));

    router.get("/:id", handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        const [memberships, sessionCount, activity, accountNotes] = await Promise.all([
            platform.userMemberships(id),
            platform.userSessionCount(id),
            platform.listActivity({actorId: id}, 20, 0),
            notes.notes(id),
        ]);
        res.json({user, memberships, sessionCount, recentActivity: activity.rows, notes: accountNotes});
    }));

    router.post("/:id/notes", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
        if (!body || body.length > 2000) {
            throw new ValidationError("Write a note of up to 2000 characters.");
        }
        const noteId = await notes.addNote(id, body, req.admin!.id);
        await audit.record(req, "user.note_add", {entityType: "user", entityId: id, entityLabel: user.code, metadata: {noteId}});
        res.status(201).json({notes: await notes.notes(id)});
    }));

    router.delete("/:id/notes/:noteId", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        const noteId = Number(req.params.noteId);
        if (!Number.isInteger(noteId) || !(await notes.removeNote(id, noteId))) {
            throw new NotFoundError("Note not found.");
        }
        await audit.record(req, "user.note_remove", {entityType: "user", entityId: id, entityLabel: user.code, metadata: {noteId}});
        res.json({notes: await notes.notes(id)});
    }));

    router.put("/:id/tags", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        const raw = req.body?.tags;
        if (!Array.isArray(raw) || raw.length > 12) {
            throw new ValidationError("Give up to 12 tags.");
        }
        const tags = [...new Set(raw.map((tag: unknown) => (typeof tag === "string" ? tag.trim().toLowerCase().replace(/\s+/g, "-") : "")))];
        if (tags.some((tag) => !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,29}$/u.test(tag))) {
            throw new ValidationError("A tag is 1 to 30 letters, digits, dashes or underscores.");
        }
        await notes.setTags(id, tags, req.admin!.id);
        await audit.record(req, "user.tags", {entityType: "user", entityId: id, entityLabel: user.code, metadata: {tags}});
        res.json({tags});
    }));

    router.post("/:id/email", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const id = idParam(req);
        const user = await requireUser(id);
        const result = await support.changeEmail(id, req.body?.email, req.body?.verified === true);
        await audit.record(req, "user.change_email", {
            entityType: "user", entityId: id, entityLabel: user.code,
            metadata: {from: maskEmail(result.oldEmail), to: maskEmail(result.email), verified: result.verified, oldAddressNotified: result.notified},
        });
        res.json({email: result.email, verified: result.verified, notified: result.notified, user: await platform.findUser(id)});
    }));

    router.post("/:id/merge", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const targetId = idParam(req);
        const target = await requireUser(targetId);
        const sourceId = Number(req.body?.sourceId);
        if (!Number.isInteger(sourceId)) {
            throw new ValidationError("Choose the account to merge into this one.");
        }
        const source = await requireUser(sourceId);
        if (req.body?.confirm !== source.code) {
            throw new ValidationError(`Type the username of the account that will disappear (${source.code}) to confirm.`);
        }
        const result = await support.merge(targetId, sourceId);
        await audit.record(req, "user.merge", {
            entityType: "user", entityId: targetId, entityLabel: target.code,
            metadata: {mergedAccount: source.code, ...result},
        });
        res.json({...result, user: await platform.findUser(targetId)});
    }));

    router.post("/:id/approve", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        await actions.approve(req, id);
        res.json({user: await platform.findUser(id)});
    }));

    router.post("/:id/disable", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        await actions.disable(req, id, text(req.body?.reason));
        res.json({user: await platform.findUser(id)});
    }));

    router.post("/:id/enable", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        await actions.enable(req, id);
        res.json({user: await platform.findUser(id)});
    }));

    router.post("/:id/force-logout", requireSuperadmin, handle(async (req, res) => {
        await actions.forceLogout(req, idParam(req));
        res.json({message: "Every session of this account was ended."});
    }));

    /**
     * POST /bulk  `{action, ids?: number[], status?: "pending" | ...}`
     * The same action on many accounts at once: `ids` for a selection, or `status` for "everyone with this
     * status" (approve all pending). Each account is handled on its own, with its own audit entry; one that
     * can't be (say, it is already approved) is reported and the rest carry on. Deleting needs a fresh
     * verification and `confirm: "DELETE"`, and still goes through the grace period.
     */
    router.post("/bulk", requireSuperadmin, (req, res, next) => (req.body?.action === "delete" ? requireFreshAuth(req, res, next) : next()), handle(async (req, res) => {
        const action = req.body?.action as AccountAction;
        if (!ACCOUNT_ACTIONS.includes(action)) {
            throw new ValidationError("Unknown action.");
        }
        if (action === "delete" && req.body?.confirm !== "DELETE") {
            throw new ValidationError("Type DELETE to confirm.");
        }
        let ids: number[];
        if (Array.isArray(req.body?.ids)) {
            ids = [...new Set<number>((req.body.ids as unknown[]).map(Number))].filter((id) => Number.isInteger(id) && id > 0);
        } else if (typeof req.body?.status === "string" && STATUSES.includes(req.body.status)) {
            ids = await actions.idsWithStatus(req.body.status, MAX_BULK);
        } else {
            throw new ValidationError("Select accounts first.");
        }
        if (ids.length === 0) {
            throw new ValidationError("Select accounts first.");
        }
        if (ids.length > MAX_BULK) {
            throw new ValidationError(`Up to ${MAX_BULK} accounts at a time.`);
        }
        const results = [];
        for (const id of ids) {
            results.push(await actions.apply(req, action, id, text(req.body?.reason)));
        }
        const ok = results.filter((result) => result.ok).length;
        await audit.record(req, "user.bulk", {entityType: "user", metadata: {action, requested: ids.length, ok, failed: ids.length - ok}});
        res.json({results, ok, failed: results.length - ok});
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
