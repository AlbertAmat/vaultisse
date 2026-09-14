/**
 * =============================================================================
 * LoansRoute
 * =============================================================================
 * Mounted at `/api/rest/loans`. Read-only, paginated/filterable listing of
 * books currently on loan (a `book_stocks` row with `status = 2`), for the
 * Loans management view, plus an unpaginated `loan_history` export backing
 * that view's Excel report. Returning a book is handled by the existing
 * `POST /book/return` (see BooksRoute.ts) - this route only lists. See
 * LoanController/LoanService/LoanRepository for the actual request
 * handling, business rules, and SQL respectively.
 */
import {Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {LoanController} from "../controllers/LoanController";
import {lazy} from "./lazySingleton";

const router = Router();
const getLoanController = lazy(() => new LoanController(appService.getDatabasePool()));

/**
 * GET /loans
 * -----------
 * Paginated/filterable listing of books currently on loan.
 *
 * Auth: required. Query: `?page=0&group_id=2&date_from=2026-01-01&date_to=2026-01-31`
 * (all optional; `page` is 0-indexed, 50 rows per page).
 *
 * Example response (200):
 *  { "total": 3, "limit": 50, "loans": [{ "stockId": 10, "stockCode": "abc123", "loanedAt": "2026-01-05T10:00:00.000Z",
 *    "bookId": 3, "bookName": "The Hobbit", "imageUrl": null, "customerId": 7, "customerName": "Jane Doe",
 *    "groupId": 2, "groupName": "Class 4B" }] }
 */
router.get('', requireAuth, (req, res) => getLoanController().list(req, res));

/**
 * GET /loans/report
 * -------------------
 * Unpaginated `loan_history` export for a date range, for the Loans view's Excel report.
 *
 * Auth: required. Query: `?date_from=2026-01-01&date_to=2026-01-31&group_id=2&customer_id=7`
 * (`date_from`/`date_to` required, `group_id`/`customer_id` optional).
 *
 * Example response (200):
 *  { "rows": [{ "bookName": "The Hobbit", "stockCode": "abc123", "customerName": "Jane Doe", "groupName": "Class 4B",
 *    "loanedAt": "2026-01-05T10:00:00.000Z", "returnedAt": "2026-01-12T14:00:00.000Z" }] }
 * Responses: 400 "date_from and date_to are required" | 200 the report rows.
 */
router.get('/report', requireAuth, (req, res) => getLoanController().report(req, res));

export default router;
