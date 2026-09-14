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

router.get('/version', (req, res) => getAppController().getVersion(req, res));
router.get('/policy', requireAuth, (req, res) => getAppController().getPolicy(req, res));

export default router;
