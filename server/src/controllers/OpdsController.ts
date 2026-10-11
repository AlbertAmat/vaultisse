import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {DomainError} from "../errors/DomainError";
import {OpdsPrincipal, OpdsService} from "../services/OpdsService";

/** Thin HTTP<->service glue for the OPDS feed. Constructed once per process (see OpdsRoute.ts). */
export class OpdsController {
    /**
     * @param pool Database connection pool, forwarded to a fresh OpdsService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Resolves the `:token` URL param, answering 401 itself when it is unknown.
     * @param req Express request.
     * @param res Express response.
     * @returns The principal, or null when a response has already been sent.
     */
    private async authenticate(req: Request, res: Response): Promise<OpdsPrincipal | null> {
        const principal = await new OpdsService(this.pool).resolve(String(req.params.token));
        if (!principal) {
            res.status(401).send("Unauthorized");
            return null;
        }
        return principal;
    }

    /**
     * Sends an Atom/OpenSearch document.
     * @param res Express response.
     * @param type Content-Type.
     * @param body The XML.
     */
    private static sendXml(res: Response, type: string, body: string): void {
        res.status(200).type(type).send(body);
    }

    /**
     * GET /opds/:token - root navigation feed.
     * @param req Express request.
     * @param res Express response.
     */
    public async root(req: Request, res: Response): Promise<void> {
        try {
            if (!await this.authenticate(req, res)) {
                return;
            }
            OpdsController.sendXml(res, "application/atom+xml;profile=opds-catalog;kind=navigation", new OpdsService(this.pool).rootFeed(`/opds/${req.params.token}`));
        } catch (error) {
            console.error("Error serving OPDS root:", error);
            res.status(500).send("Error serving OPDS feed");
        }
    }

    /**
     * GET /opds/:token/opensearch.xml - OpenSearch description.
     * @param req Express request.
     * @param res Express response.
     */
    public async openSearch(req: Request, res: Response): Promise<void> {
        try {
            if (!await this.authenticate(req, res)) {
                return;
            }
            OpdsController.sendXml(res, "application/opensearchdescription+xml", new OpdsService(this.pool).openSearch(`/opds/${req.params.token}`));
        } catch (error) {
            console.error("Error serving OPDS search description:", error);
            res.status(500).send("Error serving OPDS feed");
        }
    }

    /**
     * GET /opds/:token/all?q=&page= - paged acquisition feed.
     * @param req Express request.
     * @param res Express response.
     */
    public async all(req: Request, res: Response): Promise<void> {
        try {
            const principal = await this.authenticate(req, res);
            if (!principal) {
                return;
            }
            const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
            const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
            const xml = await new OpdsService(this.pool).booksFeed(`/opds/${req.params.token}`, principal.vaultId, q || null, page);
            OpdsController.sendXml(res, "application/atom+xml;profile=opds-catalog;kind=acquisition", xml);
        } catch (error) {
            console.error("Error serving OPDS books:", error);
            res.status(500).send("Error serving OPDS feed");
        }
    }

    /**
     * GET /opds/:token/v2 - OPDS 2.0 (JSON) root feed.
     * @param req Express request.
     * @param res Express response.
     */
    public async rootV2(req: Request, res: Response): Promise<void> {
        try {
            if (!await this.authenticate(req, res)) {
                return;
            }
            res.status(200).type("application/opds+json").send(JSON.stringify(new OpdsService(this.pool).rootFeedV2(`/opds/${req.params.token}`)));
        } catch (error) {
            console.error("Error serving OPDS 2.0 root:", error);
            res.status(500).send("Error serving OPDS feed");
        }
    }

    /**
     * GET /opds/:token/v2/all?q=&page= - OPDS 2.0 (JSON) paged books feed.
     * @param req Express request.
     * @param res Express response.
     */
    public async allV2(req: Request, res: Response): Promise<void> {
        try {
            const principal = await this.authenticate(req, res);
            if (!principal) {
                return;
            }
            const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
            const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
            const feed = await new OpdsService(this.pool).booksFeedV2(`/opds/${req.params.token}`, principal.vaultId, q || null, page);
            res.status(200).type("application/opds+json").send(JSON.stringify(feed));
        } catch (error) {
            console.error("Error serving OPDS 2.0 books:", error);
            res.status(500).send("Error serving OPDS feed");
        }
    }

    /**
     * GET /opds/:token/book/:id/file/:fileId - downloads an ebook file.
     * @param req Express request.
     * @param res Express response.
     */
    public async download(req: Request, res: Response): Promise<void> {
        try {
            const principal = await this.authenticate(req, res);
            if (!principal) {
                return;
            }
            const {file_data, file_name, file_type} = await new OpdsService(this.pool)
                .getFile(Number(req.params.id), Number(req.params.fileId), principal.vaultId);
            res.setHeader("Content-Type", OpdsService.mimeFor(file_type));
            const asciiName = file_name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
            res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file_name)}`);
            res.status(200).send(file_data);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error("Error downloading OPDS file:", error);
            res.status(500).send("Error downloading book file");
        }
    }

    /**
     * GET /user/opds - whether the caller has a feed token.
     * @param req Express request.
     * @param res Express response.
     */
    public async status(req: Request, res: Response): Promise<void> {
        try {
            res.status(200).json({enabled: await new OpdsService(this.pool).hasToken(appService.getSessionUser(req))});
        } catch (error) {
            console.error("Error reading OPDS status:", error);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * POST /user/opds - issues (or rotates) the caller's feed token.
     * @param req Express request.
     * @param res Express response.
     */
    public async createToken(req: Request, res: Response): Promise<void> {
        try {
            const token = await new OpdsService(this.pool).createToken(appService.getSessionUser(req));
            res.status(200).json({token, path: `/opds/${token}`});
        } catch (error) {
            console.error("Error creating OPDS token:", error);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * DELETE /user/opds - disables the caller's feed.
     * @param req Express request.
     * @param res Express response.
     */
    public async revokeToken(req: Request, res: Response): Promise<void> {
        try {
            await new OpdsService(this.pool).revokeToken(appService.getSessionUser(req));
            res.status(200).json({enabled: false});
        } catch (error) {
            console.error("Error revoking OPDS token:", error);
            res.status(500).send("Internal Server Error");
        }
    }
}
