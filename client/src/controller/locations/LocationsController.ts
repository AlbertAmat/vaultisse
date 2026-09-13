/** Backs the locations management view: loads all locations and exposes add/delete operations. */
import {BaseController} from "@/controller/BaseController";
import {locationsService} from "@/service/locations/LocationsService";
import {ShallowRef, shallowRef} from "vue";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import ILocationExt from "@/types/location/ILocationExt";
import LocationExt from "@/model/location/LocationExt";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

export default class LocationsController extends BaseController<ILocationExt[]> {

    /** All locations belonging to the user, populated by `setData()`. */
    private m_locations: ShallowRef<LocationExt[]> = shallowRef([]);

    public constructor() {
        super(i18n.global.t(AppLabels.LOCATIONS));
    }

    /** @returns Every location belonging to the user, fetched from the server. */
    async fetchData(): Promise<ILocationExt[]> {
        return await locationsService.getLocations()
    }

    /** @param data Raw location list from the server. */
    setData(data: ILocationExt[]) {
        this.m_locations.value = data.map(location => new LocationExt(location));
    }

    /** @returns The currently loaded locations. */
    public getLocations(): LocationExt[] {
        return this.m_locations.value;
    }

    /**
     * @param id Location id to look up.
     * @returns The matching location, or undefined if not loaded.
     */
    public getLocation(id: number): LocationExt | undefined {
        return this.m_locations.value.find(location => location.getId() === id);
    }

    /**
     * Create a new location and append it to the local list.
     * @param name New location's name.
     * @param description New location's description, or null.
     */
    public async addLocation(name: string, description: string | null) {
        try {
            const location = await locationsService.addLocation(name, description);
            this.m_locations.value = [...this.m_locations.value, new LocationExt(location)];
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_NEW_LOCATION_ADDED)})
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Mark a location as the user's default one and refresh the local list.
     * @param locationId Location id to mark as default.
     */
    public async setDefaultLocation(locationId: number) {
        try {
            const locations = await locationsService.setDefaultLocation(locationId);
            this.m_locations.value = locations.map(location => new LocationExt(location));
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_LOCATION_SET_DEFAULT)})
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Delete a location and remove it from the local list.
     * @param locationId Location id to delete.
     */
    public async deleteLocation(locationId: number) {
        const index = this.m_locations.value.findIndex(location => location.getId() === locationId);
        if(index != -1 ) {
            try {
                await locationsService.deleteLocation(locationId);
                this.m_locations.value.splice(index, 1);
                this.m_locations.value = [...this.m_locations.value];
                appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_DELETED_LOCATION)})
            } catch (e) {
                console.error(e);
            }
        }
    }
}
