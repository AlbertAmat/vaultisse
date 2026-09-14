/**
 * =============================================================================
 * AuthorRoute
 * =============================================================================
 * Mounted at `/api/rest/author`. CRUD + search for the user's `authors`.
 * All routes require auth and are scoped to the caller's `user_id`. See
 * AuthorController/AuthorService/AuthorRepository for the actual request
 * handling, business rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {AuthorController} from "../controllers/AuthorController";
import {lazy} from "./lazySingleton";

const router = Router();
const getAuthorController = lazy(() => new AuthorController(appService.getDatabasePool()));

router.get('', requireAuth, (req, res) => getAuthorController().list(req, res));
router.post('/search', requireAuth, (req, res) => getAuthorController().search(req, res));
router.post('', requireAuth, (req, res) => getAuthorController().create(req, res));
router.put('/:id', requireAuth, (req, res) => getAuthorController().rename(req, res));
router.delete('/:id', requireAuth, (req, res) => getAuthorController().remove(req, res));

export default router;
