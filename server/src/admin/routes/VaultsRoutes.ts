/**
 * Vault (library) management and plans (mounted at `/api/admin`).
 *
 * Like the accounts, vaults are only ever shown as metadata - name, members, counts, size - never their content.
 *
 *  GET    /vaults             ?search=&status=active|suspended|pending_deletion&page=&pageSize=
 *  GET    /vaults/:id         vault, members, usage and the plan in force
 *  POST   /vaults/:id/suspend / unsuspend
 *  PUT    /vaults/:id/plan    `{planId: number | null}`
 *  DELETE /vaults/:id         `{confirm: "<vault name>", immediate?}` [fresh verification]
 *
 *  GET/POST /plans, PUT/DELETE /plans/:id, PUT /plans/default `{planId | null}`
 */
import {Router} from "express";
import {Pool} from "pg";
import {ConflictError, NotFoundError, ValidationError} from "../../errors/DomainError";
import {handle, idParam, paging, text} from "../http";
import {requireFreshAuth, requireSuperadmin} from "../middleware";
import {PlanRepository} from "../repositories/PlanRepository";
import {PlatformRepository} from "../repositories/PlatformRepository";
import {AdminAuditService} from "../services/AdminAuditService";
import {DeletionService} from "../services/DeletionService";
import {QuotaService} from "../services/QuotaService";

/** A limit is either absent (unlimited) or a non-negative whole number. */
function limit(value: unknown, label: string, min: number): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const number = Number(value);
    if (!Number.isInteger(number) || number < min) {
        throw new ValidationError(`${label} must be a whole number of at least ${min}, or empty for unlimited.`);
    }
    return number;
}

/**
 * @param pool Database pool.
 * @param audit Admin audit trail.
 * @param deletions Deletion service.
 * @returns The router.
 */
