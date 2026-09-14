import {Pool, PoolClient} from "pg";
import {Customer, CustomerGroup, CustomerGroupWithCount, CustomerLoanedBook, CustomerWithLoanCount} from "../types/customer";

/** Data access for `customers`/`customer_groups` and their lending state on `book_stocks`. See CustomerService for the business rules built on top of this. */
export class CustomerRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /* ---------- Customer groups ---------- */

    /**
     * Lists every customer group belonging to `userId`, each with its member count.
     * @param userId Owning user's id.
     * @returns Every matching group.
     */
    public async findAllGroups(userId: number): Promise<CustomerGroupWithCount[]> {
        const result = await this.db.query(
            `SELECT cg.id,
                    cg.name,
                    cg.description,
                    COUNT(c.id)::int AS total_customers
               FROM customer_groups cg
               LEFT JOIN customers c
                 ON c.group_id = cg.id
                AND c.user_id = cg.user_id
              WHERE cg.user_id = $1
              GROUP BY cg.id, cg.name, cg.description
              ORDER BY cg.name`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Inserts a new customer group owned by `userId`.
     * @param userId Owning user's id.
     * @param name Group name.
     * @param description Group description, or null.
     * @returns The newly-created group.
     */
    public async createGroup(userId: number, name: string, description: string | null): Promise<CustomerGroup> {
        const result = await this.db.query(
            `INSERT INTO customer_groups (name, description, user_id) VALUES ($1, $2, $3) RETURNING id, name, description`,
            [name, description, userId]
        );
        return result.rows[0];
    }

    /**
     * Renames/redescribes a customer group, scoped to `userId`.
     * @param id Group id.
     * @param userId Owning user's id.
     * @param name New name.
     * @param description New description, or null.
     * @returns The updated group, or null if it doesn't exist or belongs to someone else.
     */
    public async renameGroup(id: number, userId: number, name: string, description: string | null): Promise<CustomerGroup | null> {
        const result = await this.db.query(
            `UPDATE customer_groups SET name = $1, description = $2 WHERE id = $3 AND user_id = $4 RETURNING id, name, description`,
            [name, description, id, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Deletes a customer group, scoped to `userId`.
     * @param id Group id.
     * @param userId Owning user's id.
     * @returns Whether a matching group was found and deleted.
     */
    public async removeGroup(id: number, userId: number): Promise<boolean> {
        const result = await this.db.query(`DELETE FROM customer_groups WHERE id = $1 AND user_id = $2`, [id, userId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Checks whether a customer group exists and belongs to `userId`.
     * @param id Group id.
     * @param userId Owning user's id.
     * @returns Whether a matching group exists.
     */
    public async groupExists(id: number, userId: number): Promise<boolean> {
        const result = await this.db.query(`SELECT id FROM customer_groups WHERE id = $1 AND user_id = $2`, [id, userId]);
        return (result.rowCount ?? 0) > 0;
    }

    /* ---------- Customer <-> group assignment ---------- */

    /**
     * Assigns a customer to a group, scoped to `userId`.
     * @param customerId Customer id.
     * @param groupId Group id to assign.
     * @param userId Owning user's id.
     * @returns The updated customer, or null if it doesn't exist or belongs to someone else.
     */
    public async assignGroup(customerId: number, groupId: number, userId: number): Promise<Customer | null> {
        const result = await this.db.query(
            `UPDATE customers SET group_id = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, group_id`,
            [groupId, customerId, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Clears a customer's group assignment, scoped to `userId`.
     * @param customerId Customer id.
     * @param userId Owning user's id.
     * @returns The updated customer, or null if it doesn't exist or belongs to someone else.
     */
    public async unassignGroup(customerId: number, userId: number): Promise<Customer | null> {
        const result = await this.db.query(
            `UPDATE customers SET group_id = NULL WHERE id = $1 AND user_id = $2 RETURNING id, name, group_id`,
            [customerId, userId]
        );
        return result.rows[0] ?? null;
    }

    /* ---------- Customers ---------- */

    /**
     * Lists every customer belonging to `userId`, each with its current loan count and group.
     * @param userId Owning user's id.
     * @returns Every matching customer.
     */
    public async findAll(userId: number): Promise<CustomerWithLoanCount[]> {
        const result = await this.db.query(
            `SELECT customers.id,
                    customers.name,
                    customers.group_id,
                    customer_groups.name AS group_name,
                    (SELECT count(*) FROM book_stocks WHERE book_stocks.customer_id = customers.id) AS total_books
               FROM customers
               LEFT JOIN customer_groups
                      ON customer_groups.id = customers.group_id
                     AND customer_groups.user_id = customers.user_id
              WHERE customers.user_id = $1`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Looks up one customer by id, scoped to `userId`.
     * @param id Customer id.
     * @param userId Owning user's id.
     * @returns The customer, or null if it doesn't exist or belongs to someone else.
     */
    public async findById(id: number | string, userId: number): Promise<Customer | null> {
        const result = await this.db.query(
            `SELECT customers.id,
                    customers.name,
                    customers.group_id,
                    customer_groups.name AS group_name
               FROM customers
               LEFT JOIN customer_groups
                      ON customer_groups.id = customers.group_id
                     AND customer_groups.user_id = customers.user_id
              WHERE customers.id = $1
                AND customers.user_id = $2`,
            [id, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Inserts a new customer owned by `userId`.
     * @param userId Owning user's id.
     * @param name Customer name.
     * @returns The new row's id.
     */
    public async create(userId: number, name: string): Promise<number> {
        const result = await this.db.query(`INSERT INTO customers (name, user_id) VALUES ($1, $2) RETURNING id`, [name, userId]);
        return result.rows[0].id;
    }

    /**
     * Renames a customer, scoped to `userId`.
     * @param id Customer id.
     * @param userId Owning user's id.
     * @param name New name.
     * @returns Rows affected - 0 if `id` doesn't exist or belongs to another user.
     */
    public async rename(id: string, userId: number, name: string): Promise<number> {
        const result = await this.db.query(`UPDATE customers SET name = $1 WHERE id = $2 AND user_id = $3`, [name, id, userId]);
        return result.rowCount ?? 0;
    }

    /**
     * Checks whether a customer exists and belongs to `userId`. Also used by BookService to validate an incoming `customerId`.
     * @param id Customer id.
     * @param userId Owning user's id.
     * @returns Whether a matching customer exists.
     */
    public async exists(id: number, userId: number): Promise<boolean> {
        const result = await this.db.query(`SELECT id FROM customers WHERE id = $1 AND user_id = $2`, [id, userId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Deletes a customer, scoped to `userId`. No-op if it doesn't exist or belongs to someone else.
     * @param id Customer id.
     * @param userId Owning user's id.
     */
    public async remove(id: number, userId: number): Promise<void> {
        await this.db.query(`DELETE FROM customers WHERE id = $1 AND user_id = $2`, [id, userId]);
    }

    /* ---------- Lending ---------- */

    /**
     * Lists the books currently loaned to a customer.
     * @param customerId Customer id.
     * @param userId Owning user's id.
     * @returns Every book stock currently loaned to that customer.
     */
    public async getLoanedBooks(customerId: number, userId: number): Promise<CustomerLoanedBook[]> {
        const result = await this.db.query(
            `SELECT books.id,
                    books.name,
                    books.image_url,
                    books.isbn,
                    book_stocks.code
               FROM book_stocks, books
              WHERE book_stocks.book_id = books.id
                AND book_stocks.user_id = $1
                AND books.user_id = $2
                AND book_stocks.customer_id = $3`,
            [userId, userId, customerId]
        );
        return result.rows;
    }

    /**
     * Marks one book stock as loaned to a customer.
     * @param customerId Customer id.
     * @param userId Owning user's id.
     * @param stockCode Book stock code to lend.
     */
    public async lendBookStock(customerId: number, userId: number, stockCode: string): Promise<void> {
        await this.db.query(
            `UPDATE book_stocks SET customer_id = $1, status = $2, loaned_at = NOW() WHERE code = $3 AND user_id = $4`,
            [customerId, 2, stockCode, userId]
        );
    }

    /**
     * Marks one book stock as returned. Silently no-ops if `stockCode` isn't currently on loan to this customer - matches the original route.
     * @param customerId Customer id the stock is expected to be loaned to.
     * @param userId Owning user's id.
     * @param stockCode Book stock code to return.
     */
    public async returnBookStock(customerId: number, userId: number, stockCode: string): Promise<void> {
        await this.db.query(
            `UPDATE book_stocks SET status = $1, customer_id = $2, loaned_at = NULL WHERE code = $3 AND customer_id = $4 AND user_id = $5`,
            [0, null, stockCode, customerId, userId]
        );
    }
}
