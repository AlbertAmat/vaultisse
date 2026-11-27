/**
 * Emails to the users (mounted at `/api/admin/broadcast`).
 *
 *  GET  /audiences        who can be addressed, with live counts
 *  POST /preview          `{audience, subject, body}`  exact recipient count, sample addresses, the email as it reads
 *  POST /test             `{subject, body}`            sends it to yourself only
 *  POST /                 `{audience, subject, body, expectedCount}`  sends it  [fresh verification]
 *  GET  /                 history
 *  GET  /:id              one broadcast (progress while it is sending)
 *  POST /:id/cancel       stop a broadcast that is still sending
 *
 * Example:
 *   POST /api/admin/broadcast/preview  {"audience": "all", "subject": "Planned maintenance", "body": "Hello {name}, ..."}
 *     -> {"count": 7, "sample": ["a****@example.com", ...], "email": {"subject": "...", "text": "Hello Administrator, ..."}}
 *   POST /api/admin/broadcast           {"audience": "all", "subject": "...", "body": "...", "expectedCount": 7}   -> 409 when the audience is not 7 any more
 */
import {Router} from "express";
import {ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {handle, idParam, paging} from "../http";
import {requireFreshAuth, requireSuperadmin} from "../middleware";
import {AdminAuditService} from "../services/AdminAuditService";
import {AUDIENCES, BroadcastService} from "../services/BroadcastService";

/**
 * @param broadcasts Broadcast service.
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function broadcastRoutes(broadcasts: BroadcastService, audit: AdminAuditService): Router {
    const router = Router();

    router.get("/audiences", handle(async (_req, res) => {
        const items = await Promise.all(AUDIENCES.map(async (audience) => ({...audience, count: (await broadcasts.recipients(audience.value)).length})));
        res.json({items, mailEnabled: appService.getMailService().isEnabled()});
    }));

    router.post("/preview", handle(async (req, res) => {
        const {subject, body} = BroadcastService.validate(req.body?.subject, req.body?.body);
        res.json(await broadcasts.preview(String(req.body?.audience ?? ""), subject, body, req.admin!.name));
    }));

    router.post("/test", requireSuperadmin, handle(async (req, res) => {
        const {subject, body} = BroadcastService.validate(req.body?.subject, req.body?.body);
        const error = await broadcasts.sendTest(req.admin!.email, req.admin!.name, subject, body);
        res.json({ok: error === null, error, to: req.admin!.email});
    }));

    router.post("/", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const {subject, body} = BroadcastService.validate(req.body?.subject, req.body?.body);
        const expected = Number(req.body?.expectedCount);
        if (!Number.isInteger(expected) || expected < 1) {
            throw new ValidationError("Preview the audience first.");
        }
        const row = await broadcasts.send(req.admin!.id, String(req.body?.audience ?? ""), subject, body, expected);
        await audit.record(req, "broadcast.send", {entityType: "broadcast", entityId: row.id, entityLabel: subject.slice(0, 80), metadata: {audience: row.audience, recipients: row.recipients}});
        res.status(202).json({broadcast: row});
    }));

    router.get("/", handle(async (req, res) => {
        const {page, pageSize, limit, offset} = paging(req);
        const {rows, total} = await broadcasts.list(limit, offset);
        res.json({items: rows, total, page, pageSize});
    }));

    router.get("/:id", handle(async (req, res) => {
        const row = await broadcasts.find(idParam(req));
        if (!row) {
            res.status(404).json({message: "Broadcast not found."});
            return;
        }
        res.json({broadcast: row});
    }));

    router.post("/:id/cancel", requireSuperadmin, handle(async (req, res) => {
        const row = await broadcasts.cancel(idParam(req));
        await audit.record(req, "broadcast.cancel", {entityType: "broadcast", entityId: row.id, entityLabel: row.subject.slice(0, 80)});
        res.json({message: "Stopping. What was already sent stays sent."});
    }));

    return router;
}
