import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {CategoryService} from "../services/CategoryService";
import {DomainError} from "../errors/DomainError";

/** Thin HTTP<->service glue for the Category resource. Constructed once per process (see CategoriesRoute.ts) and reused across requests. */
export class CategoryController {
    /**
     * @param pool Database connection pool, forwarded to a fresh CategoryService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * GET /category - lists the caller's categories.
     * @param req Express request.
     * @param res Express response.
     */
    public async list(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            const categories = await new CategoryService(this.pool).listCategories(vaultId);
            res.status(200).json(categories);
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * POST /category - creates a new category from `req.body.name`.
     * @param req Express request.
     * @param res Express response.
     */
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            appService.getLogger().debug(`Adding category with name ${req.body.name}`);
            const category = await new CategoryService(this.pool).createCategory(vaultId, req.body.name);
            res.status(200).json(category);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error adding category");
        }
    }

    /**
     * PUT /category/:id - renames a category to `req.body.name`.
     * @param req Express request.
     * @param res Express response.
     */
    public async rename(req: Request, res: Response): Promise<void> {
        const categoryId = req.params.id;
        if (!categoryId) {
            res.status(400).send('No category ID provided');
            return;
        }

        try {
            const vaultId = appService.getSessionVault(req);
            appService.getLogger().debug(`Updating category ${categoryId}`);
            const category = await new CategoryService(this.pool).renameCategory(Number(categoryId), vaultId, req.body.name);
            res.status(200).json(category);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error updating the category");
        }
    }

    /**
     * DELETE /category/:id - deletes a category.
     * @param req Express request.
     * @param res Express response.
     */
    public async remove(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        appService.getLogger().debug(`Delete category, id: ${id}`);

        try {
            const vaultId = appService.getSessionVault(req);
            await new CategoryService(this.pool).deleteCategory(id, vaultId);
            res.send({message: "Category deleted successfully"});
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while deleting category", e);
            res.status(500).send('Internal Server Error');
        }
    }
}
