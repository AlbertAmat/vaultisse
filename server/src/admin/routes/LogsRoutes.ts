/**
 * Logs (mounted at `/api/admin/logs`).
 *
 *  GET /activity   sign-in activity of the regular users (`activity_log`)  ?action=&actorId=&ip=&page=
 *  GET /server     tail of the server log file  ?lines=&level=info|warn|error&q=
 *  GET /audit      what the admins did (`admin_audit_log`)  ?action=&adminId=&entityType=&page=
 *
 * The server log can contain user names and addresses (and, with DEBUG_LOGGING on, more): it is admin-only.
 */
import fs from "fs/promises";
import {Router} from "express";
import {Pool} from "pg";
import {ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {handle, paging, text} from "../http";
import {PlatformRepository} from "../repositories/PlatformRepository";
import {AdminAuditService} from "../services/AdminAuditService";

/** How much of the end of the log file is read to find the requested lines. */
const TAIL_BYTES = 512 * 1024;

/**
 * @param path Log file.
 * @returns Its last lines (up to TAIL_BYTES of it), oldest first; empty when it can't be read.
 */
async function readTail(path: string): Promise<string[]> {
    let handleToFile: fs.FileHandle | null = null;
    try {
        handleToFile = await fs.open(path, "r");
        const {size} = await handleToFile.stat();
        const length = Math.min(size, TAIL_BYTES);
        const buffer = Buffer.alloc(length);
        await handleToFile.read(buffer, 0, length, size - length);
        const lines = buffer.toString("utf8").split("\n").filter((line) => line.length > 0);
        // The first line may be cut in half when we started mid-file.
        return size > length ? lines.slice(1) : lines;
    } catch {
        return [];
    } finally {
        await handleToFile?.close();
    }
}

/**
 * @param pool Database pool.
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function logsRoutes(pool: Pool, audit: AdminAuditService): Router {
    const router = Router();
    const platform = new PlatformRepository(pool);

    router.get("/activity", handle(async (req, res) => {
        const {page, pageSize, limit, offset} = paging(req);
        const actorId = req.query.actorId === undefined ? undefined : Number(req.query.actorId);
        if (actorId !== undefined && !Number.isInteger(actorId)) {
            throw new ValidationError("Invalid account id.");
        }
        const {rows, total} = await platform.listActivity({action: text(req.query.action), actorId, ip: text(req.query.ip)}, limit, offset);
        res.json({items: rows, total, page, pageSize});
    }));

    router.get("/server", handle(async (req, res) => {
        const lines = Math.min(1000, Math.max(10, Math.floor(Number(req.query.lines)) || 200));
        const level = text(req.query.level)?.toUpperCase();
        if (level && !["INFO", "WARN", "ERROR", "DEBUG"].includes(level)) {
            throw new ValidationError("Unknown level.");
        }
        const query = text(req.query.q)?.toLowerCase();
        const all = await readTail(appService.getLogger().getLogFilePath());
        const filtered = all.filter((line) => (!level || line.includes(`[${level}]`)) && (!query || line.toLowerCase().includes(query)));
        res.json({lines: filtered.slice(-lines), scannedLines: all.length});
    }));

    router.get("/audit", handle(async (req, res) => {
        const {page, pageSize, limit, offset} = paging(req);
        const adminId = req.query.adminId === undefined ? undefined : Number(req.query.adminId);
        if (adminId !== undefined && !Number.isInteger(adminId)) {
            throw new ValidationError("Invalid admin id.");
        }
        const {rows, total} = await audit.list({action: text(req.query.action), adminId, entityType: text(req.query.entityType)}, limit, offset);
        res.json({items: rows, total, page, pageSize});
    }));

    return router;
}
