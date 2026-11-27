/**
 * Background jobs (mounted at `/api/admin/jobs`).
 *
 *  GET    /               every job with its last run, the estimate of the next one and its recent failures
 *  POST   /:id/run        runs it now and returns the result   [fresh verification for jobs that change or delete data]
 *  GET    /:id/history    the last 30 runs
 */
import {NextFunction, Request, Response, Router} from "express";
import {NotFoundError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {handle} from "../http";
import {requireFreshAuth, requireSuperadmin} from "../middleware";
import {AdminAuditService} from "../services/AdminAuditService";

/**
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function jobsRoutes(audit: AdminAuditService): Router {
    const router = Router();
    const jobs = () => appService.getJobs();

    router.get("/", handle(async (_req, res) => {
        res.json({items: await jobs().list()});
    }));

    router.post("/:id/run", requireSuperadmin, (req: Request, res: Response, next: NextFunction) => {
        // Running a job that deletes things on demand is as serious as the deletion itself.
        return jobs().definition(String(req.params.id))?.dangerous ? requireFreshAuth(req, res, next) : next();
    }, handle(async (req, res) => {
        const id = String(req.params.id);
        const run = await jobs().run(id, "manual", req.admin!.id);
        await audit.record(req, "job.run", {entityType: "job", entityLabel: id, metadata: {status: run.status, message: run.message}});
        res.json({run});
    }));

    router.get("/:id/history", handle(async (req, res) => {
        const id = String(req.params.id);
        if (!jobs().has(id)) throw new NotFoundError("Unknown job.");
        res.json({items: await jobs().history(id)});
    }));

    return router;
}
