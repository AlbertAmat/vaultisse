/**
 * =============================================================================
 * DashboardRoute
 * =============================================================================
 * Mounted at `/api/rest/dashboard`. A single read-only aggregate endpoint
 * powering the dashboard view's KPIs and charts. See
 * DashboardController/DashboardService/DashboardRepository for the actual
 * request handling, business rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {DashboardController} from "../controllers/DashboardController";
import {lazy} from "./lazySingleton";

const router = Router();
const getDashboardController = lazy(() => new DashboardController(appService.getDatabasePool()));

router.get('', requireAuth, (req, res) => getDashboardController().get(req, res));

export default router;
