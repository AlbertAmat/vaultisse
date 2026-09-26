import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {DashboardService} from "../services/DashboardService";

/** Thin HTTP<->service glue for the Dashboard resource. Constructed once per process (see DashboardRoute.ts) and reused across requests. */
export class DashboardController {
    /**
     * @param pool Database connection pool, forwarded to a fresh DashboardService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * GET /dashboard - builds the dashboard's aggregate KPIs/chart data payload.
     * @param req Express request.
     * @param res Express response.
     */
    public async get(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            const data = await new DashboardService(this.pool).getDashboard(vaultId);
            res.json(data);
        } catch (err) {
            console.error(err);
            res.status(500).json({error: 'Failed to fetch dashboard data'});
        }
    }
}
