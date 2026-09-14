import {Pool} from "pg";
import {LocationRepository} from "../repositories/LocationRepository";
import {withTransaction} from "../repositories/withTransaction";
import {Location, LocationBook} from "../types/location";
import {NotFoundError} from "../errors/DomainError";

/** Business rules for the Location resource. Calls LocationRepository; throws DomainError subclasses for expected failures. */
export class LocationService {
    /**
     * @param pool Database connection pool, forwarded to a fresh LocationRepository on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Lists the caller's locations.
     * @param userId Owning user's id.
     * @returns Every location belonging to `userId`.
     */
    public async listLocations(userId: number): Promise<Location[]> {
        return new LocationRepository(this.pool).findAll(userId);
    }

    /**
     * Lists the books stored at one location. No existence/ownership check - matches the original route (an unknown/foreign id just returns an empty list).
     * @param locationId Location id.
     * @param userId Owning user's id.
     * @returns Every book stock at that location.
     */
    public async getLocationBooks(locationId: number, userId: number): Promise<LocationBook[]> {
        return new LocationRepository(this.pool).getBooks(locationId, userId);
    }

    /**
     * Moves a batch of book_stocks (by code) into `locationId`. Originally a
     * plain loop of un-transacted UPDATEs - a crash partway through could leave
     * some stocks moved and others not. Now wrapped in one transaction so it's
     * all-or-nothing.
     *
     * @param locationId Destination location id.
     * @param userId Owning user's id.
     * @param stockCodes Book stock codes to move.
     * @returns The destination location's books after the move.
     */
    public async moveBooksToLocation(locationId: number, userId: number, stockCodes: string[]): Promise<LocationBook[]> {
        const repo = new LocationRepository(this.pool);
        const exist = await repo.exists(locationId, userId);
        if (!exist) {
            throw new NotFoundError("Location does not exist");
        }

        await withTransaction(this.pool, async (client) => {
            const txRepo = new LocationRepository(client);
            for (const stockCode of stockCodes) {
                await txRepo.moveBookStock(locationId, userId, stockCode);
            }
        });

        return repo.getBooks(locationId, userId);
    }

    /**
     * Creates a location and returns the freshly-created row.
     * @param userId Owning user's id.
     * @param name Location name.
     * @param description Location description.
     * @returns The newly-created location.
     */
    public async createLocation(userId: number, name: string, description: string): Promise<Location> {
        const repo = new LocationRepository(this.pool);
        const id = await repo.create(userId, name, description);
        const location = await repo.findById(id, userId);
        if (!location) {
            throw new NotFoundError("Location not found after creation");
        }
        return location;
    }

    /**
     * Renames/redescribes a location.
     *
     * Preserves the original route's existing behavior: an update that matches
     * zero rows (nonexistent id / another user's location) is a plain 500, not
     * a 404 - same reasoning as CategoryService.renameCategory /
     * AuthorService.renameAuthor. Throws a plain Error, not a DomainError.
     *
     * @param id Location id.
     * @param userId Owning user's id.
     * @param name New name.
     * @param description New description.
     * @returns The renamed location.
     */
    public async renameLocation(id: string, userId: number, name: string, description: string): Promise<Location> {
        const repo = new LocationRepository(this.pool);
        const rowsAffected = await repo.rename(id, userId, name, description);
        if (rowsAffected !== 1) {
            throw new Error("Location rename affected an unexpected number of rows");
        }
        const location = await repo.findById(id, userId);
        if (!location) {
            throw new Error("Location not found after rename");
        }
        return location;
    }

    /**
     * Unsets whichever location previously had `default`, then sets it on
     * `locationId` - wrapped in the shared withTransaction helper (extracted
     * from this exact hand-rolled BEGIN/COMMIT/ROLLBACK, the first real caller).
     *
     * @param locationId Location id to make the new default.
     * @param userId Owning user's id.
     * @returns Every location belonging to `userId`, after the change.
     */
    public async setDefaultLocation(locationId: number, userId: number): Promise<Location[]> {
        const repo = new LocationRepository(this.pool);
        const exist = await repo.exists(locationId, userId);
        if (!exist) {
            throw new NotFoundError("Location does not exist");
        }

        await withTransaction(this.pool, async (client) => {
            const txRepo = new LocationRepository(client);
            await txRepo.clearDefault(userId);
            await txRepo.setDefault(locationId, userId);
        });

        return repo.findAll(userId);
    }

    /**
     * Deletes a location, throwing NotFoundError if it doesn't belong to the caller.
     * @param id Location id.
     * @param userId Owning user's id.
     */
    public async deleteLocation(id: number, userId: number): Promise<void> {
        const repo = new LocationRepository(this.pool);
        const found = await repo.exists(id, userId);
        if (!found) {
            throw new NotFoundError("Location not found");
        }
        await repo.remove(id, userId);
    }
}
