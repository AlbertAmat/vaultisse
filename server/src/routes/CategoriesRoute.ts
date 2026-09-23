/**
 * =============================================================================
 * CategoriesRoute
 * =============================================================================
 * Mounted at `/api/rest/category`. CRUD for the vault's book `categories`
 * (genres/shelving sections). All routes require auth and are scoped to the
 * caller's active vault (`vault_id`, issue #7). See CategoryController/CategoryService/CategoryRepository
 * for the actual request handling, business rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {CategoryController} from "../controllers/CategoryController";
import {lazy} from "./lazySingleton";

const router = Router();
const getCategoryController = lazy(() => new CategoryController(appService.getDatabasePool()));

/**
 * GET /category
 * --------------
 * Lists the caller's categories.
 *
 * Auth: required.
 *
 * Example response (200): [{ "id": 1, "name": "Fiction" }, { "id": 2, "name": "Non-fiction" }]
 */
router.get('', requireAuth, (req, res) => getCategoryController().list(req, res));

/**
 * POST /category
 * ----------------
 * Creates a new category.
 *
 * Auth: required. Body: { "name": "Fiction" }
 *
 * Example response (200): { "id": 1, "name": "Fiction" }
 */
router.post('', requireAuth, (req, res) => getCategoryController().create(req, res));

/**
 * PUT /category/:id
 * -------------------
 * Renames a category.
 *
 * Auth: required. Body: { "name": "New name" }
 *
 * Example response (200): { "id": 1, "name": "New name" }
 * Responses: 400 "No category ID provided" | 200 the renamed category.
 */
router.put('/:id', requireAuth, (req, res) => getCategoryController().rename(req, res));

/**
 * DELETE /category/:id
 * ----------------------
 * Deletes a category.
 *
 * Auth: required.
 *
 * Example response (200): { "message": "Category deleted successfully" }
 * Responses: 200 success | 404 { "error": "Category not found" }.
 */
router.delete('/:id', requireAuth, (req, res) => getCategoryController().remove(req, res));

export default router;
