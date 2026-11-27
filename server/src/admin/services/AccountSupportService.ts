/**
 * Support operations on accounts that admins otherwise do in SQL: change an email address and merge two accounts.
 *
 * Only account data is touched. Nothing here reads what is inside a vault: memberships and attributions are moved by
 * id, never opened.
 */
import {Pool} from "pg";
import {ConflictError, NotFoundError, ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {withTransaction} from "../../repositories/withTransaction";

/** Tables whose rows of the merged-away account are dropped with it (the target keeps its own). */
const DROPPED_WITH_ACCOUNT = new Set([
    "user_sessions", "user_backup_codes", "user_email_verifications", "user_security_notice_acknowledgements", "user_terms_of_service_acknowledgements",
]);
/** Handled one by one in {@link AccountSupportService.merge}. */
const HANDLED_APART = new Set(["vault_users", "account_tags", "account_notes", "book_reading_status"]);

export interface MergeResult {
    vaultsMoved: number;
    vaultsCombined: number;
    rowsReassigned: number;
}

/** @param email An address. @returns It with the middle hidden, for the audit trail. */
/**
 * Example:
 *   maskEmail("alice@example.com") // "a***@example.com"
 */
export function maskEmail(email: string): string {
    const [name, domain] = email.split("@");
    return `${name.slice(0, 1)}***@${domain ?? ""}`;
}

/** Support operations on accounts. */
export class AccountSupportService {
    /**
     * @param pool Database pool.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Changes the email address of an account.
     * @param userId Account id.
     * @param newEmail The new address.
     * @param markVerified The admin confirmed the address with the person (otherwise they verify it themselves).
     * @returns What was done.
     */
    public async changeEmail(userId: number, newEmail: string, markVerified: boolean): Promise<{oldEmail: string; email: string; verified: boolean; notified: boolean}> {
        const email = typeof newEmail === "string" ? newEmail.trim() : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
            throw new ValidationError("That isn't a valid email address.");
        }
        const current = (await this.pool.query("SELECT email FROM users WHERE id = $1", [userId])).rows[0];
        if (!current) {
            throw new NotFoundError("Account not found.");
        }
        if (current.email.toLowerCase() === email.toLowerCase()) {
            throw new ValidationError("That is already their email address.");
        }
        const taken = await this.pool.query("SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2", [email, userId]);
        if ((taken.rowCount ?? 0) > 0) {
            throw new ConflictError("Another account already uses that address. To combine the two, merge them instead.");
        }
        const mail = appService.getMailService();
        // Without email nobody can verify anything, so the address counts as verified.
        const verified = markVerified || !mail.isEnabled();
        try {
            await withTransaction(this.pool, async (client) => {
                await client.query("UPDATE users SET email = $2, email_verified = $3 WHERE id = $1", [userId, email, verified]);
                await client.query("DELETE FROM user_email_verifications WHERE user_id = $1", [userId]);
            });
        } catch (error) {
            if ((error as {code?: string}).code === "23505") {
                throw new ConflictError("Another account already uses that address.");
            }
            throw error;
        }
        let notified = false;
        if (mail.isEnabled()) {
            // Tell the old address, so a change nobody asked for doesn't go unnoticed.
            notified = (await mail.sendReportingError(current.email,
                "The email address of your Vaultisse account was changed",
                `An administrator changed the email address of your account to ${maskEmail(email)}.\n\nIf you didn't ask for this, contact the administrators of this installation straight away.`)) === null;
        }
        return {oldEmail: current.email, email, verified, notified};
    }

    /**
     * Merges one account into another: the target gets the source's vault memberships and everything the source
     * created or borrowed, then the source account is deleted. Runs as one transaction: it all happens or nothing does.
     * @param targetId The account that stays.
     * @param sourceId The account that goes.
     * @returns What was moved.
     */
    public async merge(targetId: number, sourceId: number): Promise<MergeResult> {
        if (targetId === sourceId) {
            throw new ValidationError("Choose two different accounts.");
        }
        return withTransaction(this.pool, async (client) => {
            const found = await client.query("SELECT id FROM users WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE", [[targetId, sourceId]]);
            if (found.rowCount !== 2) {
                throw new NotFoundError("Account not found.");
            }
            let vaultsMoved = 0;
            let vaultsCombined = 0;
            let rowsReassigned = 0;

            // Memberships: move them, or fold them into the ones the target already has (the stronger role wins).
            const memberships = (await client.query("SELECT vault_id, role, status FROM vault_users WHERE user_id = $1", [sourceId])).rows;
            for (const m of memberships) {
                const existing = (await client.query("SELECT role, status FROM vault_users WHERE vault_id = $1 AND user_id = $2", [m.vault_id, targetId])).rows[0];
                if (!existing) {
                    await client.query("UPDATE vault_users SET user_id = $3 WHERE vault_id = $1 AND user_id = $2", [m.vault_id, sourceId, targetId]);
                    vaultsMoved++;
                    continue;
                }
                const becomesAdmin = m.role === 1 && existing.role !== 1;
                const becomesMember = m.status === 1 && existing.status !== 1;
                if (becomesAdmin || becomesMember) {
                    await client.query(
                        `UPDATE vault_users SET role = CASE WHEN $3::boolean THEN 1 ELSE role END, role_source = CASE WHEN $3::boolean THEN 0 ELSE role_source END,
                                status = CASE WHEN $4::boolean THEN 1 ELSE status END WHERE vault_id = $1 AND user_id = $2`,
                        [m.vault_id, targetId, becomesAdmin, becomesMember]);
                }
                await client.query("DELETE FROM vault_users WHERE vault_id = $1 AND user_id = $2", [m.vault_id, sourceId]);
                vaultsCombined++;
            }

            // Admin notes, tags and reading status follow the person.
            await client.query("UPDATE account_notes SET user_id = $2 WHERE user_id = $1", [sourceId, targetId]);
            await client.query("INSERT INTO account_tags (user_id, tag, created_by, created_date) SELECT $2, tag, created_by, created_date FROM account_tags WHERE user_id = $1 ON CONFLICT DO NOTHING", [sourceId, targetId]);
            await client.query("UPDATE book_reading_status SET user_id = $2 WHERE user_id = $1 AND book_id NOT IN (SELECT book_id FROM book_reading_status WHERE user_id = $2)", [sourceId, targetId]);

            // Everything else that points at the account (who created a book, who borrowed a copy, the activity log, ...).
            const refs = (await client.query(
                `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col FROM pg_constraint c
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
                  WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass`)).rows as {tbl: string; col: string}[];
            for (const ref of refs) {
                if (DROPPED_WITH_ACCOUNT.has(ref.tbl) || HANDLED_APART.has(ref.tbl) || !/^[a-z_]+$/.test(ref.tbl) || !/^[a-z_]+$/.test(ref.col)) {
                    continue;
                }
                const result = await client.query(`UPDATE ${ref.tbl} SET ${ref.col} = $2 WHERE ${ref.col} = $1`, [sourceId, targetId]);
                rowsReassigned += result.rowCount ?? 0;
            }

            await client.query("UPDATE scheduled_deletions SET cancelled_at = CURRENT_TIMESTAMP WHERE entity_type = 'user' AND entity_id = $1 AND cancelled_at IS NULL AND executed_at IS NULL", [sourceId]);
            await client.query("DELETE FROM users WHERE id = $1", [sourceId]);
            return {vaultsMoved, vaultsCombined, rowsReassigned};
        });
    }
}
