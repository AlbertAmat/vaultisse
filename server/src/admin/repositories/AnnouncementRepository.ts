/** Data access for `announcements`: the banners shown to every user of the app. */
import {Pool} from "pg";

export type AnnouncementLevel = "info" | "warning" | "critical";

export interface AnnouncementRow {
    id: number;
    message: string;
    level: AnnouncementLevel;
    startsAt: Date;
    endsAt: Date | null;
    enabled: boolean;
    createdBy: string | null;
    createdDate: Date;
}

const COLUMNS = `a.id, a.message, a.level, a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.enabled,
                 adm.email AS "createdBy", a.created_date AS "createdDate"`;

/** Data access for announcements. */
export class AnnouncementRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /** @returns Every announcement, newest first. */
    public async list(): Promise<AnnouncementRow[]> {
        const result = await this.db.query(`SELECT ${COLUMNS} FROM announcements a LEFT JOIN admin_users adm ON adm.id = a.created_by ORDER BY a.id DESC LIMIT 200`);
        return result.rows;
    }

    /** @returns The announcements being shown right now, most severe first. */
    public async active(): Promise<AnnouncementRow[]> {
        const result = await this.db.query(
            `SELECT ${COLUMNS} FROM announcements a LEFT JOIN admin_users adm ON adm.id = a.created_by
              WHERE a.enabled AND a.starts_at <= CURRENT_TIMESTAMP AND (a.ends_at IS NULL OR a.ends_at > CURRENT_TIMESTAMP)
              ORDER BY CASE a.level WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.id DESC`
        );
        return result.rows;
    }

    /**
     * @param id Announcement id.
     * @returns The announcement, or null.
     */
    public async find(id: number): Promise<AnnouncementRow | null> {
        const result = await this.db.query(`SELECT ${COLUMNS} FROM announcements a LEFT JOIN admin_users adm ON adm.id = a.created_by WHERE a.id = $1`, [id]);
        return result.rows[0] ?? null;
    }

    /**
     * @param fields New announcement.
     * @returns Its id.
     */
    public async create(fields: {message: string; level: AnnouncementLevel; startsAt: Date; endsAt: Date | null; adminId: number}): Promise<number> {
        const result = await this.db.query(
            "INSERT INTO announcements (message, level, starts_at, ends_at, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [fields.message, fields.level, fields.startsAt, fields.endsAt, fields.adminId]
        );
        return result.rows[0].id;
    }

    /**
     * @param id Announcement id.
     * @param fields New values.
     */
    public async update(id: number, fields: {message: string; level: AnnouncementLevel; startsAt: Date; endsAt: Date | null; enabled: boolean}): Promise<void> {
        await this.db.query(
            "UPDATE announcements SET message = $2, level = $3, starts_at = $4, ends_at = $5, enabled = $6 WHERE id = $1",
            [id, fields.message, fields.level, fields.startsAt, fields.endsAt, fields.enabled]
        );
    }

    /**
     * @param id Announcement id.
     * @returns Whether one was removed.
     */
    public async remove(id: number): Promise<boolean> {
        const result = await this.db.query("DELETE FROM announcements WHERE id = $1", [id]);
        return (result.rowCount ?? 0) > 0;
    }
}
