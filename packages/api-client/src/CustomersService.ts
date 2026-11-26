import type {AxiosInstance} from "axios";
import {ICustomerDetail} from "@vaultisse/types/customer/ICustomer";
import {ICustomerBook} from "@vaultisse/types/customer/ICustomerBook";
import {ICustomersResponse} from "@vaultisse/types/customer/ICustomersResponse";
import {ICardActivity, ICardSettings, ICustomerCard} from "@vaultisse/types/customer/ICustomerCard";

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

    /** @returns The vault's library card settings. */
    public async getCardSettings(): Promise<ICardSettings> {
        const {data} = await this.http.get(`/customer/card/settings`);
        return data;
    }

    /**
     * Save the vault's library card settings.
     * @param form field1_label, field1_value, field2_label, field2_value, and optionally background / remove_background.
     * @returns The saved settings.
     */
    public async saveCardSettings(form: FormData): Promise<ICardSettings> {
        const {data} = await this.http.put(`/customer/card/settings`, form);
        return data;
    }

    /**
     * @param customerId Customer id.
     * @returns That customer's card data.
     */
    public async getCard(customerId: number): Promise<ICustomerCard> {
        const {data} = await this.http.get(`/customer/${customerId}/card`);
        return data;
    }

    /**
     * Update a customer's photo and member-since date.
     * @param customerId Customer id.
     * @param form member_since, and optionally photo / remove_photo.
     * @returns The updated card.
     */
    public async updateCard(customerId: number, form: FormData): Promise<ICustomerCard> {
        const {data} = await this.http.put(`/customer/${customerId}/card`, form);
        return data;
    }

    /**
     * Resolve a scanned library card.
     * @param code Barcode content.
     * @returns The customer with current loans and history.
     */
    public async scanCard(code: string): Promise<ICardActivity> {
        const {data} = await this.http.get(`/customer/card/scan/${encodeURIComponent(code)}`);
        return data;
    }

    /**
     * Lend one available copy to a card's owner.
     * @param customerId Customer id.
     * @param code Stock code.
     * @returns The refreshed activity.
     */
    public async lendByScan(customerId: number, code: string): Promise<ICardActivity> {
        const {data} = await this.http.post(`/customer/${customerId}/card/loan`, {code});
        return data;
    }
}
