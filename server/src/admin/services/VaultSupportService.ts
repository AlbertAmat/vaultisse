/**
 * Support operations on vaults: hand a vault to another member, and empty parts of a vault.
 *
 * Clearing deletes content without ever reading it: it counts and deletes by table, so the admin sees how many
 * books or borrowers are in a vault, never which ones. What a clear removes can't be brought back.
 */
import {Pool} from "pg";
import {ConflictError, NotFoundError, ValidationError} from "../../errors/DomainError";
import {withTransaction} from "../../repositories/withTransaction";

export type PreviousAdmins = "keep" | "demote" | "remove";

export const CLEAR_SCOPES = ["books", "history", "customers", "groups", "authors", "categories", "locations", "card"] as const;
export type ClearScope = typeof CLEAR_SCOPES[number];

export interface ClearCounts {
    books: number;
    copies: number;
    files: number;
    history: number;
    customers: number;
    groups: number;
    authors: number;
    categories: number;
    locations: number;
    card: number;
}

/** Support operations on vaults. */
export class VaultSupportService {
    /**
     * @param pool Database pool.
     */
    public constructor(private readonly pool: Pool) {
    }

    private async requireVault(vaultId: number): Promise<{id: number; name: string}> {
        const vault = (await this.pool.query("SELECT id, name FROM vault WHERE id = $1", [vaultId])).rows[0];
        if (!vault) {
            throw new NotFoundError("Vault not found.");
        }
        return vault;
    }

    /**
     * Makes a member the admin of a vault, and decides what happens to the previous admins.
     * @param vaultId Vault id.
     * @param toUserId The member who takes over (must have accepted the membership).
     * @param previous `keep` them as admins, make them normal `demote`d members, or `remove` them from the vault.
     * @returns The vault name, the new admin's code and how many previous admins were changed.
     */
    public async transfer(vaultId: number, toUserId: number, previous: PreviousAdmins): Promise<{vault: string; newAdmin: string; changed: number}> {
        if (!["keep", "demote", "remove"].includes(previous)) {
            throw new ValidationError("Choose what happens to the previous admins: keep, demote or remove.");
        }
        const vault = await this.requireVault(vaultId);
        return withTransaction(this.pool, async (client) => {
            const target = (await client.query(
                `SELECT u.code, vu.status FROM vault_users vu JOIN users u ON u.id = vu.user_id WHERE vu.vault_id = $1 AND vu.user_id = $2 FOR UPDATE OF vu`, [vaultId, toUserId])).rows[0];
            if (!target) {
                throw new ValidationError("That account isn't a member of this vault. Add them as a member first.");
            }
            if (target.status !== 1) {
                throw new ConflictError("That member hasn't accepted the membership yet (or was refused).");
            }
            // Promote first: the database refuses a vault with no admin at any moment.
            await client.query("UPDATE vault_users SET role = 1, role_source = 0 WHERE vault_id = $1 AND user_id = $2", [vaultId, toUserId]);
            let changed = 0;
            if (previous !== "keep") {
                const others = (await client.query("SELECT user_id FROM vault_users WHERE vault_id = $1 AND role = 1 AND user_id <> $2", [vaultId, toUserId])).rows;
                for (const other of others) {
                    if (previous === "demote") {
                        await client.query("UPDATE vault_users SET role = 0, role_source = 0 WHERE vault_id = $1 AND user_id = $2", [vaultId, other.user_id]);
                    } else {
                        await client.query("DELETE FROM vault_users WHERE vault_id = $1 AND user_id = $2", [vaultId, other.user_id]);
                        await client.query("UPDATE users SET last_used_vault_id = NULL WHERE id = $1 AND last_used_vault_id = $2", [other.user_id, vaultId]);
                    }
                    changed++;
                }
            }
            return {vault: vault.name, newAdmin: target.code, changed};
        });
    }

