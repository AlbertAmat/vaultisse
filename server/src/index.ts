/**
 * Server entry point. Loading `./AppService` runs its constructor (env vars,
 * Express app, DB pool, CSP/CORS/rate-limit middleware), and `init()` then
 * applies any pending database migrations, registers every route, and
 * starts the HTTP listener on `API_PORT`.
 *
 * Run with `npm start` (or `node dist/index.js` after `npm run build`).
 */
import {appService} from "./AppService";
import dotenv from 'dotenv';

appService.init();
