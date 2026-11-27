/**
 * Security overview (mounted at `/api/admin/security`).
 *
 *  GET    /summary          events of the last 24h by type, locked accounts, blocked addresses, live traffic
 *  GET    /traffic          requests per minute for the last hour and the busiest addresses right now
 *  GET    /events           ?type=&ip=&page=  aggregated per address and minute
 *  GET    /top-ips          ?hours=  the addresses behind most security events
 *  GET    /lockouts         accounts currently locked after failed logins;  POST /lockouts/:userId/clear
 *  GET    /blocked-ips      POST `{ip, reason?, hours?}`  DELETE /blocked-ips/:ip
 *  GET    /sessions         live sessions of the regular users;  POST /sessions/:id/revoke
 *
 * About DDoS: this app can show a flood and who is behind it, and refuse addresses on the blocklist, but it
 * can't absorb a real distributed attack. That has to be stopped in front of it (CDN / reverse proxy / firewall).
 */
import net from "net";
import {Router} from "express";
import {Pool} from "pg";
import {ConflictError, NotFoundError, ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {handle, idParam, paging, text} from "../http";
import {requireSuperadmin} from "../middleware";
import {SecurityRepository} from "../repositories/SecurityRepository";
import {AdminAuditService} from "../services/AdminAuditService";

const HOUR_MS = 60 * 60 * 1000;

/**
 * @param pool Database pool.
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function securityRoutes(pool: Pool, audit: AdminAuditService): Router {
    const router = Router();
    const repo = new SecurityRepository(pool);

    router.get("/summary", handle(async (_req, res) => {
        await appService.getSecurityEvents().flush();
        const since = new Date(Date.now() - 24 * HOUR_MS);
        const series = appService.getTrafficMonitor().series();
        const lastHour = series.reduce((sum, point) => ({
            total: sum.total + point.total, clientErrors: sum.clientErrors + point.clientErrors,
            serverErrors: sum.serverErrors + point.serverErrors, rateLimited: sum.rateLimited + point.rateLimited,
        }), {total: 0, clientErrors: 0, serverErrors: 0, rateLimited: 0});
        res.json({
            events24h: await repo.countByType(since),
            lockedAccounts: (await repo.listLockouts()).length,
            blockedIps: (await repo.listBlockedIps()).length,
            lastHour,
        });
    }));

    router.get("/traffic", handle(async (_req, res) => {
        const monitor = appService.getTrafficMonitor();
        res.json({series: monitor.series(), topIps: monitor.topIps(15)});
    }));

    router.get("/events", handle(async (req, res) => {
        await appService.getSecurityEvents().flush();
        const {page, pageSize, limit, offset} = paging(req);
        const {rows, total} = await repo.listEvents({type: text(req.query.type), ip: text(req.query.ip)}, limit, offset);
        res.json({items: rows, total, page, pageSize});
    }));

    router.get("/top-ips", handle(async (req, res) => {
        await appService.getSecurityEvents().flush();
        const hours = Math.min(24 * 30, Math.max(1, Math.floor(Number(req.query.hours)) || 24));
        res.json({items: await repo.topIps(new Date(Date.now() - hours * HOUR_MS), 20)});
    }));

    router.get("/lockouts", handle(async (_req, res) => {
        res.json({items: await repo.listLockouts()});
    }));

    router.post("/lockouts/:userId/clear", requireSuperadmin, handle(async (req, res) => {
        const userId = idParam(req, "userId");
        if (!(await repo.clearLockout(userId))) {
            throw new NotFoundError("Account not found.");
        }
        await audit.record(req, "security.clear_lockout", {entityType: "user", entityId: userId});
        res.json({message: "Lockout cleared."});
    }));

    router.get("/blocked-ips", handle(async (_req, res) => {
        res.json({items: await repo.listBlockedIps()});
    }));

    router.post("/blocked-ips", requireSuperadmin, handle(async (req, res) => {
        const ip = text(req.body?.ip);
        if (!ip || net.isIP(ip) === 0) {
            throw new ValidationError("Enter a valid IPv4 or IPv6 address.");
        }
        if (ip === req.ip) {
            throw new ConflictError("That is your own address - blocking it would lock you out.");
        }
        const hours = req.body?.hours === undefined || req.body?.hours === null || req.body?.hours === "" ? null : Number(req.body.hours);
        if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365)) {
            throw new ValidationError("Hours must be a positive number, or empty for no end.");
        }
        const reason = text(req.body?.reason)?.slice(0, 200) ?? null;
        await repo.blockIp(ip, reason, req.admin!.id, hours === null ? null : new Date(Date.now() + hours * HOUR_MS));
        await appService.getBlockedIps().refresh();
        await audit.record(req, "security.block_ip", {entityType: "ip", entityLabel: ip, metadata: {reason, hours}});
        res.status(201).json({items: await repo.listBlockedIps()});
    }));

    router.delete("/blocked-ips/:ip", requireSuperadmin, handle(async (req, res) => {
        const ip = String(req.params.ip);
        if (!(await repo.unblockIp(ip))) {
            throw new NotFoundError("That address isn't blocked.");
        }
        await appService.getBlockedIps().refresh();
        await audit.record(req, "security.unblock_ip", {entityType: "ip", entityLabel: ip});
        res.json({items: await repo.listBlockedIps()});
    }));

    router.get("/sessions", handle(async (req, res) => {
        const {page, pageSize, limit, offset} = paging(req);
        const {rows, total} = await repo.listActiveUserSessions(new Date(Date.now() - 30 * 24 * HOUR_MS), limit, offset);
        res.json({items: rows, total, page, pageSize});
    }));

    router.post("/sessions/:id/revoke", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        if (!(await repo.revokeUserSession(id))) {
            throw new NotFoundError("Session not found.");
        }
        await audit.record(req, "security.revoke_session", {entityType: "session", entityId: id});
        res.json({message: "Session ended."});
    }));

    return router;
}
