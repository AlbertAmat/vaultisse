import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {VaultService} from "../services/VaultService";
import {DomainError} from "../errors/DomainError";
import {VaultUserStatus} from "../types/vault";

/** Thin HTTP<->service glue for the Vault resource. Constructed once per process (see VaultRoute.ts) and reused across requests. */
export class VaultController {
    /**
     * @param pool Database connection pool, forwarded to a fresh VaultService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * GET /vault - lists the caller's accepted vaults.
     * @param req Express request.
     * @param res Express response.
     */
    public async vaults(req: Request, res: Response): Promise<void> {
        try {
            const userId = appService.getSessionUser(req);
            const vaults = await new VaultService(this.pool).listVaults(userId);
            res.status(200).json(vaults);
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * GET /vault/roles - lists the fixed role definitions, for a role picker.
     * @param req Express request.
     * @param res Express response.
     */
    public async roles(req: Request, res: Response): Promise<void> {
        try {
            const roles = await new VaultService(this.pool).listRoles();
            res.status(200).json(roles);
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * GET /vault/:id - gets one vault's full detail (settings + members + role definitions).
     * @param req Express request.
     * @param res Express response.
     */
    public async get(req: Request, res: Response): Promise<void> {
        const vaultId = Number(req.params.id);
        if (!Number.isInteger(vaultId)) {
            res.status(400).json({error: 'Invalid vault ID'});
            return;
        }

        try {
            const userId = appService.getSessionUser(req);
            const vault = await new VaultService(this.pool).getVault(vaultId, userId);
            res.status(200).json(vault);
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while fetching vault", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * POST /vault - creates a new vault from `req.body.name`/`req.body.description`, with the caller as its admin.
     * @param req Express request.
     * @param res Express response.
     */
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const userId = appService.getSessionUser(req);
            appService.getLogger().debug(`Adding vault with name ${req.body.name}`);
            const vault = await new VaultService(this.pool).createVault(userId, req.body.name, req.body.description);
            res.status(200).json(vault);
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while creating vault", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * PUT /vault/:id - updates a vault's name/description/leasing preference.
     * @param req Express request.
     * @param res Express response.
     */
    public async update(req: Request, res: Response): Promise<void> {
        const vaultId = Number(req.params.id);
        if (!Number.isInteger(vaultId)) {
            res.status(400).json({error: 'Invalid vault ID'});
            return;
        }

        try {
            const userId = appService.getSessionUser(req);
            const vault = await new VaultService(this.pool).updateVault(vaultId, userId, req.body.name, req.body.description, !!req.body.leasingEnabled);
            res.status(200).json(vault);
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while updating vault", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * DELETE /vault/:id - deletes a vault. If it still owns any content, `req.body.transferToVaultId`
     * must name another vault the caller belongs to for that content to be moved into first.
     * @param req Express request.
     * @param res Express response.
     */
    public async remove(req: Request, res: Response): Promise<void> {
        const vaultId = Number(req.params.id);
        if (!Number.isInteger(vaultId)) {
            res.status(400).json({error: 'Invalid vault ID'});
            return;
        }

        const transferToVaultId = req.body?.transferToVaultId !== undefined ? Number(req.body.transferToVaultId) : undefined;
        if (transferToVaultId !== undefined && !Number.isInteger(transferToVaultId)) {
            res.status(400).json({error: 'Invalid destination vault ID'});
            return;
        }

        try {
            const userId = appService.getSessionUser(req);
            await new VaultService(this.pool).deleteVault(vaultId, userId, transferToVaultId);
            res.send({message: "Vault deleted successfully"});
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while deleting vault", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * GET /vault/invite/:uuid - previews a vault reachable by its invitation link, before joining.
     * @param req Express request.
     * @param res Express response.
     */
    public async previewInvite(req: Request, res: Response): Promise<void> {
        try {
            const vault = await new VaultService(this.pool).previewInvite(req.params.uuid);
            res.status(200).json(vault);
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while previewing invite", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * POST /vault/join/:uuid - requests to join a vault via its invitation link.
     * @param req Express request.
     * @param res Express response.
     */
    public async join(req: Request, res: Response): Promise<void> {
        try {
            const userId = appService.getSessionUser(req);
            const vault = await new VaultService(this.pool).joinVault(req.params.uuid, userId);
            res.status(200).json(vault);
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while joining vault", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * GET /vault/:id/members - lists a vault's members.
     * @param req Express request.
     * @param res Express response.
     */
    public async members(req: Request, res: Response): Promise<void> {
        const vaultId = Number(req.params.id);
        if (!Number.isInteger(vaultId)) {
            res.status(400).json({error: 'Invalid vault ID'});
            return;
        }

        try {
            const userId = appService.getSessionUser(req);
            const members = await new VaultService(this.pool).listMembers(vaultId, userId);
            res.status(200).json(members);
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while listing vault members", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * PUT /vault/:id/members/:userId - updates a member's role and/or approval status.
     * @param req Express request.
     * @param res Express response.
     */
    public async updateMember(req: Request, res: Response): Promise<void> {
        const vaultId = Number(req.params.id);
        const targetUserId = Number(req.params.userId);
        if (!Number.isInteger(vaultId) || !Number.isInteger(targetUserId)) {
            res.status(400).json({error: 'Invalid vault or user ID'});
            return;
        }

        const {role, status} = req.body;
        if (role === undefined && status === undefined) {
            res.status(400).json({error: 'Nothing to update'});
            return;
        }
        if (status !== undefined && !Object.values(VaultUserStatus).includes(status)) {
            res.status(400).json({error: 'Invalid status'});
            return;
        }

        try {
            const callerId = appService.getSessionUser(req);
            await new VaultService(this.pool).updateMember(vaultId, callerId, targetUserId, {role, status});
            res.status(200).json({message: "Member updated successfully"});
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while updating vault member", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * DELETE /vault/:id/members/:userId - removes a member from a vault (or leaves it, if it's the caller's own id).
     * @param req Express request.
     * @param res Express response.
     */
    public async removeMember(req: Request, res: Response): Promise<void> {
        const vaultId = Number(req.params.id);
        const targetUserId = Number(req.params.userId);
        if (!Number.isInteger(vaultId) || !Number.isInteger(targetUserId)) {
            res.status(400).json({error: 'Invalid vault or user ID'});
            return;
        }

        try {
            const callerId = appService.getSessionUser(req);
            await new VaultService(this.pool).removeMember(vaultId, callerId, targetUserId);
            res.send({message: "Member removed successfully"});
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while removing vault member", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * PUT /vault/:id/active - sets the vault the caller last worked in.
     * @param req Express request.
     * @param res Express response.
     */
    public async setActive(req: Request, res: Response): Promise<void> {
        const vaultId = Number(req.params.id);
        if (!Number.isInteger(vaultId)) {
            res.status(400).json({error: 'Invalid vault ID'});
            return;
        }

        try {
            const userId = appService.getSessionUser(req);
            await new VaultService(this.pool).setActiveVault(userId, vaultId);
            res.status(200).json({message: "Active vault updated successfully"});
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while setting active vault", e);
            res.status(500).send('Internal Server Error');
        }
    }
}
