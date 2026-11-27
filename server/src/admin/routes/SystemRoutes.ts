/**
 * The System page (mounted at `/api/admin/system`; the short `/system` summary lives in SettingsRoutes).
 *
 *  GET  /details        installed version and update status, database (connection, status, size, tables),
 *                       the migrations that were run and when, and the runtime
 *  POST /check-updates  ask GitHub again now
 */
import {Router} from "express";
import {appService} from "../../AppService";
import {handle} from "../http";
import {describeExposure} from "../services/Exposure";

/** @returns The router. */
export function systemRoutes(): Router {
    const router = Router();

    router.get("/details", handle(async (req, res) => {
        const info = appService.getSystemInfo();
        const [version, database, migrations] = await Promise.all([
            appService.getUpdateChecker().status(),
            info.database(),
            info.migrations().catch(() => []),
        ]);
        res.json({
            instanceUuid: appService.getInstanceUuid(),
            version,
            database,
            migrations: {items: migrations, total: migrations.length},
            runtime: info.runtime(),
            exposure: describeExposure(req),
        });
    }));

    router.post("/check-updates", handle(async (_req, res) => {
        res.json(await appService.getUpdateChecker().status(true));
    }));

    return router;
}
