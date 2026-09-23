import {Pool, PoolClient} from "pg";
import {AppPolicyCategory, AppPolicyCustomer, AppPolicyFormat, AppPolicyLanguage, AppPolicyLocation} from "../types/app";

/**
 * Data access for the `/app/policy` bootstrap payload. See PolicyService for
 * the orchestration built on top of this. These are deliberately narrow,
 * policy-payload-specific queries (just the id/name a dropdown needs), not
 * the fuller CategoryRepository/LocationRepository/CustomerRepository.findAll
 * used by those resources' own list endpoints - GET /app/policy has never
 * sent the richer shape (group/count fields) those return, and widening it
 * here would be an observable response-shape change for every client, not
 * just a structural refactor.
 */
export class AppRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Lists `{id, name}` for every customer belonging to `vaultId`, for the policy payload's customer dropdown.
     * @param vaultId Vault id.
     * @returns Every matching customer.
     */
    public async getCustomerNames(vaultId: number): Promise<AppPolicyCustomer[]> {
        const result = await this.db.query(`SELECT id, name FROM customers WHERE vault_id = $1`, [vaultId]);
        return result.rows;
    }

    /**
     * Lists `{id, name}` for every category belonging to `vaultId`, for the policy payload's category dropdown.
     * @param vaultId Vault id.
     * @returns Every matching category.
     */
    public async getCategoryNames(vaultId: number): Promise<AppPolicyCategory[]> {
        const result = await this.db.query(`SELECT id, name FROM categories WHERE vault_id = $1`, [vaultId]);
        return result.rows;
    }

    /**
     * Every row in the global `languages` table (not user-scoped).
     * @returns Every language.
     */
    public async getLanguages(): Promise<AppPolicyLanguage[]> {
        const result = await this.db.query(`SELECT code, name FROM languages`);
        return result.rows;
    }

    /**
     * Every row in the global `formats` table (not user-scoped), e.g. "Paperback".
     * @returns Every format.
     */
    public async getFormats(): Promise<AppPolicyFormat[]> {
        const result = await this.db.query(`SELECT id, name FROM formats`);
        return result.rows;
    }

    /**
     * Lists `{id, name, description, default}` for every location belonging to `vaultId`, for the policy payload's location dropdown.
     * @param vaultId Vault id.
     * @returns Every matching location.
     */
    public async getLocationSummaries(vaultId: number): Promise<AppPolicyLocation[]> {
        const result = await this.db.query(
            `SELECT id, name, description, "default"
               FROM locations
              WHERE vault_id = $1
              ORDER BY id`,
            [vaultId]
        );
        return result.rows;
    }

    /**
     * `{ labelCode: translatedText }` for `userId`'s configured `users.language`, from the `app_labels` translation table.
     * @param userId Owning user's id.
     * @returns The label-code to translated-text map.
     */
    public async getAppLabels(userId: number): Promise<Record<string, string>> {
        const result = await this.db.query(
            `SELECT app_labels.code, app_labels.text
               FROM app_labels, users
              WHERE users.id = $1
                AND app_labels.language = users.language`,
            [userId]
        );
        const labels: Record<string, string> = {};
        result.rows.forEach((row: {code: string; text: string}) => {
            labels[row.code] = row.text;
        });
        return labels;
    }
}
