import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {CustomerCardService} from "../services/CustomerCardService";
import {DomainError} from "../errors/DomainError";

/** Thin HTTP<->service glue for library cards. Constructed once per process (see CustomerRoute.ts). */
export class CustomerCardController {
    /**
     * @param pool Database connection pool, forwarded to a fresh CustomerCardService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Runs one action and writes its result, mapping DomainErrors to their status.
     * @param res Express response.
     * @param action Work producing the response body.
     */
    private async respond(res: Response, action: (service: CustomerCardService) => Promise<unknown>): Promise<void> {
        try {
            res.status(200).json(await action(new CustomerCardService(this.pool)));
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error("Library card error:", error);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * GET /customer/card/settings.
     * @param req Express request.
     * @param res Express response.
     */
    public async getSettings(req: Request, res: Response): Promise<void> {
        await this.respond(res, (service) => service.getSettings(appService.getSessionVault(req)));
    }

    /**
     * PUT /customer/card/settings.
     * @param req Express request.
     * @param res Express response.
     */
    public async saveSettings(req: Request, res: Response): Promise<void> {
        await this.respond(res, (service) => service.saveSettings(
            appService.getSessionVault(req), req.body ?? {}, req.file?.buffer, req.body?.remove_background === "true"));
    }

    /**
     * GET /customer/card/scan/:code.
     * @param req Express request.
     * @param res Express response.
     */
    public async scan(req: Request, res: Response): Promise<void> {
        await this.respond(res, (service) => service.scan(appService.getSessionVault(req), String(req.params.code)));
    }

    /**
     * GET /customer/:id/card.
     * @param req Express request.
     * @param res Express response.
     */
    public async getCard(req: Request, res: Response): Promise<void> {
        await this.respond(res, (service) => service.getCard(appService.getSessionVault(req), Number(req.params.id) || 0));
    }

    /**
     * PUT /customer/:id/card.
     * @param req Express request.
     * @param res Express response.
     */
    public async updateCard(req: Request, res: Response): Promise<void> {
        await this.respond(res, (service) => service.updateCard(
            appService.getSessionVault(req), Number(req.params.id) || 0, req.body?.member_since, req.file?.buffer, req.body?.remove_photo === "true"));
    }

    /**
     * POST /customer/:id/card/loan.
     * @param req Express request.
     * @param res Express response.
     */
    public async lend(req: Request, res: Response): Promise<void> {
        await this.respond(res, (service) => service.lend(appService.getSessionVault(req), Number(req.params.id) || 0, req.body?.code));
    }
}
