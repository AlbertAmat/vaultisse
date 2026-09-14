import {Pool} from "pg";
import {CustomerRepository} from "../repositories/CustomerRepository";
import {LoanHistoryRepository} from "../repositories/LoanHistoryRepository";
import {withTransaction} from "../repositories/withTransaction";
import {Customer, CustomerGroup, CustomerGroupWithCount, CustomerLoanedBook, CustomerWithLoanCount} from "../types/customer";
import {ConflictError, NotFoundError, ValidationError} from "../errors/DomainError";

/** Business rules for the Customer resource (customers, customer groups, and lending). Calls CustomerRepository/LoanHistoryRepository; throws DomainError subclasses for expected failures. */
export class CustomerService {
    /**
     * @param pool Database connection pool, forwarded to fresh repositories on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /* ---------- Customer groups ---------- */

    /**
     * Lists the caller's customer groups.
     * @param userId Owning user's id.
     * @returns Every group belonging to `userId`.
     */
    public async listGroups(userId: number): Promise<CustomerGroupWithCount[]> {
        return new CustomerRepository(this.pool).findAllGroups(userId);
    }

    /**
     * Creates a customer group, throwing ValidationError on a blank name and ConflictError on a duplicate name.
     * @param userId Owning user's id.
     * @param name Group name.
     * @param description Optional group description.
     * @returns The newly-created group.
     */
    public async createGroup(userId: number, name: string, description: string | undefined): Promise<CustomerGroup> {
        if (!name || !name.trim()) {
            throw new ValidationError("Group name is required");
        }
        try {
            return await new CustomerRepository(this.pool).createGroup(userId, name.trim(), description || null);
        } catch (error: any) {
            if (error.code === '23505') {
                throw new ConflictError("A group with this name already exists");
            }
            throw error;
        }
    }

    /**
     * Renames/redescribes a customer group, throwing ValidationError on a blank name, NotFoundError if it doesn't belong to the caller, and ConflictError on a duplicate name.
     * @param id Group id.
     * @param userId Owning user's id.
     * @param name New name.
     * @param description New description.
     * @returns The updated group.
     */
    public async renameGroup(id: number, userId: number, name: string, description: string | undefined): Promise<CustomerGroup> {
        if (!name || !name.trim()) {
            throw new ValidationError("Group name is required");
        }
        try {
            const group = await new CustomerRepository(this.pool).renameGroup(id, userId, name.trim(), description || null);
            if (!group) {
                throw new NotFoundError("Group not found");
            }
            return group;
        } catch (error: any) {
            if (error.code === '23505') {
                throw new ConflictError("A group with this name already exists");
            }
            throw error;
        }
    }

    /**
     * Deletes a customer group, throwing NotFoundError if it doesn't belong to the caller.
     * @param id Group id.
     * @param userId Owning user's id.
     */
    public async deleteGroup(id: number, userId: number): Promise<void> {
        const removed = await new CustomerRepository(this.pool).removeGroup(id, userId);
        if (!removed) {
            throw new NotFoundError("Group not found");
        }
    }

    /**
     * Assigns a customer to a group, throwing NotFoundError if either doesn't belong to the caller.
     * @param customerId Customer id.
     * @param groupId Group id.
     * @param userId Owning user's id.
     * @returns The updated customer.
     */
    public async assignCustomerToGroup(customerId: number, groupId: number, userId: number): Promise<Customer> {
        const repo = new CustomerRepository(this.pool);
        const groupOk = await repo.groupExists(groupId, userId);
        if (!groupOk) {
            throw new NotFoundError("Group not found");
        }
        const customer = await repo.assignGroup(customerId, groupId, userId);
        if (!customer) {
            throw new NotFoundError("Customer not found");
        }
        return customer;
    }

    /**
     * Clears a customer's group assignment, throwing NotFoundError if it doesn't belong to the caller.
     * @param customerId Customer id.
     * @param userId Owning user's id.
     * @returns The updated customer.
     */
    public async removeCustomerFromGroup(customerId: number, userId: number): Promise<Customer> {
        const customer = await new CustomerRepository(this.pool).unassignGroup(customerId, userId);
        if (!customer) {
            throw new NotFoundError("Customer not found");
        }
        return customer;
    }

    /* ---------- Customers ---------- */

