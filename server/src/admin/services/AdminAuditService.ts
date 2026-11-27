/**
 * Writes the admin audit trail. Every state-changing admin action calls {@link record}; the table is
 * append-only at the database level, so what is written here cannot later be edited from the portal.
 * A failure to write is rethrown: an action that can't be audited must not go ahead silently.
 */
import {Request} from "express";
import {Pool} from "pg";
import {AdminAuditRepository} from "../repositories/AdminAuditRepository";

export interface AuditTarget {
    entityType?: string;
    entityId?: number;
    entityLabel?: string;
    metadata?: Record<string, unknown>;
}

/** Records admin actions. */
export class AdminAuditService {
    private readonly repo: AdminAuditRepository;

    /**
     * @param pool Database pool.
     */
    public constructor(pool: Pool) {
        this.repo = new AdminAuditRepository(pool);
    }

    /**
     * Records an action by the admin a request is authenticated as.
     * @param req The request (supplies the admin and client address).
     * @param action Dotted action name, e.g. `user.disable`.
     * @param target What it was done to.
     */
    public async record(req: Request, action: string, target: AuditTarget = {}): Promise<void> {
        await this.repo.append({
            adminId: req.admin?.id ?? null,
            adminEmail: req.admin?.email ?? null,
            action,
            ...target,
            ip: req.ip ?? null,
        });
    }

    /**
     * Records an action with no authenticated admin (failed logins) or by the system (executed deletions).
     * @param action Dotted action name.
     * @param who Admin id/email if known, or nulls for the system.
     * @param ip Client address, if any.
     * @param target What it concerned.
     */
    public async recordAs(action: string, who: {id: number | null; email: string | null}, ip: string | null, target: AuditTarget = {}): Promise<void> {
        await this.repo.append({adminId: who.id, adminEmail: who.email, action, ...target, ip});
    }

    /**
     * @param filters Optional filters.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns A page of entries.
     */
    public list(filters: {action?: string; adminId?: number; entityType?: string}, limit: number, offset: number) {
        return this.repo.list(filters, limit, offset);
    }
}
