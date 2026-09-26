/**
 * =============================================================================
 * CustomerRoute
 * =============================================================================
 * Mounted at `/api/rest/customer`. Covers two related areas:
 *  - `customer_groups`: organizing customers into named groups (e.g. classes,
 *    departments) - CRUD plus assigning/unassigning a customer to a group.
 *  - `customers`: CRUD, and lending/returning books to a customer (a "loan"
 *    is a `book_stocks` row with `status = 2` and `customer_id` set to them).
 *
 * All routes require auth and are scoped to the caller's active vault (`vault_id`, issue #7). See
 * CustomerController/CustomerService/CustomerRepository for the actual
 * request handling, business rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {requireVaultPermission} from "../middlewares/VaultPermissionMiddleware";
import {CustomerController} from "../controllers/CustomerController";
import {lazy} from "./lazySingleton";

const router = Router();
const getCustomerController = lazy(() => new CustomerController(appService.getDatabasePool()));

// Customer groups

/**
 * GET /customer/group
 * ---------------------
 * Lists the caller's customer groups, each with its member count.
 *
 * Auth: required.
 *
 * Example response (200): [{ "id": 1, "name": "Class 4B", "description": "", "total_customers": 22 }]
 */
router.get('/group', requireAuth, (req, res) => getCustomerController().listGroups(req, res));

/**
 * POST /customer/group
 * ----------------------
 * Creates a new customer group.
 *
 * Auth: required. Body: { "name": "Class 4B", "description": "" }
 *
 * Example response (201): { "id": 1, "name": "Class 4B", "description": "" }
 * Responses: 400 "Group name is required" | 409 "A group with this name already exists" | 201 the new group.
 */
router.post('/group', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getCustomerController().createGroup(req, res));

/**
 * PUT /customer/group/:id
 * --------------------------
 * Renames/redescribes a customer group.
 *
 * Auth: required. Body: { "name": "New name", "description": "New description" }
 *
 * Example response (200): { "id": 1, "name": "New name", "description": "New description" }
 * Responses: 400 "No group ID provided" / "Group name is required" | 404 "Group not found" |
 *            409 "A group with this name already exists" | 200 the renamed group.
 */
router.put('/group/:id', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getCustomerController().renameGroup(req, res));

/**
 * DELETE /customer/group/:id
 * -----------------------------
 * Deletes a customer group.
 *
 * Auth: required.
 *
 * Example response (200): { "message": "Customer group deleted successfully" }
 * Responses: 400 "No group ID provided" | 404 "Group not found" | 200 success.
 */
router.delete('/group/:id', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getCustomerController().deleteGroup(req, res));

// Customer <-> group assignment

/**
 * PUT /customer/:id/group/:groupId
 * -----------------------------------
 * Assigns a customer to a group.
 *
 * Auth: required.
 *
 * Example response (200): { "id": 7, "name": "Jane Doe", "group_id": 1 }
 * Responses: 400 "No customer ID provided" / "No group ID provided" | 404 "Group not found" / "Customer not found" | 200 the updated customer.
 */
router.put('/:id/group/:groupId', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getCustomerController().assignGroup(req, res));

/**
 * DELETE /customer/:id/group
 * -----------------------------
 * Clears a customer's group assignment.
 *
 * Auth: required.
 *
 * Example response (200): { "id": 7, "name": "Jane Doe", "group_id": null }
 * Responses: 400 "No customer ID provided" | 404 "Customer not found" | 200 the updated customer.
 */
router.delete('/:id/group', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getCustomerController().unassignGroup(req, res));

// Customers

/**
 * GET /customer
 * --------------
 * Lists the caller's customers, each with its current loan count and group.
 *
 * Auth: required.
 *
 * Example response (200): { "customers": [{ "id": 7, "name": "Jane Doe", "group_id": 1, "group_name": "Class 4B", "total_books": 2 }] }
 */
router.get('', requireAuth, (req, res) => getCustomerController().list(req, res));

/**
 * POST /customer
 * ----------------
 * Creates a new customer.
 *
 * Auth: required. Body: { "name": "Jane Doe" }
 *
 * Example response (200): { "id": 7, "name": "Jane Doe", "group_id": null, "group_name": null }
 */
router.post('', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getCustomerController().create(req, res));

/**
 * PUT /customer/:id
 * -------------------
 * Renames a customer.
 *
 * Auth: required. Body: { "name": "New name" }
 *
 * Example response (200): { "id": 7, "name": "New name", "group_id": 1, "group_name": "Class 4B" }
 * Responses: 400 "No customer ID provided" | 200 the renamed customer.
 */
router.put('/:id', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getCustomerController().rename(req, res));

/**
 * DELETE /customer/:id
 * ----------------------
 * Deletes a customer.
 *
 * Auth: required.
 *
 * Example response (200): { "message": "Customer deleted successfully" }
 * Responses: 200 success | 404 { "error": "Customer not found" }.
 */
router.delete('/:id', requireAuth, requireVaultPermission("canEditCatalog"), (req, res) => getCustomerController().remove(req, res));

// Lending

/**
 * GET /customer/:id/books
 * -------------------------
 * Lists the books currently loaned to a customer.
 *
 * Auth: required.
 *
 * Example response (200): [{ "id": 3, "name": "The Hobbit", "image_url": null, "isbn": "9780261102217", "code": "abc123" }]
 * Responses: 400 "No customer ID provided" | 200 the loaned books.
 */
router.get('/:id/books', requireAuth, (req, res) => getCustomerController().getBooks(req, res));

/**
 * POST /customer/:id/add/books
 * -------------------------------
 * Lends a batch of book stocks (by code) to a customer, all-or-nothing in one transaction.
 *
 * Auth: required. Body: { "books": ["abc123", "def456"] }
 *
 * Example response (200): [{ "id": 3, "name": "The Hobbit", "image_url": null, "isbn": "9780261102217", "code": "abc123" }]
 * Responses: 400 "No customer ID provided" / "No books provided" | 404 "Customer not found" | 200 the customer's loaned books after the change.
 */
router.post('/:id/add/books', requireAuth, requireVaultPermission("canBorrow"), (req, res) => getCustomerController().addBooks(req, res));

/**
 * DELETE /customer/:id/book/:bookStockCode
 * -------------------------------------------
 * Returns a book loaned to a customer.
 *
 * Auth: required.
 *
 * Responses: 400 "No customer ID provided" / "No book stock code provided" | 200 empty body on success.
 */
router.delete('/:id/book/:bookStockCode', requireAuth, requireVaultPermission("canBorrow"), (req, res) => getCustomerController().returnBook(req, res));

export default router;
