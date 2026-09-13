// Vue reactivity utilities
import { ref, Ref } from "vue";

// Global application constants (e.g., API prefix)
import { PATH_PREFIX } from "@/Constants";

// API response type for the application policy endpoint
import IPolicyResponse from "@/types/IPolicyResponse";

// Data models used throughout the app
import Language from "@/model/language/Language";
import Category from "@/model/category/Category";
import Location from "@/model/location/Location";
import Format from "@/model/format/Format";
import User from "@/model/user/User";
import Customer from "@/model/customer/Customer";

// Axios instance configured with interceptors and base URL
import axiosInstance from "@/plugins/axiosInstance";
import {i18n} from "@/plugins/i18n/i18n";

/**
 * ApplicationService is a central store-like service
 * that fetches and provides global application data:
 *   - Current user
 *   - Customers
 *   - Categories
 *   - Languages
 *   - Formats
 *   - Locations
 *
 * It maintains loading and error states to help manage UI feedback.
 */
export class ApplicationService {

    /**
     * Reactive loading flag to indicate if the policy data is being fetched.
     * @private
     */
    private m_loading: Ref<boolean> = ref(true);

    /**
     * Stores any error encountered during data fetching.
     * @private
     */
    private m_error: Error | null;

    /**
     * Logged-in user data.
     * @private
     */
    private m_user!: User;

    /**
     * List of customers retrieved from the policy.
     * @private
     */
    private m_customer: Customer[];

    /**
     * List of available languages in the application.
     * @private
     */
    private m_languages: Language[];

    /**
     * List of available categories.
     * @private
     */
    private m_categories: Category[];

    /**
     * List of available formats for books/media.
     * @private
     */
    private m_formats: Format[];

    /**
     * List of available physical locations (e.g., stores, libraries).
     * @private
     */
    private m_locations: Location[];

    /**
     * Max accepted size, in MB, for a `POST /import/library` upload.
     * @private
     */
    private m_maxImportFileSizeMb: number;

    /**
     * Initializes default empty states and error handling.
     */
    public constructor() {
        this.m_error = null;
        this.m_customer = [];
        this.m_languages = [];
        this.m_locations = [];
        this.m_categories = [];
        this.m_formats = [];
        this.m_maxImportFileSizeMb = 0;
    }

    /**
     * Fetches the application policy data from the backend.
     * This includes user info, customers, categories, languages, formats, and locations.
     * Populates local state for the entire app to consume.
     */
    public async fetchPolicy() {
        try {
            this.m_loading.value = true;
            const response = await axiosInstance.get(`${PATH_PREFIX}/app/policy`);
            const data = response.data as IPolicyResponse;

            // Populate local state with typed model instances
            this.m_user = new User(data.user);
            this.m_customer = data.customers.map((customer) => new Customer(customer));
            this.m_categories = data.categories.map((category) => new Category(category));
            this.m_languages = data.languages.map((lang) => new Language(lang));
            this.m_formats = data.formats.map((format) => new Format(format));
            this.m_locations = data.locations.map((location) => new Location(location));
            this.m_maxImportFileSizeMb = data.maxImportFileSizeMb;

            // Set i18n locale
            //@ts-ignore
            i18n.global.locale.value = this.m_user.getLanguage();
            i18n.global.setLocaleMessage(this.m_user.getLanguage(), data.labels);
        } catch (e: any) {
            const error = e as Error;
            console.error("Error while fetching application policy.", e);
            this.m_error = error;
        } finally {
            this.m_loading.value = false;
        }
    }

    /**
     * Indicates whether the service is currently loading data.
     */
    public isLoading(): boolean {
        return this.m_loading.value;
    }

    /**
     * Returns true if an error occurred during the last fetch.
     */
    public hasError(): boolean {
        return this.m_error != null;
    }

    /**
     * Retrieves the stored error object, if any.
     */
    public getError(): Error | null {
        return this.m_error;
    }

    /**
     * Retrieves the currently logged-in user.
     */
    public getUser(): User {
        return this.m_user;
    }

    /**
     * Retrieves the list of customers.
     */
    public getCustomers(): Customer[] {
        return this.m_customer;
    }

    /**
     * Retrieves the full list of categories.
     */
    public getCategories(): Category[] {
        return this.m_categories;
    }

    /**
     * Finds a category by its ID.
     * @param id - Category ID to search for. Returns undefined if not found or null.
     */
    public getCategory(id: number | null): Category | undefined {
        if (!id) {
            return undefined;
        }
        return this.m_categories.find((category) => category.getCategoryId() === id);
    }

    /**
     * Replaces the current categories list with a new one.
     * Useful when categories are updated or re-fetched.
     * @param items New full list of categories.
     */
    public setCategories(items: Category[]) {
        this.m_categories = items;
    }

    /**
     * Retrieves the list of available languages.
     */
    public getLanguages(): Language[] {
        return this.m_languages;
    }

    /**
     * Finds a language by its code.
     * @param code - Language code to search for. Returns undefined if not found or null.
     */
    public getLanguage(code: string | null): Language | undefined {
        if (!code) {
            return undefined;
        }
        return this.m_languages.find((language) => language.getLanguageCode() === code);
    }

    /**
     * Checks if there are any available formats.
     */
    public hasFormats(): boolean {
        return this.m_formats.length > 0;
    }

    /**
     * Finds a format by its ID.
     * @param id - Format ID to search for.
     */
    public getFormat(id: number): Format | undefined {
        return this.m_formats.find((format) => format.getFormatId() === id);
    }

    /**
     * Retrieves the list of all formats.
     */
    public getFormats(): Format[] {
        return this.m_formats;
    }

    /**
     * Retrieves the list of all locations.
     */
    public getLocations(): Location[] {
        return this.m_locations;
    }

    /**
     * Replaces the current locations list with a new one.
     * @param items New full list of locations.
     */
    public setLocations(items: Location[]) {
        this.m_locations = items;
    }

    /**
     * Retrieves the user's default location, if one is set.
     */
    public getDefaultLocation(): Location | undefined {
        return this.m_locations.find((location) => location.isDefault());
    }

    /**
     * Max accepted size, in MB, for a `POST /import/library` upload - use
     * this instead of hardcoding a copy of the server's limit, which can
     * silently drift out of sync with it.
     */
    public getMaxImportFileSizeMb(): number {
        return this.m_maxImportFileSizeMb;
    }
}

/**
 * Singleton instance of ApplicationService for use across the application.
 */
export const applicationService = new ApplicationService();
