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

/**
 * GET /dashboard
 * ----------------
 * Builds the dashboard view's aggregate KPI/chart payload (16 queries run concurrently).
 *
 * Auth: required.
 *
 * Example response (200):
 *  { "lastBooks": [...], "totalBooks": 128, "totalThisMonth": 4, "totalLastMonth": 9,
 *    "totalCategories": 12, "totalCustomers": 7, "booksInTime": [{ "month": "2026-01-01T00:00:00.000Z", "total_books": 4 }],
 *    "stockStatus": [{ "status": 0, "count": 100 }], "totalBookedBooks": 5, "totalLocations": 3,
 *    "totalAuthors": 40, "categoryShelves": [{ "id": 1, "name": "Fiction", "count": 20, "books": [...] }],
 *    "currentlyOnLoan": [...], "wantToRead": [...], "currentlyReading": [...], "totalRead": 30 }
 */
router.get('', requireAuth, (req, res) => getDashboardController().get(req, res));

export default router;
