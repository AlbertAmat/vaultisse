/**
 * =============================================================================
 * LocationRoute
 * =============================================================================
 * Mounted at `/api/rest/location`. CRUD for physical storage "locations"
 * (shelves, rooms, warehouses, ...) and moving book stocks between them.
 * All routes require auth and are scoped to the caller's `user_id`. See
 * LocationController/LocationService/LocationRepository for the actual
 * request handling, business rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {LocationController} from "../controllers/LocationController";
import {lazy} from "./lazySingleton";

const router = Router();
const getLocationController = lazy(() => new LocationController(appService.getDatabasePool()));

router.get('', requireAuth, (req, res) => getLocationController().list(req, res));
router.get('/:id/books', requireAuth, (req, res) => getLocationController().getBooks(req, res));
router.post('/:id/add/books', requireAuth, (req, res) => getLocationController().addBooks(req, res));
router.post('', requireAuth, (req, res) => getLocationController().create(req, res));
router.put('/:id', requireAuth, (req, res) => getLocationController().rename(req, res));
router.put('/:id/default', requireAuth, (req, res) => getLocationController().setDefault(req, res));
router.delete('/:id', requireAuth, (req, res) => getLocationController().remove(req, res));

export default router;
