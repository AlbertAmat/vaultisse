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
 * All routes require auth and are scoped to the caller's `user_id`. See
 * CustomerController/CustomerService/CustomerRepository for the actual
 * request handling, business rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {CustomerController} from "../controllers/CustomerController";
import {lazy} from "./lazySingleton";

const router = Router();
const getCustomerController = lazy(() => new CustomerController(appService.getDatabasePool()));

// Customer groups
router.get('/group', requireAuth, (req, res) => getCustomerController().listGroups(req, res));
router.post('/group', requireAuth, (req, res) => getCustomerController().createGroup(req, res));
router.put('/group/:id', requireAuth, (req, res) => getCustomerController().renameGroup(req, res));
router.delete('/group/:id', requireAuth, (req, res) => getCustomerController().deleteGroup(req, res));

// Customer <-> group assignment
router.put('/:id/group/:groupId', requireAuth, (req, res) => getCustomerController().assignGroup(req, res));
router.delete('/:id/group', requireAuth, (req, res) => getCustomerController().unassignGroup(req, res));

// Customers
router.get('', requireAuth, (req, res) => getCustomerController().list(req, res));
router.post('', requireAuth, (req, res) => getCustomerController().create(req, res));
router.put('/:id', requireAuth, (req, res) => getCustomerController().rename(req, res));
router.delete('/:id', requireAuth, (req, res) => getCustomerController().remove(req, res));

// Lending
router.get('/:id/books', requireAuth, (req, res) => getCustomerController().getBooks(req, res));
router.post('/:id/add/books', requireAuth, (req, res) => getCustomerController().addBooks(req, res));
router.delete('/:id/book/:bookStockCode', requireAuth, (req, res) => getCustomerController().returnBook(req, res));

export default router;
