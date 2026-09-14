/**
 * =============================================================================
 * CategoriesRoute
 * =============================================================================
 * Mounted at `/api/rest/category`. CRUD for the user's book `categories`
 * (genres/shelving sections). All routes require auth and are scoped to the
 * caller's `user_id`. See CategoryController/CategoryService/CategoryRepository
 * for the actual request handling, business rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {CategoryController} from "../controllers/CategoryController";
import {lazy} from "./lazySingleton";

const router = Router();
const getCategoryController = lazy(() => new CategoryController(appService.getDatabasePool()));

router.get('', requireAuth, (req, res) => getCategoryController().list(req, res));
router.post('', requireAuth, (req, res) => getCategoryController().create(req, res));
router.put('/:id', requireAuth, (req, res) => getCategoryController().rename(req, res));
router.delete('/:id', requireAuth, (req, res) => getCategoryController().remove(req, res));

export default router;
