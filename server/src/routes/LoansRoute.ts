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

router.get('', requireAuth, (req, res) => getLoanController().list(req, res));
router.get('/report', requireAuth, (req, res) => getLoanController().report(req, res));

export default router;
