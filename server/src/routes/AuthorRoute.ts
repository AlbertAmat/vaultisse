/**
 * =============================================================================
 * AuthorRoute
 * =============================================================================
 * Mounted at `/api/rest/author`. CRUD + search for the vault's `authors`.
 * All routes require auth and are scoped to the caller's active vault (`vault_id`, issue #7). See
 * AuthorController/AuthorService/AuthorRepository for the actual request
 * handling, business rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {requireVaultPermission} from "../middlewares/VaultPermissionMiddleware";
import {AuthorController} from "../controllers/AuthorController";
import {lazy} from "./lazySingleton";

const router = Router();
const getAuthorController = lazy(() => new AuthorController(appService.getDatabasePool()));

/**
 * GET /author
 * ------------
 * Lists the caller's authors.
 *
 * Auth: required.
 *
 * Example response (200): [{ "id": 1, "name": "J.R.R. Tolkien" }]
 */
router.get('', requireAuth, (req, res) => getAuthorController().list(req, res));

/**
 * POST /author/search
 * ---------------------
 * Case-insensitive substring search over the caller's authors, for the author autocomplete/picker.
 *
 * Auth: required. Body: { "query": "tolk" }
 *
 * Example response (200): [{ "id": 1, "name": "J.R.R. Tolkien" }]
 */
router.post('/search', requireAuth, (req, res) => getAuthorController().search(req, res));

/**
 * POST /author
 * -------------
 * Creates a new author.
 *
 * Auth: required. Body: { "name": "J.R.R. Tolkien" }
 *
 * Example response (200): { "id": 1, "name": "J.R.R. Tolkien" }
 */
router.post('', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getAuthorController().create(req, res));

/**
 * PUT /author/:id
 * -----------------
 * Renames an author.
 *
 * Auth: required. Body: { "name": "New name" }
 *
 * Example response (200): { "id": 1, "name": "New name" }
 * Responses: 400 "No author ID provided" | 200 the renamed author.
 */
router.put('/:id', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getAuthorController().rename(req, res));

/**
 * DELETE /author/:id
 * --------------------
 * Deletes an author.
 *
 * Auth: required.
 *
 * Example response (200): { "message": "Author deleted successfully" }
 * Responses: 200 success | 404 { "error": "Author not found" }.
 */
router.delete('/:id', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getAuthorController().remove(req, res));

export default router;
