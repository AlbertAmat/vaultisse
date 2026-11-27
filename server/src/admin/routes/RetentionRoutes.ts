/**
 * Data retention (mounted at `/api/admin/retention`).
 *
 *  GET    /      every kind of record with how long it is kept, how much there is, the oldest and how much is already past its period
 *
 * The periods themselves are saved like any other setting (`PUT /api/admin/settings`, keys `RETENTION_*_DAYS`).
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
