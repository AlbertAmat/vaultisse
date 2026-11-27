/** Data access for the compliance page: control records, registers (policies, suppliers, risks, assets) and incidents. */
import {Pool} from "pg";

export type RegisterKind = "policy" | "supplier" | "risk" | "asset";
export type ControlStatus = "implemented" | "partial" | "planned" | "not_applicable";
export type Severity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "contained" | "resolved" | "closed";

export interface ControlRecord {
    controlId: string;
    status: ControlStatus | null;
    owner: string | null;
    justification: string | null;
    evidenceUrl: string | null;
    reviewedAt: Date | null;
    reviewedBy: string | null;
    nextReviewAt: string | null;
}

export interface RegisterRow {
    id: number;
    kind: RegisterKind;
    title: string;
    owner: string | null;
    status: "draft" | "active" | "retired";
    rating: "low" | "medium" | "high" | null;
    version: string | null;
    details: string | null;
    referenceUrl: string | null;
    approvedAt: string | null;
    nextReviewAt: string | null;
    updatedDate: Date;
}

export interface IncidentRow {
    id: number;
    title: string;
    severity: Severity;
    status: IncidentStatus;
    detectedAt: Date;
    resolvedAt: Date | null;
    description: string | null;
    actions: string | null;
    lessons: string | null;
    personalData: boolean;
    authorityNotifiedAt: Date | null;
    usersNotifiedAt: Date | null;
    createdBy: string | null;
}

export type RegisterInput = Omit<RegisterRow, "id" | "updatedDate">;
export type IncidentInput = Omit<IncidentRow, "id" | "createdBy">;

const REGISTER_COLUMNS = `id, kind, title, owner, status, rating, version, details, reference_url AS "referenceUrl",
    to_char(approved_at, 'YYYY-MM-DD') AS "approvedAt", to_char(next_review_at, 'YYYY-MM-DD') AS "nextReviewAt", updated_date AS "updatedDate"`;
const INCIDENT_COLUMNS = `i.id, i.title, i.severity, i.status, i.detected_at AS "detectedAt", i.resolved_at AS "resolvedAt", i.description,
    i.actions, i.lessons, i.personal_data AS "personalData", i.authority_notified_at AS "authorityNotifiedAt",
    i.users_notified_at AS "usersNotifiedAt", a.email AS "createdBy"`;

/** Data access for the compliance page. */
export class ComplianceRepository {
    /**
     * @param db Connection pool.
     */
    public constructor(private readonly db: Pool) {
    }

    /** @returns What was recorded about each control, by control id. */
    public async controlRecords(): Promise<Map<string, ControlRecord>> {
        const result = await this.db.query(
            `SELECT c.control_id AS "controlId", c.status, c.owner, c.justification, c.evidence_url AS "evidenceUrl",
                    c.reviewed_at AS "reviewedAt", a.email AS "reviewedBy", to_char(c.next_review_at, 'YYYY-MM-DD') AS "nextReviewAt"
               FROM compliance_controls c LEFT JOIN admin_users a ON a.id = c.reviewed_by`
        );
        return new Map(result.rows.map((row: ControlRecord) => [row.controlId, row]));
    }

    /**
     * Saves what a person recorded about a control.
     * @param controlId Control id.
     * @param input The fields; `reviewed` stamps the review with now and the admin.
     * @param adminId Admin saving.
     */
    public async saveControl(controlId: string, input: {status: ControlStatus | null; owner: string | null; justification: string | null; evidenceUrl: string | null; nextReviewAt: string | null; reviewed: boolean}, adminId: number): Promise<void> {
        await this.db.query(
            `INSERT INTO compliance_controls (control_id, status, owner, justification, evidence_url, next_review_at, reviewed_at, reviewed_by)
             VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN CURRENT_TIMESTAMP END, CASE WHEN $7 THEN $8::int END)
             ON CONFLICT (control_id) DO UPDATE
                SET status = EXCLUDED.status, owner = EXCLUDED.owner, justification = EXCLUDED.justification,
                    evidence_url = EXCLUDED.evidence_url, next_review_at = EXCLUDED.next_review_at,
                    reviewed_at = CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE compliance_controls.reviewed_at END,
                    reviewed_by = CASE WHEN $7 THEN $8::int ELSE compliance_controls.reviewed_by END`,
            [controlId, input.status, input.owner, input.justification, input.evidenceUrl, input.nextReviewAt, input.reviewed, adminId]
        );
    }

    /**
     * @param kind Optional kind filter.
     * @returns Register entries, soonest review first.
     */
    public async listRegister(kind?: RegisterKind): Promise<RegisterRow[]> {
        const result = await this.db.query(
            `SELECT ${REGISTER_COLUMNS} FROM compliance_register ${kind ? "WHERE kind = $1" : ""}
              ORDER BY kind, next_review_at NULLS LAST, title`, kind ? [kind] : []
        );
        return result.rows;
    }

