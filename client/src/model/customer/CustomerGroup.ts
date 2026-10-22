/**
 * View model for a customer group, with reactive rename/description update
 * and a locally-tracked member count (kept in sync via
 * `incrementTotalCustomers`/`decrementTotalCustomers` when customers are
 * assigned/removed elsewhere, avoiding a full re-fetch).
 */
import {Ref, ref} from "vue";
import {ICustomerGroup} from "@vaultisse/types/customer/ICustomerGroup";
import {api} from "@/plugins/api";

export default class CustomerGroup {
    /** Group id, immutable once loaded. */
    private readonly m_id: number;

    /** Group name. */
    private readonly m_name: Ref<string>;

    /** Group description, or undefined if unset. */
    private readonly m_description: Ref<string | undefined>;

    /** Number of customers currently in this group. */
    private readonly m_totalCustomers: Ref<number>;

    /** @param data Raw customer group data from the server. */
    public constructor(data: ICustomerGroup) {
        this.m_id = data.id;
        this.m_name = ref(data.name);
        this.m_description = ref(data.description);
        this.m_totalCustomers = ref(data.total_customers ?? 0);
    }

    /** @returns The group id. */
    public getId(): number {
        return this.m_id;
    }

    /** @returns The group name. */
    public getName(): string {
        return this.m_name.value;
    }

    /** @returns The group description, or undefined if unset. */
    public getDescription(): string | undefined {
        return this.m_description.value;
    }

    /** @returns The number of customers currently in this group. */
    public getTotalCustomers(): number {
        return this.m_totalCustomers.value;
    }

    /**
     * Persist a new name/description on the server and update local state.
     * @param name New group name.
     * @param description New group description, or undefined to clear it.
     */
    public async update(name: string, description?: string) {
        await api.customerGroups.updateGroup(this.m_id, name, description);
        this.m_name.value = name;
        this.m_description.value = description;
    }

    /** Bump the locally-tracked member count (e.g. after assigning a customer to this group). */
    public incrementTotalCustomers() {
        this.m_totalCustomers.value += 1;
    }

    /** Decrement the locally-tracked member count, floored at 0 (e.g. after removing a customer). */
    public decrementTotalCustomers() {
        this.m_totalCustomers.value = Math.max(0, this.m_totalCustomers.value - 1);
    }
}
