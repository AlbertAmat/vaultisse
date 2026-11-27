/**
 * Server entry point. Loading `./AppService` runs its constructor (env vars,
 * Express app, DB pool, CSP/CORS/rate-limit middleware), and `init()` then
 * applies any pending database migrations, registers every route, and
 * starts the HTTP listener on `API_PORT`.
 *
 * Run with `npm start` (or `node dist/index.js` after `npm run build`). With an `admin:*` argument it
 * runs a command-line administration task instead (see admin/AdminCli.ts).
 */
import {appService} from "./AppService";
import {ADMIN_COMMANDS, runAdminCli} from "./admin/AdminCli";

const command = process.argv[2];

if (command && ADMIN_COMMANDS.includes(command)) {
    // `node index.js admin:create ...` - administration from the command line, no server is started.
    runAdminCli(command, process.argv.slice(3))
        .then((code) => appService.getDatabasePool().end().then(() => process.exit(code)))
        .catch((error) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        });
} else {
    appService.init();
}
