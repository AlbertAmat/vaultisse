/** Data access for finding who an email notification goes to. */
import {Pool, PoolClient} from "pg";
import {VaultUserStatus} from "@vaultisse/types/vault/IVaultUser";

/** Data access for notification recipients. */
export class NotificationRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Looks up a user's name and email. Unverified addresses are never returned.
     * @param userId User id.
     * @returns The user, or null.
     */
    public async findUser(userId: number): Promise<{name: string; email: string} | null> {
        const result = await this.db.query(`SELECT name, email FROM users WHERE id = $1 AND email_verified = TRUE`, [userId]);
        return result.rows[0] ?? null;
    }

    /**
     * Looks up a vault's name.
     * @param vaultId Vault id.
     * @returns The name, or null.
     */
    public async findVaultName(vaultId: number): Promise<string | null> {
        const result = await this.db.query(`SELECT name FROM vault WHERE id = $1`, [vaultId]);
        return result.rows[0]?.name ?? null;
    }

    /**
     * Lists the addresses of the accepted members who can manage a vault's members.
     * @param vaultId Vault id.
     * @returns Their email addresses.
     */
    public async listMemberManagerEmails(vaultId: number): Promise<string[]> {
        const result = await this.db.query(
            `SELECT u.email
               FROM vault_users vu
               JOIN users u ON u.id = vu.user_id
               JOIN vault_roles vr ON vr.code = vu.role
              WHERE vu.vault_id = $1 AND vu.status = $2 AND vr.can_manage_members
                AND u.disabled = FALSE AND u.email_verified = TRUE`,
            [vaultId, VaultUserStatus.ACCEPTED]
        );
        return result.rows.map((row) => row.email);
    }
}
