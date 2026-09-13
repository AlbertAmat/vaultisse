import {PATH_PREFIX} from "@/Constants";
import axiosInstance from "@/plugins/axiosInstance";
import ILocationExt from "@/types/location/ILocationExt";
import ILocationBook from "@/types/location/ILocationBook";

/**
 * Thin HTTP client for the `/api/rest/location` endpoints (see server/src/routes/LocationRoute.ts):
 * location CRUD and moving book stocks between locations.
 *
 * @example
 * const locations = await locationsService.getLocations();
 * await locationsService.addBooks(locations[0].id, ["a1b2c3d4e5"]);
 */
class LocationsService {

    /** @returns Every location, with each one's total book count. */
    public async getLocations(): Promise<ILocationExt[]> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/location`)
        return data;
    }

    /**
     * List the books currently stocked at a location.
     * @param id Location id.
     * @returns The books stocked at that location.
     */
    public async getLocationBooks(id: number): Promise<ILocationBook[]> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/location/${id}/books`)
        return data;
    }

    /**
     * Rename/update a location's description.
     * @param id Location id to update.
     * @param name New location name.
     * @param description New location description, or null to clear it.
     */
    public async updateLocation(id: number, name: string, description: string | null) {
        await axiosInstance.put(`${PATH_PREFIX}/location/${id}`, {
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
        const {data} = await axiosInstance.post(`${PATH_PREFIX}/location`, {
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
        await axiosInstance.delete(`${PATH_PREFIX}/location/${locationId}`)
    }

    /**
     * Mark a location as the user's default one, clearing the flag from
     * whichever location previously had it.
     * @param locationId Location id to mark as default.
     * @returns Every location the user owns, reflecting the new default.
     */
    public async setDefaultLocation(locationId: number): Promise<ILocationExt[]> {
        const {data} = await axiosInstance.put(`${PATH_PREFIX}/location/${locationId}/default`)
        return data;
    }

    /**
     * Move a batch of book stocks into this location.
     * @param locationId Destination location id.
     * @param books Array of book stock codes.
     * @returns The updated list of books now at this location.
     */
    public async addBooks(locationId: number, books: string[]): Promise<ILocationBook[]> {
        const {data} = await axiosInstance.post(`${PATH_PREFIX}/location/${locationId}/add/books`, {books: books});
        return data;
    }
}

/** Singleton instance shared by every part of the app. */
export const locationsService = new LocationsService();
