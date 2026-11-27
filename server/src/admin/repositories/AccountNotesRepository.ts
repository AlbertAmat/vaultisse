/** Data access for the private notes and tags admins keep on accounts. */
import {Pool} from "pg";

export interface AccountNote {
    id: number;
    body: string;
    createdBy: string | null;
    createdDate: Date;
}

/** Notes and tags on accounts. */
export class AccountNotesRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /** @param userId Account id. @returns Its notes, newest first. */
    public async notes(userId: number): Promise<AccountNote[]> {
        const result = await this.db.query(
            `SELECT n.id, n.body, a.email AS "createdBy", n.created_date AS "createdDate"
               FROM account_notes n LEFT JOIN admin_users a ON a.id = n.created_by WHERE n.user_id = $1 ORDER BY n.id DESC`, [userId]);
        return result.rows;
    }

    /** @param userId Account id. @param body Note text. @param adminId Author. @returns The new id. */
    public async addNote(userId: number, body: string, adminId: number): Promise<number> {
        const result = await this.db.query("INSERT INTO account_notes (user_id, body, created_by) VALUES ($1, $2, $3) RETURNING id", [userId, body, adminId]);
        return result.rows[0].id;
    }

    /** @param userId Account id. @param noteId Note id. @returns Whether it existed. */
    public async removeNote(userId: number, noteId: number): Promise<boolean> {
        const result = await this.db.query("DELETE FROM account_notes WHERE id = $1 AND user_id = $2", [noteId, userId]);
        return (result.rowCount ?? 0) > 0;
    }

    /** @param userId Account id. @returns Its tags. */
    public async tags(userId: number): Promise<string[]> {
        const result = await this.db.query("SELECT tag FROM account_tags WHERE user_id = $1 ORDER BY tag", [userId]);
        return result.rows.map((row: {tag: string}) => row.tag);
    }

    /**
     * Replaces the tags of an account.
     * @param userId Account id.
     * @param tags The new tags.
     * @param adminId Admin making the change.
     */
    public async setTags(userId: number, tags: string[], adminId: number): Promise<void> {
        await this.db.query("DELETE FROM account_tags WHERE user_id = $1 AND NOT (tag = ANY($2::text[]))", [userId, tags]);
        for (const tag of tags) {
            await this.db.query("INSERT INTO account_tags (user_id, tag, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [userId, tag, adminId]);
        }
    }

    /** @returns Every tag in use with the number of accounts carrying it. */
    public async allTags(): Promise<{tag: string; count: number}[]> {
        const result = await this.db.query("SELECT tag, COUNT(*)::int AS count FROM account_tags GROUP BY tag ORDER BY count DESC, tag");
        return result.rows;
    }
}
