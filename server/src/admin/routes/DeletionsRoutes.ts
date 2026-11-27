/**
 * Deletions waiting out their grace period (mounted at `/api/admin/deletions`).
 *
 *  GET  /               ?open=false to include cancelled and executed ones; ?page=&pageSize=
 *  POST /:id/cancel     lift the lock-out; nothing is deleted
 *  POST /:id/execute    delete now, without waiting  [fresh verification]
 */
import {Router} from "express";
import {handle, idParam, paging} from "../http";
import {requireFreshAuth, requireSuperadmin} from "../middleware";
import {AdminAuditService} from "../services/AdminAuditService";
import {DeletionService} from "../services/DeletionService";

/**
 * @param audit Admin audit trail.
 * @param deletions Deletion service.
 * @returns The router.
 */
export function deletionsRoutes(audit: AdminAuditService, deletions: DeletionService): Router {
    const router = Router();

    router.get("/", handle(async (req, res) => {
        const {page, pageSize, limit, offset} = paging(req);
        const {rows, total} = await deletions.list(req.query.open !== "false", limit, offset);
        res.json({items: rows, total, page, pageSize});
    }));

    router.post("/:id/cancel", requireSuperadmin, handle(async (req, res) => {
        const deletion = await deletions.cancel(idParam(req));
        await audit.record(req, `${deletion.entityType}.cancel_delete`, {entityType: deletion.entityType, entityId: deletion.entityId, entityLabel: deletion.entityLabel, metadata: {deletionId: deletion.id}});
        res.json({message: "Deletion cancelled."});
    }));

    router.post("/:id/execute", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const deletion = await deletions.execute(idParam(req));
        await audit.record(req, `${deletion.entityType}.delete`, {entityType: deletion.entityType, entityId: deletion.entityId, entityLabel: deletion.entityLabel, metadata: {deletionId: deletion.id, early: true}});
        res.json({message: "Deleted."});
    }));

    return router;
}
