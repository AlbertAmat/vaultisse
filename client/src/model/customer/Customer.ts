/**
 * View model for a customer: name plus optional group membership, with
 * reactive rename and group-assignment operations backed by
 * `CustomersService`/`CustomerGroupService`.
 */
import {Ref, ref} from "vue";
import ICustomer from "@vaultisse/types/customer/ICustomer";
import {api} from "@/plugins/api";

export default class Customer {
    /** Customer id, immutable once loaded. */
    protected readonly m_customerId: number;

    /** Customer display name. */
    private readonly m_customerName: Ref<string>;

    /** Id of the group this customer belongs to, or null if ungrouped. */
    private readonly m_groupId: Ref<number | null>;

    /** Name of the group this customer belongs to, or null if ungrouped. */
    private readonly m_groupName: Ref<string | null>;

    /** @param data Raw customer data from the server. */
    public constructor(data: ICustomer) {
        this.m_customerId = data.id;
        this.m_customerName = ref(data.name);
        this.m_groupId = ref(data.group_id);
        this.m_groupName = ref(data.group_name);
    }

    /** @returns The customer id. */
    public getCustomerId(): number {
        return this.m_customerId;
    }

    /** @returns The customer's display name. */
    public getCustomerName(): string {
        return this.m_customerName.value;
    }

    /**
     * Rename this customer on the server and update local state.
     * @param name New customer name.
     */
    public async update(name:string) {
        await api.customers.updateCustomer(this.m_customerId, name);
        this.m_customerName.value = name;
    }

    /** @returns The id of the group this customer belongs to, or null if ungrouped. */
    public getGroupId(): number | null {
        return this.m_groupId.value;
    }

    /** @returns The name of the group this customer belongs to, or null if ungrouped. */
    public getGroupName(): string | null {
        return this.m_groupName.value;
    }

    /**
     * Assign this customer to a group on the server and update local state.
     * @param groupId Id of the group to assign.
     * @param groupName Name of the group to assign (stored locally to avoid a re-fetch).
     */
    public async assignToGroup(groupId: number, groupName: string) {
        await api.customerGroups.assignCustomerToGroup(this.m_customerId, groupId);
        this.m_groupId.value = groupId;
        this.m_groupName.value = groupName;
    }

    /** Remove this customer from their current group, on the server and locally. */
    public async removeFromGroup() {
        await api.customerGroups.removeCustomerFromGroup(this.m_customerId);
        this.m_groupId.value = null;
        this.m_groupName.value = null;
    }
}
