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
     * Lists every customer group belonging to `vaultId`, each with its member count.
     * @param vaultId Vault id.
     * @returns Every matching group.
     */
    public async findAllGroups(vaultId: number): Promise<CustomerGroupWithCount[]> {
        const result = await this.db.query(
            `SELECT cg.id,
                    cg.name,
                    cg.description,
                    COUNT(c.id)::int AS total_customers
               FROM customer_groups cg
               LEFT JOIN customers c
                 ON c.group_id = cg.id
                AND c.vault_id = cg.vault_id
              WHERE cg.vault_id = $1
              GROUP BY cg.id, cg.name, cg.description
              ORDER BY cg.name`,
            [vaultId]
        );
        return result.rows;
    }

    /**
     * Inserts a new customer group owned by `vaultId`.
     * @param vaultId Vault id.
     * @param name Group name.
     * @param description Group description, or null.
     * @returns The newly-created group.
     */
    public async createGroup(vaultId: number, name: string, description: string | null): Promise<CustomerGroup> {
        const result = await this.db.query(
            `INSERT INTO customer_groups (name, description, vault_id) VALUES ($1, $2, $3) RETURNING id, name, description`,
            [name, description, vaultId]
        );
        return result.rows[0];
    }

    /**
     * Renames/redescribes a customer group, scoped to `vaultId`.
     * @param id Group id.
     * @param vaultId Vault id.
     * @param name New name.
     * @param description New description, or null.
     * @returns The updated group, or null if it doesn't exist or belongs to someone else.
     */
    public async renameGroup(id: number, vaultId: number, name: string, description: string | null): Promise<CustomerGroup | null> {
        const result = await this.db.query(
            `UPDATE customer_groups SET name = $1, description = $2 WHERE id = $3 AND vault_id = $4 RETURNING id, name, description`,
            [name, description, id, vaultId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Deletes a customer group, scoped to `vaultId`.
     * @param id Group id.
     * @param vaultId Vault id.
     * @returns Whether a matching group was found and deleted.
     */
    public async removeGroup(id: number, vaultId: number): Promise<boolean> {
        const result = await this.db.query(`DELETE FROM customer_groups WHERE id = $1 AND vault_id = $2`, [id, vaultId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Checks whether a customer group exists and belongs to `vaultId`.
     * @param id Group id.
     * @param vaultId Vault id.
     * @returns Whether a matching group exists.
     */
    public async groupExists(id: number, vaultId: number): Promise<boolean> {
        const result = await this.db.query(`SELECT id FROM customer_groups WHERE id = $1 AND vault_id = $2`, [id, vaultId]);
        return (result.rowCount ?? 0) > 0;
    }

    /* ---------- Customer <-> group assignment ---------- */

    /**
     * Assigns a customer to a group, scoped to `vaultId`.
     * @param customerId Customer id.
     * @param groupId Group id to assign.
     * @param vaultId Vault id.
     * @returns The updated customer, or null if it doesn't exist or belongs to someone else.
     */
    public async assignGroup(customerId: number, groupId: number, vaultId: number): Promise<Customer | null> {
        const result = await this.db.query(
            `UPDATE customers SET group_id = $1 WHERE id = $2 AND vault_id = $3 RETURNING id, name, group_id`,
            [groupId, customerId, vaultId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Clears a customer's group assignment, scoped to `vaultId`.
     * @param customerId Customer id.
     * @param vaultId Vault id.
     * @returns The updated customer, or null if it doesn't exist or belongs to someone else.
     */
    public async unassignGroup(customerId: number, vaultId: number): Promise<Customer | null> {
        const result = await this.db.query(
            `UPDATE customers SET group_id = NULL WHERE id = $1 AND vault_id = $2 RETURNING id, name, group_id`,
            [customerId, vaultId]
        );
        return result.rows[0] ?? null;
    }

    /* ---------- Customers ---------- */

    /**
     * Lists every customer belonging to `vaultId`, each with its current loan count and group.
     * @param vaultId Vault id.
     * @returns Every matching customer.
     */
    public async findAll(vaultId: number): Promise<CustomerWithLoanCount[]> {
        const result = await this.db.query(
            `SELECT customers.id,
                    customers.name,
                    customers.group_id,
                    customer_groups.name AS group_name,
                    (SELECT count(*) FROM book_stocks WHERE book_stocks.customer_id = customers.id) AS total_books
               FROM customers
               LEFT JOIN customer_groups
                      ON customer_groups.id = customers.group_id
                     AND customer_groups.vault_id = customers.vault_id
              WHERE customers.vault_id = $1`,
            [vaultId]
        );
        return result.rows;
    }

    /**
     * Looks up one customer by id, scoped to `vaultId`.
     * @param id Customer id.
     * @param vaultId Vault id.
     * @returns The customer, or null if it doesn't exist or belongs to someone else.
     */
    public async findById(id: number | string, vaultId: number): Promise<Customer | null> {
        const result = await this.db.query(
            `SELECT customers.id,
                    customers.name,
                    customers.group_id,
                    customer_groups.name AS group_name
               FROM customers
               LEFT JOIN customer_groups
                      ON customer_groups.id = customers.group_id
                     AND customer_groups.vault_id = customers.vault_id
              WHERE customers.id = $1
                AND customers.vault_id = $2`,
            [id, vaultId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Inserts a new customer owned by `vaultId`.
     * @param vaultId Vault id.
     * @param name Customer name.
     * @returns The new row's id.
     */
    public async create(vaultId: number, name: string): Promise<number> {
        const result = await this.db.query(`INSERT INTO customers (name, vault_id) VALUES ($1, $2) RETURNING id`, [name, vaultId]);
        return result.rows[0].id;
    }

    /**
     * Renames a customer, scoped to `vaultId`.
     * @param id Customer id.
     * @param vaultId Vault id.
     * @param name New name.
     * @returns Rows affected - 0 if `id` doesn't exist or belongs to another vault.
     */
    public async rename(id: string, vaultId: number, name: string): Promise<number> {
        const result = await this.db.query(`UPDATE customers SET name = $1 WHERE id = $2 AND vault_id = $3`, [name, id, vaultId]);
        return result.rowCount ?? 0;
    }

    /**
     * Checks whether a customer exists and belongs to `vaultId`. Also used by BookService to validate an incoming `customerId`.
     * @param id Customer id.
     * @param vaultId Vault id.
     * @returns Whether a matching customer exists.
     */
    public async exists(id: number, vaultId: number): Promise<boolean> {
        const result = await this.db.query(`SELECT id FROM customers WHERE id = $1 AND vault_id = $2`, [id, vaultId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Deletes a customer, scoped to `vaultId`. No-op if it doesn't exist or belongs to someone else.
     * @param id Customer id.
     * @param vaultId Vault id.
     */
    public async remove(id: number, vaultId: number): Promise<void> {
        await this.db.query(`DELETE FROM customers WHERE id = $1 AND vault_id = $2`, [id, vaultId]);
    }

    /* ---------- Lending ---------- */

    /**
     * Lists the books currently loaned to a customer.
     * @param customerId Customer id.
     * @param vaultId Vault id.
     * @returns Every book stock currently loaned to that customer.
     */
    public async getLoanedBooks(customerId: number, vaultId: number): Promise<CustomerLoanedBook[]> {
        const result = await this.db.query(
            `SELECT books.id,
                    books.name,
                    books.image_url,
                    books.isbn,
                    book_stocks.code
               FROM book_stocks, books
              WHERE book_stocks.book_id = books.id
                AND book_stocks.vault_id = $1
                AND books.vault_id = $2
                AND book_stocks.customer_id = $3`,
            [vaultId, vaultId, customerId]
        );
        return result.rows;
    }

    /**
     * Marks one book stock as loaned to a customer.
     * @param customerId Customer id.
     * @param vaultId Vault id.
     * @param stockCode Book stock code to lend.
     */
    public async lendBookStock(customerId: number, vaultId: number, stockCode: string): Promise<void> {
        await this.db.query(
            `UPDATE book_stocks SET customer_id = $1, status = $2, loaned_at = NOW() WHERE code = $3 AND vault_id = $4`,
            [customerId, 2, stockCode, vaultId]
        );
    }

    /**
     * Marks one book stock as returned. Silently no-ops if `stockCode` isn't currently on loan to this customer - matches the original route.
     * @param customerId Customer id the stock is expected to be loaned to.
     * @param vaultId Vault id.
     * @param stockCode Book stock code to return.
     */
    public async returnBookStock(customerId: number, vaultId: number, stockCode: string): Promise<void> {
        await this.db.query(
            `UPDATE book_stocks SET status = $1, customer_id = $2, loaned_at = NULL WHERE code = $3 AND customer_id = $4 AND vault_id = $5`,
            [0, null, stockCode, customerId, vaultId]
        );
    }
}
