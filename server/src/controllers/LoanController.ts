import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {LoanService} from "../services/LoanService";
import {DomainError} from "../errors/DomainError";

/** Thin HTTP<->service glue for the Loans resource. Constructed once per process (see LoansRoute.ts) and reused across requests. */
export class LoanController {
    /**
     * @param pool Database connection pool, forwarded to a fresh LoanService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * GET /loans - lists books currently on loan, paginated/filterable via query params.
     * @param req Express request.
     * @param res Express response.
     */
    public async list(req: Request, res: Response): Promise<void> {
        try {
            const userId = appService.getSessionUser(req);
            const result = await new LoanService(this.pool).listLoans(userId, {
                groupId: req.query.group_id ? Number(req.query.group_id) : null,
                dateFrom: req.query.date_from ? String(req.query.date_from) : null,
                dateTo: req.query.date_to ? String(req.query.date_to) : null,
                page: Math.max(0, Number(req.query.page)) || 0,
            });
            res.status(200).json(result);
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * GET /loans/report - unpaginated loan-history export for the Excel report.
     * @param req Express request.
     * @param res Express response.
     */
    public async report(req: Request, res: Response): Promise<void> {
        try {
            const userId = appService.getSessionUser(req);
            const rows = await new LoanService(this.pool).getLoanReport(userId, {
                dateFrom: req.query.date_from ? String(req.query.date_from) : null,
                dateTo: req.query.date_to ? String(req.query.date_to) : null,
                groupId: req.query.group_id ? Number(req.query.group_id) : null,
                customerId: req.query.customer_id ? Number(req.query.customer_id) : null,
            });
            res.status(200).json({rows});
        } catch (err) {
            if (err instanceof DomainError) {
                res.status(err.httpStatus).send(err.message);
                return;
            }
            console.error('Error executing query', err);
            res.status(500).send('Internal Server Error');
        }
    }
}
