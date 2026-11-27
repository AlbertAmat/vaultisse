/**
 * What an admin can do to one account, in one place: approve, disable, enable, sign out everywhere, and delete
 * (with the usual grace period). The single-account endpoints and the bulk endpoint both go through here, so
 * they follow exactly the same rules and leave exactly the same audit trail, one entry per account.
 */
import {Request} from "express";
import {Pool} from "pg";
import {appService} from "../../AppService";
import {ConflictError, DomainError, NotFoundError} from "../../errors/DomainError";
import {PlatformRepository, UserListRow} from "../repositories/PlatformRepository";
import {AdminAuditService} from "./AdminAuditService";
import {DeletionService} from "./DeletionService";

export type AccountAction = "approve" | "disable" | "enable" | "force-logout" | "delete";
export const ACCOUNT_ACTIONS: AccountAction[] = ["approve", "disable", "enable", "force-logout", "delete"];

export interface ActionResult {
    id: number;
    code: string | null;
    ok: boolean;
    message: string;
}

/** Actions on accounts. */
export class AccountActions {
    private readonly platform: PlatformRepository;

    /**
     * @param pool Database pool.
     * @param audit Admin audit trail.
     * @param deletions Deletion service (for delete).
     */
    public constructor(pool: Pool, private readonly audit: AdminAuditService, private readonly deletions: DeletionService) {
        this.platform = new PlatformRepository(pool);
    }

    /** @throws NotFoundError when the account doesn't exist. */
    public async require(id: number): Promise<UserListRow> {
        const user = await this.platform.findUser(id);
        if (!user) {
            throw new NotFoundError("Account not found.");
        }
        return user;
    }

    /** Enables an account that waits for approval and tells its owner when mail is on. */
    public async approve(req: Request, id: number): Promise<void> {
        const user = await this.require(id);
        if (user.disabledReason !== "pending_approval") {
            throw new ConflictError("This account isn't waiting for approval.");
        }
        await this.platform.setUserDisabled(id, false, null);
        await this.audit.record(req, "user.approve", {entityType: "user", entityId: id, entityLabel: user.code});
        const mail = appService.getMailService();
        if (mail.isEnabled() && user.emailVerified) {
            void mail.send(user.email, "Your Vaultisse account was approved", `Hello ${user.name},\n\nYour account was approved. You can log in now:\n${mail.link("/login")}\n`);
        }
    }

    /** Locks an account out and ends its sessions. */
    public async disable(req: Request, id: number, reason?: string): Promise<void> {
        const user = await this.require(id);
        if (user.disabledReason === "pending_deletion") {
            throw new ConflictError("A deletion is scheduled for this account; cancel it under Deletions first.");
        }
        await this.platform.setUserDisabled(id, true, "admin");
        await this.audit.record(req, "user.disable", {entityType: "user", entityId: id, entityLabel: user.code, metadata: {reason: reason?.slice(0, 200)}});
    }

    /** Lifts a lock set by an admin. */
    public async enable(req: Request, id: number): Promise<void> {
        const user = await this.require(id);
        if (user.disabledReason === "pending_deletion") {
            throw new ConflictError("A deletion is scheduled for this account; cancel it under Deletions instead.");
        }
        if (user.disabledReason === "pending_approval") {
            throw new ConflictError("This account is waiting for approval; use Approve.");
        }
        await this.platform.setUserDisabled(id, false, null);
        await this.audit.record(req, "user.enable", {entityType: "user", entityId: id, entityLabel: user.code});
    }

    /** Ends every session of an account. */
    public async forceLogout(req: Request, id: number): Promise<void> {
        const user = await this.require(id);
        await this.platform.forceLogout(id);
        await this.audit.record(req, "user.force_logout", {entityType: "user", entityId: id, entityLabel: user.code});
    }

    /** Locks an account and schedules its deletion after the grace period. */
    public async scheduleDeletion(req: Request, id: number): Promise<void> {
        const user = await this.require(id);
        const result = await this.deletions.requestUserDeletion(req.admin!.id, id, false);
        await this.audit.record(req, result.executed ? "user.delete" : "user.schedule_delete", {
            entityType: "user", entityId: id, entityLabel: user.code, metadata: {executeAfter: result.executeAfter, deletionId: result.deletionId, bulk: true},
        });
    }

    /**
     * Applies one action to one account and reports the outcome instead of throwing, so a bulk run can carry on.
     * @param req The request (admin and address for the audit trail).
     * @param action What to do.
     * @param id Account id.
     * @param reason Optional reason, kept in the audit entry of a disable.
     */
    public async apply(req: Request, action: AccountAction, id: number, reason?: string): Promise<ActionResult> {
        const found = await this.platform.findUser(id);
        const code = found?.code ?? null;
        try {
            if (action === "approve") await this.approve(req, id);
            else if (action === "disable") await this.disable(req, id, reason);
            else if (action === "enable") await this.enable(req, id);
            else if (action === "force-logout") await this.forceLogout(req, id);
            else await this.scheduleDeletion(req, id);
            return {id, code, ok: true, message: "Done"};
        } catch (error) {
            if (error instanceof DomainError) {
                return {id, code, ok: false, message: error.message};
            }
            throw error;
        }
    }

    /**
     * @param status Account status filter, e.g. "pending".
     * @param limit Safety cap.
     * @returns The ids of every account with that status.
     */
    public async idsWithStatus(status: "pending" | "disabled" | "unverified" | "active", limit: number): Promise<number[]> {
        const {rows} = await this.platform.listUsers({status}, "created", limit, 0);
        return rows.map((row) => row.id);
    }
}
