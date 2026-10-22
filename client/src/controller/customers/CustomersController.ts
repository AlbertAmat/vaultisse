/** Backs the customers management view: loads customers and exposes add/delete operations. */
import {BaseController} from "@/controller/BaseController";
import {ShallowRef, shallowRef} from "vue";
import ICustomer from "@vaultisse/types/customer/ICustomer";
import Customer from "@/model/customer/Customer";
import {api} from "@/plugins/api";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {ICustomersResponse} from "@vaultisse/types/customer/ICustomersResponse";
import CustomerDetail from "@/model/customer/CustomerDetail";
import CustomerGroup from "@/model/customer/CustomerGroup";

export default class CustomersController extends BaseController<ICustomersResponse> {

    /** All customers belonging to the user, populated by `setData()`. */
    private m_customers: ShallowRef<CustomerDetail[]> = shallowRef([]);

    public constructor() {
        super(i18n.global.t(AppLabels.CUSTOMERS));
    }

    /** @returns The customers list view's data. */
    async fetchData(): Promise<ICustomersResponse> {
        return await api.customers.getPageData()
    }

    /** Re-run `fetchData()`/`setData()` to refresh customers from the server. */
    async reload() {
        await this.__fetchData();
    }

    /** @param data Raw customers data from the server. */
    setData(data: ICustomersResponse) {
        this.m_customers.value = data.customers.map(customer => new CustomerDetail(customer));
    }

    /** @returns The currently loaded customers. */
    public getCustomers(): CustomerDetail[] {
        return this.m_customers.value;
    }

    /**
     * @param id Customer id to look up.
     * @returns The matching customer, or undefined if not loaded.
     */
    public getCustomer(id: number): CustomerDetail | undefined {
        return this.m_customers.value.find(customer => customer.getCustomerId() === id);
    }

    /**
     * Create a new customer, optionally assigning it to a group, and append it to the local list.
     * @param name New customer's name.
     * @param group Group to assign the new customer to, optional.
     */
    public async addCustomer(name: string, group?: CustomerGroup) {
        try {
            const customer = await api.customers.addCustomer(name);
            const customerDetail = new CustomerDetail(customer);
            if (group) {
                await customerDetail.assignToGroup(group.getId(), group.getName());
                group.incrementTotalCustomers();
            }
            this.m_customers.value = [...this.m_customers.value, customerDetail];
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_NEW_CUSTOMER_ADDED)})
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Delete a customer and remove it from the local list.
     * @param customerId Customer id to delete.
     */
    public async deleteCustomer(customerId: number) {
        const index = this.m_customers.value.findIndex(customer => customer.getCustomerId() === customerId);
        if(index != -1 ) {
            try {
                await api.customers.deleteCustomer(customerId);
                this.m_customers.value.splice(index, 1);
                this.m_customers.value = [...this.m_customers.value];
                appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_DELETED_CUSTOMER)})
            } catch (e) {
                console.error(e);
            }
        }
    }
}
