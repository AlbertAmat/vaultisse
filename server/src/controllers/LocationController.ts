import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {LocationService} from "../services/LocationService";
import {DomainError} from "../errors/DomainError";

/** Thin HTTP<->service glue for the Location resource. Constructed once per process (see LocationRoute.ts) and reused across requests. */
export class LocationController {
    /**
     * @param pool Database connection pool, forwarded to a fresh LocationService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * GET /location - lists the caller's locations.
     * @param req Express request.
     * @param res Express response.
     */
    public async list(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            const locations = await new LocationService(this.pool).listLocations(vaultId);
            res.status(200).json(locations);
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * GET /location/:id/books - lists the books stored at a location.
     * @param req Express request.
     * @param res Express response.
     */
    public async getBooks(req: Request, res: Response): Promise<void> {
        const locationId = Number(req.params.id);
        if (!locationId) {
            res.status(400).send('No location ID provided');
            return;
        }

        try {
            const vaultId = appService.getSessionVault(req);
            const locationBooks = await new LocationService(this.pool).getLocationBooks(locationId, vaultId);
            res.status(200).json(locationBooks);
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * POST /location/:id/add/books - moves a batch of book stocks (by code) into a location.
     * @param req Express request.
     * @param res Express response.
     */
    public async addBooks(req: Request, res: Response): Promise<void> {
        const locationId = Number(req.params.id);
        const books: string[] = req.body.books;

        if (!locationId) {
            res.status(400).send('No location ID provided');
            return;
        }
        if (!Array.isArray(books) || books.length === 0) {
            res.status(400).send('No books provided');
            return;
        }

        try {
            const vaultId = appService.getSessionVault(req);
            const locationBooks = await new LocationService(this.pool).moveBooksToLocation(locationId, vaultId, books);
            res.status(200).json(locationBooks);
        } catch (err) {
            if (err instanceof DomainError) {
                res.status(err.httpStatus).send(err.message);
                return;
            }
            console.error('Error adding books to a location', err);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * POST /location - creates a new location from `req.body.name`/`req.body.description`.
     * @param req Express request.
     * @param res Express response.
     */
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const vaultId = appService.getSessionVault(req);
            appService.getLogger().debug(`Adding location with name ${req.body.name}`);
            const location = await new LocationService(this.pool).createLocation(vaultId, req.body.name, req.body.description);
            res.status(200).json(location);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error adding the location");
        }
    }

    /**
     * PUT /location/:id - renames/redescribes a location.
     * @param req Express request.
     * @param res Express response.
     */
    public async rename(req: Request, res: Response): Promise<void> {
        const locationId = req.params.id;
        if (!locationId) {
            res.status(400).send('No location ID provided');
            return;
        }

        try {
            const vaultId = appService.getSessionVault(req);
            appService.getLogger().debug(`Updating location ${locationId}`);
            const location = await new LocationService(this.pool).renameLocation(locationId, vaultId, req.body.name, req.body.description);
            res.status(200).json(location);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error updating the location");
        }
    }

    /**
     * PUT /location/:id/default - sets a location as the caller's default.
     * @param req Express request.
     * @param res Express response.
     */
    public async setDefault(req: Request, res: Response): Promise<void> {
        const locationId = Number(req.params.id);
        if (!locationId) {
            res.status(400).send('No location ID provided');
            return;
        }

        try {
            const vaultId = appService.getSessionVault(req);
            appService.getLogger().debug(`Setting location ${locationId} as default`);
            const locations = await new LocationService(this.pool).setDefaultLocation(locationId, vaultId);
            res.status(200).json(locations);
        } catch (err) {
            if (err instanceof DomainError) {
                res.status(err.httpStatus).send(err.message);
                return;
            }
            console.error("Transaction error:", err);
            res.status(500).send("Error setting the default location");
        }
    }

    /**
     * DELETE /location/:id - deletes a location.
     * @param req Express request.
     * @param res Express response.
     */
    public async remove(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);

        try {
            const vaultId = appService.getSessionVault(req);
            await new LocationService(this.pool).deleteLocation(id, vaultId);
            res.send({message: "Location deleted successfully"});
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while deleting location", e);
            res.status(500).send('Internal Server Error');
        }
    }
}
