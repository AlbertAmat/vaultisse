import type {AxiosInstance} from "axios";
import {ICustomerDetail} from "@vaultisse/types/customer/ICustomer";
import {ICustomerBook} from "@vaultisse/types/customer/ICustomerBook";
import {ICustomersResponse} from "@vaultisse/types/customer/ICustomersResponse";

/**
 * Thin HTTP client for the `/api/rest/customer` endpoints (see server/src/routes/CustomerRoute.ts):
 * customer CRUD and lending/returning books to a customer.
 *
 * @example
 * const {customers} = await api.customers.getPageData();
 * await api.customers.addBooks(customers[0].id, ["a1b2c3d4e5"]);
 */
export class CustomersService {

    constructor(private readonly http: AxiosInstance) {}

    /** @returns The customers list view's data. */
    public async getPageData(): Promise<ICustomersResponse> {
        const {data} = await this.http.get(`/customer`)
        return data;
    }

    /**
     * Rename a customer.
     * @param id Customer id to update.
     * @param name New customer name.
     */
    public async updateCustomer(id: number, name: string) {
        await this.http.put(`/customer/${id}`, {
            name: name,
        })
    }

    /**
     * Create a new customer.
     * @param name New customer's name.
     * @returns The created customer.
     */
    public async addCustomer(name: string): Promise<ICustomerDetail> {
        const {data} = await this.http.post(`/customer`, {
            name: name,
        })

        return data;
    }

    /**
     * Delete a customer.
     * @param customerId Customer id to delete.
     */
    public async deleteCustomer(customerId: number): Promise<void> {
        await this.http.delete(`/customer/${customerId}`)
    }

    /**
     * List the books currently on loan to a customer.
     * @param customerId Customer id.
     * @returns The books currently on loan to that customer.
     */
    public async getCustomerBooks(customerId:number): Promise<ICustomerBook[]> {
        const {data} = await this.http.get(`/customer/${customerId}/books`);
        return data;
    }

    /**
     * Lend a batch of book stocks to a customer.
     * @param customerId Customer id.
     * @param books Array of book stock codes.
     * @returns The updated list of books on loan to this customer.
     */
    public async addBooks(customerId: number, books: string[]): Promise<ICustomerBook[]> {
        const {data} = await this.http.post(`/customer/${customerId}/add/books`, {books: books});
        return data;
    }

    /**
     * Return a single book a customer had on loan.
     * @param customerId Customer id.
     * @param bookStockCode The stock code being returned.
     */
    public async removeCustomerBook(customerId: number, bookStockCode: string): Promise<void> {
        await this.http.delete(`/customer/${customerId}/book/${bookStockCode}`);
    }
}