    /**
     * Lists the caller's customers.
     * @param userId Owning user's id.
     * @returns Every customer belonging to `userId`.
     */
    public async listCustomers(userId: number): Promise<CustomerWithLoanCount[]> {
        return new CustomerRepository(this.pool).findAll(userId);
    }

    /**
     * Creates a customer and returns the freshly-created row.
     * @param userId Owning user's id.
     * @param name Customer name.
     * @returns The newly-created customer.
     */
    public async createCustomer(userId: number, name: string): Promise<Customer> {
        const repo = new CustomerRepository(this.pool);
        const id = await repo.create(userId, name);
        const customer = await repo.findById(id, userId);
        if (!customer) {
            throw new NotFoundError("Customer not found after creation");
        }
        return customer;
    }

    /**
     * Renames a customer.
     *
     * Preserves the original route's existing behavior: a rename that matches
     * zero rows (nonexistent id / another user's customer) is a plain 500, not
     * a 404 - same reasoning as Category/Author/LocationService's identically
     * documented quirk. Throws a plain Error, not a DomainError.
     *
     * @param id Customer id.
     * @param userId Owning user's id.
     * @param name New name.
     * @returns The renamed customer.
     */
    public async renameCustomer(id: string, userId: number, name: string): Promise<Customer> {
        const repo = new CustomerRepository(this.pool);
        const rowsAffected = await repo.rename(id, userId, name);
        if (rowsAffected !== 1) {
            throw new Error("Customer rename affected an unexpected number of rows");
        }
        const customer = await repo.findById(id, userId);
        if (!customer) {
            throw new Error("Customer not found after rename");
        }
        return customer;
    }

    /**
     * Deletes a customer, throwing NotFoundError if it doesn't belong to the caller.
     * @param id Customer id.
     * @param userId Owning user's id.
     */
    public async deleteCustomer(id: number, userId: number): Promise<void> {
        const repo = new CustomerRepository(this.pool);
        const found = await repo.exists(id, userId);
        if (!found) {
            throw new NotFoundError("Customer not found");
        }
        await repo.remove(id, userId);
    }

    /* ---------- Lending ---------- */

    /**
     * Lists the books currently loaned to a customer.
     * @param customerId Customer id.
     * @param userId Owning user's id.
     * @returns Every book stock currently loaned to that customer.
     */
    public async getCustomerBooks(customerId: number, userId: number): Promise<CustomerLoanedBook[]> {
        return new CustomerRepository(this.pool).getLoanedBooks(customerId, userId);
    }

    /**
     * Lends a batch of book stocks (by code) to a customer. Originally an
     * un-transacted loop of UPDATE + recordLoan pairs - a crash partway through
     * could leave book_stocks and loan_history inconsistent. Now wrapped in one
     * transaction (same fix as LocationService.moveBooksToLocation).
     *
     * @param customerId Customer id.
     * @param userId Owning user's id.
     * @param stockCodes Book stock codes to lend.
     * @returns The customer's loaned books after the change.
     */
    public async lendBooksToCustomer(customerId: number, userId: number, stockCodes: string[]): Promise<CustomerLoanedBook[]> {
        const repo = new CustomerRepository(this.pool);
        const customerExists = await repo.exists(customerId, userId);
        if (!customerExists) {
            throw new NotFoundError("Customer not found");
        }

        await withTransaction(this.pool, async (client) => {
            const txCustomerRepo = new CustomerRepository(client);
            const txLoanHistoryRepo = new LoanHistoryRepository(client);
            for (const stockCode of stockCodes) {
                await txCustomerRepo.lendBookStock(customerId, userId, stockCode);
                await txLoanHistoryRepo.recordLoan(userId, stockCode, customerId);
            }
        });

        return repo.getLoanedBooks(customerId, userId);
    }

    /**
     * Returns a single loaned book. Originally two sequential un-transacted
     * writes (book_stocks UPDATE + recordReturn) - wrapped here for the same
     * atomicity reason as the lend path above, even though this one was never
     * a loop.
     *
     * @param customerId Customer id the stock is expected to be loaned to.
     * @param userId Owning user's id.
     * @param stockCode Book stock code to return.
     */
    public async returnBookFromCustomer(customerId: number, userId: number, stockCode: string): Promise<void> {
        await withTransaction(this.pool, async (client) => {
            await new CustomerRepository(client).returnBookStock(customerId, userId, stockCode);
            await new LoanHistoryRepository(client).recordReturn(userId, stockCode);
        });
    }
}
