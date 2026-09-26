import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {CustomerService} from "../services/CustomerService";
import {DomainError} from "../errors/DomainError";

/** Thin HTTP<->service glue for the Customer resource. Constructed once per process (see CustomerRoute.ts) and reused across requests. */
export class CustomerController {
    /**
     * @param pool Database connection pool, forwarded to a fresh CustomerService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /* ---------- Customer groups ---------- */

    /**
     * GET /customer/group - lists the caller's customer groups.
     * @param req Express request.
     * @param res Express response.
     */
    public async listGroups(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            const groups = await new CustomerService(this.pool).listGroups(vaultId);
            res.status(200).json(groups);
        } catch (error) {
            console.error('Error getting customer groups:', error);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * POST /customer/group - creates a new customer group.
     * @param req Express request.
     * @param res Express response.
     */
    public async createGroup(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            const group = await new CustomerService(this.pool).createGroup(vaultId, req.body.name, req.body.description);
            res.status(201).json(group);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error('Error creating customer group:', error);
            res.status(500).send('Error creating customer group');
        }
    }

    /**
     * PUT /customer/group/:id - renames/redescribes a customer group.
     * @param req Express request.
     * @param res Express response.
     */
    public async renameGroup(req: Request, res: Response): Promise<void> {
        const groupId = Number(req.params.id);
        if (!groupId) {
            res.status(400).send('No group ID provided');
            return;
        }
        try {
            const vaultId = appService.getSessionVault(req);
            const group = await new CustomerService(this.pool).renameGroup(groupId, vaultId, req.body.name, req.body.description);
            res.status(200).json(group);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error('Error updating customer group:', error);
            res.status(500).send('Error updating customer group');
        }
    }

    /**
     * DELETE /customer/group/:id - deletes a customer group.
     * @param req Express request.
     * @param res Express response.
     */
    public async deleteGroup(req: Request, res: Response): Promise<void> {
        const groupId = Number(req.params.id);
        if (!groupId) {
            res.status(400).send('No group ID provided');
            return;
        }
        try {
            const vaultId = appService.getSessionVault(req);
            await new CustomerService(this.pool).deleteGroup(groupId, vaultId);
            res.status(200).json({message: 'Customer group deleted successfully'});
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error('Error deleting customer group:', error);
            res.status(500).send('Error deleting customer group');
        }
    }

    /* ---------- Customer <-> group assignment ---------- */

    /**
     * PUT /customer/:id/group/:groupId - assigns a customer to a group.
     * @param req Express request.
     * @param res Express response.
     */
    public async assignGroup(req: Request, res: Response): Promise<void> {
        const customerId = Number(req.params.id);
        const groupId = Number(req.params.groupId);
        if (!customerId) {
            res.status(400).send('No customer ID provided');
            return;
        }
        if (!groupId) {
            res.status(400).send('No group ID provided');
            return;
        }
        try {
            const vaultId = appService.getSessionVault(req);
            const customer = await new CustomerService(this.pool).assignCustomerToGroup(customerId, groupId, vaultId);
            res.status(200).json(customer);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error('Error assigning customer to group:', error);
            res.status(500).send('Error assigning customer to group');
        }
    }

    /**
     * DELETE /customer/:id/group - clears a customer's group assignment.
     * @param req Express request.
     * @param res Express response.
     */
    public async unassignGroup(req: Request, res: Response): Promise<void> {
        const customerId = Number(req.params.id);
        if (!customerId) {
            res.status(400).send('No customer ID provided');
            return;
        }
        try {
            const vaultId = appService.getSessionVault(req);
            const customer = await new CustomerService(this.pool).removeCustomerFromGroup(customerId, vaultId);
            res.status(200).json(customer);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error('Error removing customer from group:', error);
            res.status(500).send('Error removing customer from group');
        }
    }

    /* ---------- Customers ---------- */

    /**
     * GET /customer - lists the caller's customers.
     * @param req Express request.
     * @param res Express response.
     */
    public async list(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            const customers = await new CustomerService(this.pool).listCustomers(vaultId);
            res.status(200).json({customers});
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * POST /customer - creates a new customer from `req.body.name`.
     * @param req Express request.
     * @param res Express response.
     */
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            appService.getLogger().debug(`Adding customer with name ${req.body.name}`);
            const customer = await new CustomerService(this.pool).createCustomer(vaultId, req.body.name);
            res.status(200).json(customer);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error adding the customer");
        }
    }

    /**
     * PUT /customer/:id - renames a customer.
     * @param req Express request.
     * @param res Express response.
     */
    public async rename(req: Request, res: Response): Promise<void> {
        const customerId = req.params.id;
        if (!customerId) {
            res.status(400).send('No customer ID provided');
            return;
        }
        try {
            const vaultId = appService.getSessionVault(req);
            appService.getLogger().debug(`Updating customer ${customerId}`);
            const customer = await new CustomerService(this.pool).renameCustomer(customerId, vaultId, req.body.name);
            res.status(200).json(customer);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error updating the customer");
        }
    }

    /**
     * DELETE /customer/:id - deletes a customer.
     * @param req Express request.
     * @param res Express response.
     */
    public async remove(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        appService.getLogger().debug(`Delete customer, id: ${id}`);
        try {
            const vaultId = appService.getSessionVault(req);
            await new CustomerService(this.pool).deleteCustomer(id, vaultId);
            res.send({message: "Customer deleted successfully"});
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while deleting customer", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /* ---------- Lending ---------- */

    /**
     * GET /customer/:id/books - lists the books currently loaned to a customer.
     * @param req Express request.
     * @param res Express response.
     */
    public async getBooks(req: Request, res: Response): Promise<void> {
        const customerId = Number(req.params.id);
        if (!customerId) {
            res.status(400).send('No customer ID provided');
            return;
        }
        try {
            const vaultId = appService.getSessionVault(req);
            const books = await new CustomerService(this.pool).getCustomerBooks(customerId, vaultId);
            res.status(200).json(books);
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * POST /customer/:id/add/books - lends a batch of book stocks to a customer.
     * @param req Express request.
     * @param res Express response.
     */
    public async addBooks(req: Request, res: Response): Promise<void> {
        const customerId = Number(req.params.id);
        const books: string[] = req.body.books;
        if (!customerId) {
            res.status(400).send('No customer ID provided');
            return;
        }
        if (!Array.isArray(books) || books.length === 0) {
            res.status(400).send('No books provided');
            return;
        }
        try {
            const vaultId = appService.getSessionVault(req);
            const customerBooks = await new CustomerService(this.pool).lendBooksToCustomer(customerId, vaultId, books);
            res.status(200).json(customerBooks);
        } catch (err) {
            if (err instanceof DomainError) {
                res.status(err.httpStatus).send(err.message);
                return;
            }
            console.error('Error adding books to a customer', err);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * DELETE /customer/:id/book/:bookStockCode - returns a book loaned to a customer.
     * @param req Express request.
     * @param res Express response.
     */
    public async returnBook(req: Request, res: Response): Promise<void> {
        const customerId = Number(req.params.id);
        const bookStockCode = String(req.params.bookStockCode);
        if (!customerId) {
            res.status(400).send('No customer ID provided');
            return;
        }
        if (!bookStockCode) {
            res.status(400).send('No book stock code provided');
            return;
        }
        try {
            const vaultId = appService.getSessionVault(req);
            await new CustomerService(this.pool).returnBookFromCustomer(customerId, vaultId, bookStockCode);
            res.status(200).send();
        } catch (err: any) {
            console.error('Error adding books to a customer', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }
}
