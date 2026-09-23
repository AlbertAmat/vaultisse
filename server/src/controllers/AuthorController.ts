import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {AuthorService} from "../services/AuthorService";
import {DomainError} from "../errors/DomainError";

/** Thin HTTP<->service glue for the Author resource. Constructed once per process (see AuthorRoute.ts) and reused across requests. */
export class AuthorController {
    /**
     * @param pool Database connection pool, forwarded to a fresh AuthorService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * GET /author - lists the caller's authors.
     * @param req Express request.
     * @param res Express response.
     */
    public async list(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            const authors = await new AuthorService(this.pool).listAuthors(vaultId);
            res.status(200).json(authors);
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * POST /author/search - case-insensitive author search from `req.body.query`.
     * @param req Express request.
     * @param res Express response.
     */
    public async search(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            appService.getLogger().debug(`search authors with query ${req.body.query}`);
            const authors = await new AuthorService(this.pool).searchAuthors(vaultId, req.body.query);
            res.status(200).json(authors);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error searching the authors");
        }
    }

    /**
     * POST /author - creates a new author from `req.body.name`.
     * @param req Express request.
     * @param res Express response.
     */
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            appService.getLogger().debug(`Adding author with name ${req.body.name}`);
            const author = await new AuthorService(this.pool).createAuthor(vaultId, req.body.name);
            res.status(200).json(author);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error adding the author");
        }
    }

    /**
     * PUT /author/:id - renames an author to `req.body.name`.
     * @param req Express request.
     * @param res Express response.
     */
    public async rename(req: Request, res: Response): Promise<void> {
        const authorId = req.params.id;
        if (!authorId) {
            res.status(400).send('No author ID provided');
            return;
        }

        try {
            const vaultId = appService.getSessionVault(req);
            appService.getLogger().debug(`Updating author ${authorId}`);
            const author = await new AuthorService(this.pool).renameAuthor(authorId, vaultId, req.body.name);
            res.status(200).json(author);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error updating the author");
        }
    }

    /**
     * DELETE /author/:id - deletes an author.
     * @param req Express request.
     * @param res Express response.
     */
    public async remove(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        appService.getLogger().debug(`Delete author, id: ${id}`);

        try {
            const vaultId = appService.getSessionVault(req);
            await new AuthorService(this.pool).deleteAuthor(id, vaultId);
            res.send({message: "Author deleted successfully"});
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while deleting author", e);
            res.status(500).send('Internal Server Error');
        }
    }
}
