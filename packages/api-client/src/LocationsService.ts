import type {AxiosInstance} from "axios";
import ILocationExt from "@vaultisse/types/location/ILocationExt";
import ILocationBook from "@vaultisse/types/location/ILocationBook";

/**
 * Thin HTTP client for the `/api/rest/location` endpoints (see server/src/routes/LocationRoute.ts):
 * location CRUD and moving book stocks between locations.
 *
 * @example
 * const locations = await api.locations.getLocations();
 * await api.locations.addBooks(locations[0].id, ["a1b2c3d4e5"]);
 */
export class LocationsService {

    constructor(private readonly http: AxiosInstance) {}

    /** @returns Every location, with each one's total book count. */
    public async getLocations(): Promise<ILocationExt[]> {
        const {data} = await this.http.get(`/location`)
        return data;
    }

    /**
     * List the books currently stocked at a location.
     * @param id Location id.
     * @returns The books stocked at that location.
     */
    public async getLocationBooks(id: number): Promise<ILocationBook[]> {
        const {data} = await this.http.get(`/location/${id}/books`)
        return data;
    }

    /**
     * Rename/update a location's description.
     * @param id Location id to update.
     * @param name New location name.
     * @param description New location description, or null to clear it.
     */
    public async updateLocation(id: number, name: string, description: string | null) {
        await this.http.put(`/location/${id}`, {
            name: name,
            description: description
        })
    }

    /**
     * Create a new location.
     * @param name New location's name.
     * @param description New location's description, or null.
     * @returns The created location.
     */
    public async addLocation(name: string, description: string | null): Promise<ILocationExt> {
        const {data} = await this.http.post(`/location`, {
            name: name,
            description: description
        })

        return data;
    }

    /**
     * Delete a location.
     * @param locationId Location id to delete.
     */
    public async deleteLocation(locationId: number): Promise<void> {
        await this.http.delete(`/location/${locationId}`)
    }

    /**
     * Mark a location as the user's default one, clearing the flag from
     * whichever location previously had it.
     * @param locationId Location id to mark as default.
     * @returns Every location the user owns, reflecting the new default.
     */
    public async setDefaultLocation(locationId: number): Promise<ILocationExt[]> {
        const {data} = await this.http.put(`/location/${locationId}/default`)
        return data;
    }

    /**
     * Move a batch of book stocks into this location.
     * @param locationId Destination location id.
     * @param books Array of book stock codes.
     * @returns The updated list of books now at this location.
     */
    public async addBooks(locationId: number, books: string[]): Promise<ILocationBook[]> {
        const {data} = await this.http.post(`/location/${locationId}/add/books`, {books: books});
        return data;
    }
}
