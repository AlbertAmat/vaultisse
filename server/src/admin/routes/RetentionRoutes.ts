/**
 * Data retention (mounted at `/api/admin/retention`).
 *
 *  GET    /      every kind of record with how long it is kept, how much there is, the oldest and how much is already past its period
 *
 * The periods themselves are saved like any other setting (`PUT /api/admin/settings`, keys `RETENTION_*_DAYS`).
 *
 * Example:
 *   GET /api/admin/retention
 *     -> {"auditFloorDays": 90, "items": [{"id": "mail_log", "key": "RETENTION_MAIL_LOG_DAYS", "days": 90, "defaultDays": 90,
 *                                          "rows": 138, "oldest": "2026-08-31T...", "overdue": 0, "personal": true, "minDays": 1}, ...]}
 *   Save with: PUT /api/admin/settings {"changes": {"RETENTION_MAIL_LOG_DAYS": "60"}}
 */
import {Router} from "express";
import {handle} from "../http";
import {AUDIT_FLOOR_DAYS, RetentionService} from "../services/RetentionService";

/**
 * @param retention Retention service.
 * @returns The router.
 */
export function retentionRoutes(retention: RetentionService): Router {
    const router = Router();

    router.get("/", handle(async (_req, res) => {
        res.json({items: await retention.overview(), auditFloorDays: AUDIT_FLOOR_DAYS});
    }));

    return router;
}
