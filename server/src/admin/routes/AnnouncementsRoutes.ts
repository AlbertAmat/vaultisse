/**
 * Announcements and maintenance mode (mounted at `/api/admin/announcements`).
 *
 *  GET    /               every announcement with its state, and the maintenance state
 *  POST   /               `{message, level, startsAt?, endsAt?}`   a banner for every user of the app
 *  PUT    /:id            `{message, level, startsAt, endsAt, enabled}`
 *  DELETE /:id
 *  PUT    /maintenance    `{enabled, message?}`  read-only mode for the whole app  [fresh verification to turn on]
 *
 * Example:
 *   POST /api/admin/announcements   {"message": "Maintenance tonight at 22:00", "level": "warning", "endsAt": "2026-11-28T06:00:00Z"}
 *   PUT  /api/admin/announcements/maintenance   (fresh verification to turn on)   {"enabled": true, "message": "Back at 22:30"}
 */
import {NextFunction, Request, Response, Router} from "express";
import {Pool} from "pg";
import {NotFoundError, ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {handle, idParam} from "../http";
import {requireFreshAuth, requireSuperadmin} from "../middleware";
import {AnnouncementLevel, AnnouncementRepository, AnnouncementRow} from "../repositories/AnnouncementRepository";
import {AdminAuditService} from "../services/AdminAuditService";

const LEVELS: AnnouncementLevel[] = ["info", "warning", "critical"];

/** @returns Where the announcement stands right now. */
function stateOf(row: AnnouncementRow): "active" | "scheduled" | "expired" | "off" {
    const now = Date.now();
    if (!row.enabled) return "off";
    if (new Date(row.startsAt).getTime() > now) return "scheduled";
    if (row.endsAt && new Date(row.endsAt).getTime() <= now) return "expired";
    return "active";
}

function parseFields(body: any, defaults: {startsAt: Date}) {
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 500) {
        throw new ValidationError("Write a message of up to 500 characters.");
    }
    const level = body?.level ?? "info";
    if (!LEVELS.includes(level)) {
        throw new ValidationError("Level must be info, warning or critical.");
    }
    const date = (value: unknown, label: string): Date | null => {
        if (value === undefined || value === null || value === "") return null;
        const parsed = new Date(String(value));
        if (Number.isNaN(parsed.getTime())) throw new ValidationError(`${label} isn't a valid date.`);
        return parsed;
    };
    const startsAt = date(body?.startsAt, "The start") ?? defaults.startsAt;
    const endsAt = date(body?.endsAt, "The end");
    if (endsAt && endsAt <= startsAt) {
        throw new ValidationError("The end must be after the start.");
    }
    return {message, level: level as AnnouncementLevel, startsAt, endsAt};
}

/**
 * @param pool Database pool.
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function announcementsRoutes(pool: Pool, audit: AdminAuditService): Router {
    const router = Router();
    const repo = new AnnouncementRepository(pool);

    router.get("/", handle(async (_req, res) => {
        const items = (await repo.list()).map((row) => ({...row, state: stateOf(row)}));
        res.json({items, maintenance: appService.getNotices().maintenance()});
    }));

    // Registered before "/:id" so "maintenance" isn't read as an id.
    router.put("/maintenance", requireSuperadmin, (req: Request, res: Response, next: NextFunction) => {
        // Turning it on stops every change for every user, so it needs a fresh verification.
        return req.body?.enabled === true ? requireFreshAuth(req, res, next) : next();
    }, handle(async (req, res) => {
        if (typeof req.body?.enabled !== "boolean") {
            throw new ValidationError("enabled must be true or false.");
        }
        const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        if (message.length > 500) {
            throw new ValidationError("The message can be up to 500 characters.");
        }
        await appService.getNotices().setMaintenance(req.body.enabled, message);
        await audit.record(req, req.body.enabled ? "maintenance.on" : "maintenance.off", {entityType: "maintenance", metadata: {message: message || null}});
        res.json({maintenance: appService.getNotices().maintenance()});
    }));

    router.post("/", requireSuperadmin, handle(async (req, res) => {
        const fields = parseFields(req.body, {startsAt: new Date()});
        const id = await repo.create({...fields, adminId: req.admin!.id});
        await appService.getNotices().refresh();
        await audit.record(req, "announcement.create", {entityType: "announcement", entityId: id, entityLabel: fields.message.slice(0, 80), metadata: {level: fields.level, endsAt: fields.endsAt}});
        res.status(201).json({announcement: await repo.find(id)});
    }));

    router.put("/:id", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const existing = await repo.find(id);
        if (!existing) {
            throw new NotFoundError("Announcement not found.");
        }
        const fields = parseFields(req.body, {startsAt: existing.startsAt});
        await repo.update(id, {...fields, enabled: req.body?.enabled !== false});
        await appService.getNotices().refresh();
        await audit.record(req, "announcement.update", {entityType: "announcement", entityId: id, entityLabel: fields.message.slice(0, 80)});
        res.json({announcement: await repo.find(id)});
    }));

    router.delete("/:id", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const existing = await repo.find(id);
        if (!existing) {
            throw new NotFoundError("Announcement not found.");
        }
        await repo.remove(id);
        await appService.getNotices().refresh();
        await audit.record(req, "announcement.delete", {entityType: "announcement", entityId: id, entityLabel: existing.message.slice(0, 80)});
        res.json({message: "Announcement removed."});
    }));

    return router;
}
