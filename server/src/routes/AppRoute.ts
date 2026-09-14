/**
 * =============================================================================
 * AppRoute
 * =============================================================================
 * Mounted at `/api/rest/app`. General application-level endpoints: a public
 * health check, and the "policy" bootstrap payload the client fetches once
 * on login to hydrate its dropdowns/labels/locale. See
 * AppController/PolicyService/AppRepository (+ UserRepository for the
 * profile/acknowledgement pieces) for the actual request handling, business
 * rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {AppController} from "../controllers/AppController";
import {lazy} from "./lazySingleton";

const router = Router();
const getAppController = lazy(() => new AppController(appService.getDatabasePool()));

/**
 * GET /app/version
 * -------------------
 * Public health check reporting the running app version and process uptime.
 *
 * Auth: none.
 *
 * Example response (200): { "version": "1.1.9", "uptime": 1234.56 }
 */
router.get('/version', (req, res) => getAppController().getVersion(req, res));

/**
 * GET /app/policy
 * ------------------
 * Bootstrap payload fetched once after login: the current user's profile plus every reference list
 * (categories, languages, formats, locations, customers) and UI label translations needed to render
 * the app. Each section is fetched independently and defaults to `[]`/`{}` on failure.
 *
 * Auth: required.
 *
 * Example response (200):
 *  { "user": { "code": "jdoe", "name": "Jane Doe", "email": "jane@example.com", "language": "en", "region": "US",
 *    "image": null, "theme": "beige", "sidebarRail": false, "leasingEnabled": false, "isPublicInstitution": false,
 *    "totpEnabled": false, "securityNoticeAccepted": true, "termsOfServiceAccepted": true },
 *    "categories": [{ "id": 1, "name": "Fiction" }], "languages": [{ "code": "en", "name": "English" }],
 *    "formats": [{ "id": 1, "name": "Paperback" }], "locations": [{ "id": 1, "name": "Shelf", "description": "", "default": true }],
 *    "customers": [{ "id": 7, "name": "Jane Doe" }], "labels": { "some.label.code": "Translated text" },
 *    "maxImportFileSizeMb": 10 }
 */
router.get('/policy', requireAuth, (req, res) => getAppController().getPolicy(req, res));

export default router;
