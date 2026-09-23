/**
 * =============================================================================
 * LocationRoute
 * =============================================================================
 * Mounted at `/api/rest/location`. CRUD for physical storage "locations"
 * (shelves, rooms, warehouses, ...) and moving book stocks between them.
 * All routes require auth and are scoped to the caller's active vault (`vault_id`, issue #7). See
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

/**
 * GET /location
 * --------------
 * Lists the caller's locations, each with its current book count.
 *
 * Auth: required.
 *
 * Example response (200): [{ "id": 1, "name": "Living room shelf", "description": "", "default": true, "total_books": 42 }]
 */
router.get('', requireAuth, (req, res) => getLocationController().list(req, res));

/**
 * GET /location/:id/books
 * -------------------------
 * Lists the books currently stored at a location. No ownership check on `:id` - an
 * unknown/foreign id just returns an empty list.
 *
 * Auth: required.
 *
 * Example response (200): [{ "id": 10, "name": "The Hobbit", "book_id": 3, "code": "abc123", "status": 0, "image_url": null }]
 */
router.get('/:id/books', requireAuth, (req, res) => getLocationController().getBooks(req, res));

/**
 * POST /location/:id/add/books
 * -------------------------------
 * Moves a batch of book stocks (by code) into this location, all-or-nothing in one transaction.
 *
 * Auth: required. Body: { "books": ["abc123", "def456"] }
 *
 * Example response (200): [{ "id": 10, "name": "The Hobbit", "book_id": 3, "code": "abc123", "status": 0, "image_url": null }]
 * Responses: 400 "No location ID provided" / "No books provided" | 404 "Location does not exist" | 200 the location's books after the move.
 */
router.post('/:id/add/books', requireAuth, (req, res) => getLocationController().addBooks(req, res));

/**
 * POST /location
 * ----------------
 * Creates a new location.
 *
 * Auth: required. Body: { "name": "Living room shelf", "description": "" }
 *
 * Example response (200): { "id": 1, "name": "Living room shelf", "description": "", "default": false, "total_books": 0 }
 */
router.post('', requireAuth, (req, res) => getLocationController().create(req, res));

/**
 * PUT /location/:id
 * -------------------
 * Renames/redescribes a location.
 *
 * Auth: required. Body: { "name": "New name", "description": "New description" }
 *
 * Example response (200): { "id": 1, "name": "New name", "description": "New description", "default": false, "total_books": 3 }
 * Responses: 400 "No location ID provided" | 200 the renamed location.
 */
router.put('/:id', requireAuth, (req, res) => getLocationController().rename(req, res));

/**
 * PUT /location/:id/default
 * ----------------------------
 * Sets a location as the caller's default (unsetting whichever one previously had it).
 *
 * Auth: required.
 *
 * Example response (200): [{ "id": 1, "name": "Living room shelf", "description": "", "default": true, "total_books": 42 }]
 * Responses: 400 "No location ID provided" | 404 "Location does not exist" | 200 every one of the caller's locations, after the change.
 */
router.put('/:id/default', requireAuth, (req, res) => getLocationController().setDefault(req, res));

/**
 * DELETE /location/:id
 * ----------------------
 * Deletes a location.
 *
 * Auth: required.
 *
 * Example response (200): { "message": "Location deleted successfully" }
 * Responses: 200 success | 404 { "error": "Location not found" }.
 */
router.delete('/:id', requireAuth, (req, res) => getLocationController().remove(req, res));

export default router;