    /** @param id Entry id. @returns The entry or null. */
    public async findRegister(id: number): Promise<RegisterRow | null> {
        const result = await this.db.query(`SELECT ${REGISTER_COLUMNS} FROM compliance_register WHERE id = $1`, [id]);
        return result.rows[0] ?? null;
    }

    /**
     * @param input The entry.
     * @param adminId Admin creating it.
     * @returns The new id.
     */
    public async createRegister(input: RegisterInput, adminId: number): Promise<number> {
        const result = await this.db.query(
            `INSERT INTO compliance_register (kind, title, owner, status, rating, version, details, reference_url, approved_at, next_review_at, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [input.kind, input.title, input.owner, input.status, input.rating, input.version, input.details, input.referenceUrl, input.approvedAt, input.nextReviewAt, adminId]
        );
        return result.rows[0].id;
    }

    /**
     * @param id Entry id.
     * @param input New values (the kind never changes).
     * @returns Whether it exists.
     */
    public async updateRegister(id: number, input: RegisterInput): Promise<boolean> {
        const result = await this.db.query(
            `UPDATE compliance_register SET title = $2, owner = $3, status = $4, rating = $5, version = $6, details = $7,
                    reference_url = $8, approved_at = $9, next_review_at = $10, updated_date = CURRENT_TIMESTAMP WHERE id = $1`,
            [id, input.title, input.owner, input.status, input.rating, input.version, input.details, input.referenceUrl, input.approvedAt, input.nextReviewAt]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /** @param id Entry id. @returns Whether it existed. */
    public async removeRegister(id: number): Promise<boolean> {
        const result = await this.db.query("DELETE FROM compliance_register WHERE id = $1", [id]);
        return (result.rowCount ?? 0) > 0;
    }

    /** @returns Every incident, newest first. */
    public async listIncidents(): Promise<IncidentRow[]> {
        const result = await this.db.query(`SELECT ${INCIDENT_COLUMNS} FROM security_incidents i LEFT JOIN admin_users a ON a.id = i.created_by ORDER BY i.detected_at DESC`);
        return result.rows;
    }

    /** @param id Incident id. @returns The incident or null. */
    public async findIncident(id: number): Promise<IncidentRow | null> {
        const result = await this.db.query(`SELECT ${INCIDENT_COLUMNS} FROM security_incidents i LEFT JOIN admin_users a ON a.id = i.created_by WHERE i.id = $1`, [id]);
        return result.rows[0] ?? null;
    }

    /**
     * @param input The incident.
     * @param adminId Admin recording it.
     * @returns The new id.
     */
    public async createIncident(input: IncidentInput, adminId: number): Promise<number> {
        const result = await this.db.query(
            `INSERT INTO security_incidents (title, severity, status, detected_at, resolved_at, description, actions, lessons, personal_data, authority_notified_at, users_notified_at, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [input.title, input.severity, input.status, input.detectedAt, input.resolvedAt, input.description, input.actions, input.lessons, input.personalData, input.authorityNotifiedAt, input.usersNotifiedAt, adminId]
        );
        return result.rows[0].id;
    }

    /**
     * @param id Incident id.
     * @param input New values.
     * @returns Whether it exists.
     */
    public async updateIncident(id: number, input: IncidentInput): Promise<boolean> {
        const result = await this.db.query(
            `UPDATE security_incidents SET title = $2, severity = $3, status = $4, detected_at = $5, resolved_at = $6, description = $7,
                    actions = $8, lessons = $9, personal_data = $10, authority_notified_at = $11, users_notified_at = $12 WHERE id = $1`,
            [id, input.title, input.severity, input.status, input.detectedAt, input.resolvedAt, input.description, input.actions, input.lessons, input.personalData, input.authorityNotifiedAt, input.usersNotifiedAt]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /** @returns The admins with when their access was last reviewed. */
    public async accessReviews(): Promise<{id: number; email: string; name: string; role: string; disabled: boolean; lastLoginDate: Date | null; accessReviewedAt: Date | null; reviewedBy: string | null}[]> {
        const result = await this.db.query(
            `SELECT a.id, a.email, a.name, a.role, a.disabled, a.last_login_date AS "lastLoginDate",
                    a.access_reviewed_at AS "accessReviewedAt", r.email AS "reviewedBy"
               FROM admin_users a LEFT JOIN admin_users r ON r.id = a.access_reviewed_by ORDER BY a.id`
        );
        return result.rows;
    }

    /**
     * Confirms that admins still need their access.
     * @param ids Admin ids, or null for every enabled admin.
     * @param reviewerId Admin doing the review.
     * @returns How many were confirmed.
     */
    public async confirmAccess(ids: number[] | null, reviewerId: number): Promise<number> {
        const result = await this.db.query(
            `UPDATE admin_users SET access_reviewed_at = CURRENT_TIMESTAMP, access_reviewed_by = $1
              WHERE NOT disabled ${ids ? "AND id = ANY($2::int[])" : ""}`, ids ? [reviewerId, ids] : [reviewerId]
        );
        return result.rowCount ?? 0;
    }
}
