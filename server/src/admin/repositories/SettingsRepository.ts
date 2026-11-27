/** Data access for `app_settings`. Values are stored exactly as given (secrets already encrypted by the service). */
import {Pool} from "pg";

export interface StoredSetting {
    key: string;
    value: string;
    isSecret: boolean;
    updatedAt: Date;
}

/** Data access for the `app_settings` table. */
export class SettingsRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /**
     * @returns Every stored override.
     */
    public async loadAll(): Promise<StoredSetting[]> {
        const result = await this.db.query(
            `SELECT key, value, is_secret AS "isSecret", updated_at AS "updatedAt" FROM app_settings`
        );
        return result.rows;
    }

    /**
     * The installation's permanent id (`INSTANCE_UUID`), created here when missing - normally the
     * migration already made it. Concurrent starts end up with the same value.
     * @returns The id.
     */
    public async ensureInstanceUuid(): Promise<string> {
        await this.db.query(
            "INSERT INTO app_settings (key, value) VALUES ('INSTANCE_UUID', gen_random_uuid()::text) ON CONFLICT (key) DO NOTHING"
        );
        const result = await this.db.query("SELECT value FROM app_settings WHERE key = 'INSTANCE_UUID'");
        return result.rows[0].value;
    }

    /**
     * Inserts or replaces one override.
     * @param key Setting key.
     * @param value Stored value (encrypted for secrets).
     * @param isSecret Whether `value` is an encrypted secret.
     * @param adminId Admin making the change.
     */
    public async upsert(key: string, value: string, isSecret: boolean, adminId: number): Promise<void> {
        await this.db.query(
            `INSERT INTO app_settings (key, value, is_secret, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (key) DO UPDATE
                SET value = EXCLUDED.value, is_secret = EXCLUDED.is_secret,
                    updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
            [key, value, isSecret, adminId]
        );
    }

    /**
     * Removes the overrides of the given settings in one go (the portal's "reset to environment variables").
     * Other rows, such as the instance id, are left alone.
     * @param keys Setting keys to remove.
     * @returns How many rows were removed.
     */
    public async removeMany(keys: string[]): Promise<number> {
        const result = await this.db.query("DELETE FROM app_settings WHERE key = ANY($1::text[])", [keys]);
        return result.rowCount ?? 0;
    }

    /**
     * @param key Key of a plain (non-setting) row such as `ONBOARDING_COMPLETED_AT`.
     * @returns Its value, or null.
     */
    public async getPlain(key: string): Promise<string | null> {
        const result = await this.db.query("SELECT value FROM app_settings WHERE key = $1", [key]);
        return result.rows[0]?.value ?? null;
    }

    /**
     * Stores a plain row that isn't an editable setting (not loaded into the configuration).
     * @param key Row key.
     * @param value Row value.
     */
    public async putPlain(key: string, value: string): Promise<void> {
        await this.db.query(
            `INSERT INTO app_settings (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, value]
        );
    }

    /**
     * Removes an override, so the env var (or default) applies again.
     * @param key Setting key.
     */
    public async remove(key: string): Promise<void> {
        await this.db.query("DELETE FROM app_settings WHERE key = $1", [key]);
    }
}