    /**
     * @param vaultId Vault id.
     * @returns How much of each kind of content the vault holds (counts only).
     */
    public async counts(vaultId: number): Promise<{vault: {id: number; name: string}; counts: ClearCounts}> {
        const vault = await this.requireVault(vaultId);
        const one = async (sql: string) => Number((await this.pool.query(sql, [vaultId])).rows[0].n);
        return {
            vault,
            counts: {
                books: await one("SELECT COUNT(*)::int AS n FROM books WHERE vault_id = $1"),
                copies: await one("SELECT COUNT(*)::int AS n FROM book_stocks WHERE vault_id = $1"),
                files: await one("SELECT COUNT(*)::int AS n FROM book_files WHERE vault_id = $1"),
                history: await one("SELECT COUNT(*)::int AS n FROM loan_history WHERE vault_id = $1"),
                customers: await one("SELECT COUNT(*)::int AS n FROM customers WHERE vault_id = $1"),
                groups: await one("SELECT COUNT(*)::int AS n FROM customer_groups WHERE vault_id = $1"),
                authors: await one("SELECT COUNT(*)::int AS n FROM authors WHERE vault_id = $1"),
                categories: await one("SELECT COUNT(*)::int AS n FROM categories WHERE vault_id = $1"),
                locations: await one("SELECT COUNT(*)::int AS n FROM locations WHERE vault_id = $1"),
                card: await one("SELECT COUNT(*)::int AS n FROM customer_card_settings WHERE vault_id = $1"),
            },
        };
    }

    /**
     * Deletes the chosen kinds of content from a vault. The vault, its members, its plan and its SSO mapping stay.
     * @param vaultId Vault id.
     * @param scopes What to delete. `books` also removes their copies, files, reading status and the loan history.
     * @returns How many rows were removed per kind.
     */
    public async clear(vaultId: number, scopes: ClearScope[]): Promise<Record<string, number>> {
        if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some((s) => !CLEAR_SCOPES.includes(s))) {
            throw new ValidationError("Choose what to clear.");
        }
        await this.requireVault(vaultId);
        const wanted = new Set<ClearScope>(scopes);
        // A loan record points at a copy and a borrower: it can't outlive them.
        if (wanted.has("books") || wanted.has("customers")) wanted.add("history");
        const removed: Record<string, number> = {};
        return withTransaction(this.pool, async (client) => {
            const run = async (key: string, sql: string) => {
                removed[key] = (await client.query(sql, [vaultId])).rowCount ?? 0;
            };
            if (wanted.has("history")) await run("history", "DELETE FROM loan_history WHERE vault_id = $1");
            if (wanted.has("books")) {
                // Copies, files, reading status and author links go with the books (cascade).
                removed.copies = Number((await client.query("SELECT COUNT(*)::int AS n FROM book_stocks WHERE vault_id = $1", [vaultId])).rows[0].n);
                removed.files = Number((await client.query("SELECT COUNT(*)::int AS n FROM book_files WHERE vault_id = $1", [vaultId])).rows[0].n);
                await run("books", "DELETE FROM books WHERE vault_id = $1");
            }
            if (wanted.has("customers")) {
                // Copies still on loan to a borrower go back on the shelf before the borrower is removed.
                await client.query("UPDATE book_stocks SET status = 0, customer_id = NULL, loaned_at = NULL WHERE vault_id = $1 AND customer_id IS NOT NULL", [vaultId]);
                await run("customers", "DELETE FROM customers WHERE vault_id = $1");
            }
            if (wanted.has("groups")) await run("groups", "DELETE FROM customer_groups WHERE vault_id = $1");
            if (wanted.has("authors")) await run("authors", "DELETE FROM authors WHERE vault_id = $1");
            if (wanted.has("categories")) await run("categories", "DELETE FROM categories WHERE vault_id = $1");
            if (wanted.has("locations")) {
                await client.query("UPDATE book_stocks SET location_id = NULL WHERE vault_id = $1 AND location_id IS NOT NULL", [vaultId]);
                await run("locations", "DELETE FROM locations WHERE vault_id = $1");
            }
            if (wanted.has("card")) await run("card", "DELETE FROM customer_card_settings WHERE vault_id = $1");
            return removed;
        });
    }
}
