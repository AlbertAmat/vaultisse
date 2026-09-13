/**
 * Wires up one fresh `AppService` (routes mounted, HTTP server listening on
 * an OS-assigned free port per `API_PORT=0` - see test/setup/testEnv.js) for
 * a test file, and tears it down afterward. Each test file gets its own
 * isolated module registry (a Jest default), so this is safe to call once
 * per file without any cross-file interference.
 *
 * Usage: `const app = setupTestApp();` at the top of a describe block, then
 * `request(app).get(...)` as usual.
 */
import {Express} from "express";
import {appService} from "../../src/AppService";

export function setupTestApp(): Express {
    beforeAll(async () => {
        await appService.init();
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => appService.getServer()?.close(() => resolve()));
        await appService.getDatabasePool().end();
    });

    return appService.getApp();
}
