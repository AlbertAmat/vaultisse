import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {PolicyService} from "../services/PolicyService";

/** Thin HTTP<->service glue for the App resource (version info + the policy bootstrap payload). Constructed once per process (see AppRoute.ts) and reused across requests. */
export class AppController {
    /**
     * @param pool Database connection pool, forwarded to a fresh PolicyService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * GET /app/version - public health check reporting the running app version and process uptime.
     * @param req Express request.
     * @param res Express response.
     */
    public getVersion(req: Request, res: Response): void {
        res.json({
            version: process.env.APP_VERSION || "dev",
            uptime: process.uptime(),
        });
    }

    /**
     * GET /app/policy - builds and returns the bootstrap payload fetched once after login.
     * @param req Express request.
     * @param res Express response.
     */
    public async getPolicy(req: Request, res: Response): Promise<void> {
        try {
            const userId = appService.getSessionUser(req);
            const policy = await new PolicyService(this.pool).getPolicy(userId, req.vaultId, appService.getMaxImportFileSizeMb());
            res.status(200).json(policy);
        } catch (err) {
            // The original handler had no top-level try/catch, so a failure in
            // UserRepository.getProfile (the one call outside the per-section
            // try/catch below it - e.g. a token whose user row no longer
            // exists) would reject uncaught. Added here for the same reason
            // every other controller in this refactor has one - a clean 500
            // instead of an unhandled rejection. Minor behavior addition, not
            // a preserved quirk.
            console.error("Error building policy payload:", err);
            res.status(500).send("Internal Server Error");
        }
    }
}
