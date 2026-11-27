/** Data access for `plans` (quota tiers assignable to vaults). */
import {Pool} from "pg";

export interface PlanRow {
    id: number;
    code: string;
    name: string;
    maxBooks: number | null;
    maxMembers: number | null;
    maxStorageMb: number | null;
    isDefault: boolean;
    vaultCount: number;
}

const COLUMNS = `p.id, p.code, p.name, p.max_books AS "maxBooks", p.max_members AS "maxMembers",
                 p.max_storage_mb AS "maxStorageMb", p.is_default AS "isDefault",
                 (SELECT COUNT(*)::int FROM vault v WHERE v.plan_id = p.id) AS "vaultCount"`;

/** Data access for plans. */
export class PlanRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /** @returns Every plan. */
    public async list(): Promise<PlanRow[]> {
        const result = await this.db.query(`SELECT ${COLUMNS} FROM plans p ORDER BY p.id`);
        return result.rows;
    }

    /**
     * @param id Plan id.
     * @returns The plan, or null.
     */
    public async find(id: number): Promise<PlanRow | null> {
        const result = await this.db.query(`SELECT ${COLUMNS} FROM plans p WHERE p.id = $1`, [id]);
        return result.rows[0] ?? null;
    }

    /**
     * Creates a plan.
     * @param fields Plan fields (null limit = unlimited).
     * @returns The new plan's id.
     * @throws The raw pg error (23505 on a duplicate code).
     */
    public async create(fields: {code: string; name: string; maxBooks: number | null; maxMembers: number | null; maxStorageMb: number | null}): Promise<number> {
        const result = await this.db.query(
            `INSERT INTO plans (code, name, max_books, max_members, max_storage_mb) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [fields.code, fields.name, fields.maxBooks, fields.maxMembers, fields.maxStorageMb]
        );
        return result.rows[0].id;
    }

    /**
     * Replaces a plan's name and limits.
     * @param id Plan id.
     * @param fields New values.
     */
    public async update(id: number, fields: {name: string; maxBooks: number | null; maxMembers: number | null; maxStorageMb: number | null}): Promise<void> {
        await this.db.query(
            `UPDATE plans SET name = $2, max_books = $3, max_members = $4, max_storage_mb = $5 WHERE id = $1`,
            [id, fields.name, fields.maxBooks, fields.maxMembers, fields.maxStorageMb]
        );
    }

    /**
     * Makes one plan the default (used by vaults with no plan), or clears the default.
     * @param id Plan id, or null to have no default.
     */
    public async setDefault(id: number | null): Promise<void> {
        await this.db.query("UPDATE plans SET is_default = FALSE WHERE is_default");
        if (id !== null) {
            await this.db.query("UPDATE plans SET is_default = TRUE WHERE id = $1", [id]);
        }
    }

    /**
     * @param id Plan id.
     * @returns Whether a plan was deleted (vaults using it fall back to the default plan).
     */
    public async remove(id: number): Promise<boolean> {
        const result = await this.db.query("DELETE FROM plans WHERE id = $1", [id]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * @param vaultId Vault id.
     * @returns The plan that applies to the vault (its own, else the default), or null for unlimited.
     */
    public async effectiveForVault(vaultId: number): Promise<PlanRow | null> {
        const result = await this.db.query(
            `SELECT ${COLUMNS} FROM plans p
              WHERE p.id = COALESCE((SELECT plan_id FROM vault WHERE id = $1), (SELECT id FROM plans WHERE is_default))`,
            [vaultId]
        );
        return result.rows[0] ?? null;
    }
}
