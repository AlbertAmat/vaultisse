/**
 * Data requests (mounted at `/api/admin/data-requests`): GDPR access and erasure requests with their deadline.
 *
 *  GET    /                    ?status=active|open|processing|completed|rejected
 *  POST   /                    `{kind: access|erasure, userId? | email, name?, receivedAt?, notes?}`
 *  POST   /:id/extend          `{reason}`   once, to three months from receipt
 *  POST   /:id/close           `{outcome: completed|rejected, resolution}`
 *  POST   /:id/erase           `{immediate?}`   carry out an erasure request through the deletion flow   [fresh verification]
 *  POST   /export/:userId      `{}` -> `{url}` a one-minute link to the personal-data export (ZIP) of an account   [fresh verification]
 *  GET    /export/:userId/:token   downloads it (single use)
 *
 * Example:
 *   POST /api/admin/data-requests
 *     {"kind": "erasure", "userId": 7, "receivedAt": "2026-11-01T10:00:00Z", "notes": "Email from the customer"}
 *     -> 201 {"item": {"id": 3, "kind": "erasure", "status": "open", "dueAt": "2026-12-01T10:00:00Z", "daysLeft": 4, ...}}
 *
 *   POST /api/admin/data-requests/export/7       (after a fresh verification)   -> {"url": "/api/admin/data-requests/export/7/<token>"}
 *   GET  <that url>                               -> a ZIP (once, within a minute, for the same admin)
 */
import crypto from "crypto";
import {Router} from "express";
import {Pool} from "pg";
import {NotFoundError, ValidationError} from "../../errors/DomainError";
import {handle, idParam, text} from "../http";
import {requireFreshAuth, requireSuperadmin} from "../middleware";
import {AdminAuditService} from "../services/AdminAuditService";
import {DataRequestService} from "../services/DataRequestService";

const STATUSES = ["active", "open", "processing", "completed", "rejected"];

/**
 * @param pool Database pool.
 * @param audit Admin audit trail.
 * @param service Data request service.
 * @returns The router.
 */
const tickets = new Map<string, {adminId: number; userId: number; expires: number}>();

export function dataRequestsRoutes(pool: Pool, audit: AdminAuditService, service: DataRequestService): Router {
    const router = Router();

    router.get("/", handle(async (req, res) => {
        const status = text(req.query.status);
        if (status && !STATUSES.includes(status)) throw new ValidationError("Unknown status.");
        res.json({items: await service.list(status), counts: await service.counts()});
    }));

    // The export is a sensitive download. A browser can't answer "verify again" in the middle of a download, so it
    // is two steps: a fresh verification buys a one-time link (valid for a minute, for this admin and this account),
    // and following the link downloads the file.
    router.post("/export/:userId", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId)) throw new ValidationError("Invalid account id.");
        for (const [key, ticket] of tickets) if (ticket.expires < Date.now()) tickets.delete(key);
        const token = crypto.randomBytes(24).toString("base64url");
        tickets.set(token, {adminId: req.admin!.id, userId, expires: Date.now() + 60 * 1000});
        res.json({url: `/api/admin/data-requests/export/${userId}/${token}`});
    }));

    router.get("/export/:userId/:token", requireSuperadmin, handle(async (req, res) => {
        const userId = Number(req.params.userId);
        const ticket = tickets.get(String(req.params.token));
        tickets.delete(String(req.params.token));
        if (!ticket || ticket.expires < Date.now() || ticket.adminId !== req.admin!.id || ticket.userId !== userId) {
            throw new NotFoundError("This download link has expired. Start the export again.");
        }
        const {zip, fileName} = await service.exportAccount(userId);
        await audit.record(req, "data_request.export", {entityType: "user", entityId: userId, metadata: {bytes: zip.length}});
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Cache-Control", "no-store");
        res.send(zip);
    }));

    router.post("/", requireSuperadmin, handle(async (req, res) => {
        const kind = req.body?.kind;
        if (kind !== "access" && kind !== "erasure") throw new ValidationError("The request is for access or for erasure.");
        const received = req.body?.receivedAt ? new Date(String(req.body.receivedAt)) : undefined;
        if (received && Number.isNaN(received.getTime())) throw new ValidationError("The date received isn't valid.");
        const userId = req.body?.userId === undefined || req.body?.userId === null ? undefined : Number(req.body.userId);
        if (userId !== undefined && !Number.isInteger(userId)) throw new ValidationError("Invalid account id.");
        const created = await service.create({kind, userId, email: req.body?.email, name: req.body?.name, receivedAt: received, notes: req.body?.notes}, req.admin!.id);
        await audit.record(req, "data_request.create", {entityType: "data_request", entityId: created.id, entityLabel: `${kind}: ${created.subjectEmail}`});
        res.status(201).json({item: created});
    }));

    router.post("/:id/extend", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        await service.extend(id, typeof req.body?.reason === "string" ? req.body.reason : "");
        await audit.record(req, "data_request.extend", {entityType: "data_request", entityId: id});
        res.json({item: await service.find(id)});
    }));

    router.post("/:id/close", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const outcome = req.body?.outcome;
        if (outcome !== "completed" && outcome !== "rejected") throw new ValidationError("Close it as completed or rejected.");
        await service.close(id, outcome, typeof req.body?.resolution === "string" ? req.body.resolution : "", req.admin!.id);
        await audit.record(req, "data_request.close", {entityType: "data_request", entityId: id, metadata: {outcome}});
        res.json({item: await service.find(id)});
    }));

    router.post("/:id/erase", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const id = idParam(req);
        const result = await service.erase(id, req.admin!.id, req.body?.immediate === true);
        await audit.record(req, "data_request.erase", {entityType: "data_request", entityId: id, metadata: {executed: result.executed, executeAfter: result.executeAfter}});
        res.json({...result, item: await service.find(id)});
    }));

    return router;
}
