/**
 * Entry point of the package: wires one instance of every resource service
 * to a shared axios instance.
 *
 * @example
 * const api = createApiClient({baseURL: "https://books.example.com"});
 * const book = await api.books.getBook(12);
 */
import type {AxiosInstance} from "axios";
import {createHttpClient, HttpClientOptions} from "./http";
import {AppService} from "./AppService";
import {AuthorsService} from "./AuthorsService";
import {BookService} from "./BookService";
import {CategoriesService} from "./CategoriesService";
import {CustomerGroupService} from "./CustomerGroupService";
import {CustomersService} from "./CustomersService";
import {DashboardService} from "./DashboardService";
import {ImportService} from "./ImportService";
import {LoansService} from "./LoansService";
import {LocationsService} from "./LocationsService";
import {SearchService} from "./SearchService";
import {UserService} from "./UserService";
import {VaultService} from "./VaultService";

export interface ApiClient {
    /** The underlying axios instance, for requests no service covers. */
    http: AxiosInstance;
    app: AppService;
    authors: AuthorsService;
    books: BookService;
    categories: CategoriesService;
    customerGroups: CustomerGroupService;
    customers: CustomersService;
    dashboard: DashboardService;
    imports: ImportService;
    loans: LoansService;
    locations: LocationsService;
    search: SearchService;
    users: UserService;
    vaults: VaultService;
}

/**
 * Create an API client.
 * @param options Either {@link HttpClientOptions} (an axios instance is created), or an existing axios instance.
 * @returns Every resource service bound to one axios instance.
 */
export function createApiClient(options: HttpClientOptions | AxiosInstance = {}): ApiClient {
    const http = typeof options === "function" ? options : createHttpClient(options);

    return {
        http,
        app: new AppService(http),
        authors: new AuthorsService(http),
        books: new BookService(http),
        categories: new CategoriesService(http),
        customerGroups: new CustomerGroupService(http),
        customers: new CustomersService(http),
        dashboard: new DashboardService(http),
        imports: new ImportService(http),
        loans: new LoansService(http),
        locations: new LocationsService(http),
        search: new SearchService(http),
        users: new UserService(http),
        vaults: new VaultService(http),
    };
}