export function vaultsRoutes(pool: Pool, audit: AdminAuditService, deletions: DeletionService): Router {
    const router = Router();
    const platform = new PlatformRepository(pool);
    const plans = new PlanRepository(pool);

    const requireVault = async (id: number) => {
        const vault = await platform.findVault(id);
        if (!vault) {
            throw new NotFoundError("Vault not found.");
        }
        return vault;
    };

    router.get("/vaults", handle(async (req, res) => {
        const {page, pageSize, limit: take, offset} = paging(req);
        const status = text(req.query.status);
        if (status && status !== "active" && status !== "suspended" && status !== "pending_deletion") {
            throw new ValidationError("Unknown status.");
        }
        const {rows, total} = await platform.listVaults({search: text(req.query.search), status: status as "active" | "suspended" | "pending_deletion" | undefined}, take, offset);
        res.json({items: rows, total, page, pageSize});
    }));

    router.get("/vaults/:id", handle(async (req, res) => {
        const id = idParam(req);
        const vault = await requireVault(id);
        const [members, usage, plan] = await Promise.all([
            platform.vaultMembers(id),
            QuotaService.usage(pool, id),
            plans.effectiveForVault(id),
        ]);
        res.json({vault, members, usage, plan});
    }));

    router.post("/vaults/:id/suspend", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const vault = await requireVault(id);
        if (vault.suspendedReason === "pending_deletion") {
            throw new ConflictError("A deletion is scheduled for this vault; cancel it under Deletions first.");
        }
        await platform.setVaultSuspended(id, true, "admin");
        await audit.record(req, "vault.suspend", {entityType: "vault", entityId: id, entityLabel: vault.name, metadata: {reason: text(req.body?.reason)?.slice(0, 200)}});
        res.json({vault: await platform.findVault(id)});
    }));

    router.post("/vaults/:id/unsuspend", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const vault = await requireVault(id);
        if (vault.suspendedReason === "pending_deletion") {
            throw new ConflictError("A deletion is scheduled for this vault; cancel it under Deletions instead.");
        }
        await platform.setVaultSuspended(id, false, null);
        await audit.record(req, "vault.unsuspend", {entityType: "vault", entityId: id, entityLabel: vault.name});
        res.json({vault: await platform.findVault(id)});
    }));

    router.put("/vaults/:id/plan", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const vault = await requireVault(id);
        const planId = req.body?.planId === null || req.body?.planId === undefined ? null : Number(req.body.planId);
        if (planId !== null && (!Number.isInteger(planId) || !(await plans.find(planId)))) {
            throw new NotFoundError("Plan not found.");
        }
        await platform.setVaultPlan(id, planId);
        await audit.record(req, "vault.set_plan", {entityType: "vault", entityId: id, entityLabel: vault.name, metadata: {planId}});
        res.json({vault: await platform.findVault(id)});
    }));

    router.delete("/vaults/:id", requireSuperadmin, requireFreshAuth, handle(async (req, res) => {
        const id = idParam(req);
        const vault = await requireVault(id);
        if (req.body?.confirm !== vault.name) {
            throw new ValidationError(`Type the vault's name (${vault.name}) to confirm.`);
        }
        const result = await deletions.requestVaultDeletion(req.admin!.id, id, req.body?.immediate === true);
        await audit.record(req, result.executed ? "vault.delete" : "vault.schedule_delete", {
            entityType: "vault", entityId: id, entityLabel: vault.name, metadata: {executeAfter: result.executeAfter, deletionId: result.deletionId},
        });
        res.json(result);
    }));

    router.get("/plans", handle(async (_req, res) => {
        res.json({items: await plans.list()});
    }));

    const planFields = (body: any) => {
        const name = text(body?.name);
        if (!name || name.length > 60) {
            throw new ValidationError("Enter a plan name (up to 60 characters).");
        }
        return {
            name,
            maxBooks: limit(body?.maxBooks, "Book limit", 0),
            maxMembers: limit(body?.maxMembers, "Member limit", 1),
            maxStorageMb: limit(body?.maxStorageMb, "Storage limit", 0),
        };
    };

    router.post("/plans", requireSuperadmin, handle(async (req, res) => {
        const code = text(req.body?.code)?.toLowerCase();
        if (!code || !/^[a-z0-9_-]{1,30}$/.test(code)) {
            throw new ValidationError("The code is 1-30 letters, digits, - or _.");
        }
        const fields = planFields(req.body);
        let id: number;
        try {
            id = await plans.create({code, ...fields});
        } catch (error: any) {
            if (error?.code === "23505") {
                throw new ConflictError("A plan with that code already exists.");
            }
            throw error;
        }
        await audit.record(req, "plan.create", {entityType: "plan", entityId: id, entityLabel: fields.name});
        res.status(201).json({plan: await plans.find(id)});
    }));

    // Registered before "/plans/:id" so "default" isn't read as an id.
    router.put("/plans/default", requireSuperadmin, handle(async (req, res) => {
        const planId = req.body?.planId === null || req.body?.planId === undefined ? null : Number(req.body.planId);
        if (planId !== null && (!Number.isInteger(planId) || !(await plans.find(planId)))) {
            throw new NotFoundError("Plan not found.");
        }
        await plans.setDefault(planId);
        await audit.record(req, "plan.set_default", {entityType: "plan", entityId: planId ?? undefined});
        res.json({items: await plans.list()});
    }));

    router.put("/plans/:id", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const plan = await plans.find(id);
        if (!plan) {
            throw new NotFoundError("Plan not found.");
        }
        await plans.update(id, planFields(req.body));
        await audit.record(req, "plan.update", {entityType: "plan", entityId: id, entityLabel: plan.name});
        res.json({plan: await plans.find(id)});
    }));

    router.delete("/plans/:id", requireSuperadmin, handle(async (req, res) => {
        const id = idParam(req);
        const plan = await plans.find(id);
        if (!plan) {
            throw new NotFoundError("Plan not found.");
        }
        await plans.remove(id);
        await audit.record(req, "plan.delete", {entityType: "plan", entityId: id, entityLabel: plan.name, metadata: {vaultsAffected: plan.vaultCount}});
        res.json({message: "Plan deleted. Its vaults now use the default plan."});
    }));

    return router;
}
