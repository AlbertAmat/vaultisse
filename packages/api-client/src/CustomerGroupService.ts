import type {AxiosInstance} from "axios";
import {ICustomerGroup} from "@vaultisse/types/customer/ICustomerGroup";

/**
 * Thin HTTP client for the `/api/rest/customer/group` endpoints and the
 * customer<->group assignment endpoints (see server/src/routes/CustomerRoute.ts).
 *
 * @example
 * const groups = await api.customerGroups.getGroups();
 * await api.customerGroups.assignCustomerToGroup(7, groups[0].id);
 */
export class CustomerGroupService {

    constructor(private readonly http: AxiosInstance) {}

    /** @returns Every customer group, with each group's member count. */
    public async getGroups(): Promise<ICustomerGroup[]> {
        const {data} = await this.http.get(
            `/customer/group`
        );

        return data;
    }

    /**
     * Create a new customer group.
     * @param name New group's name.
     * @param description New group's description, optional.
     * @returns The created group.
     */
    public async addGroup(
        name: string,
        description?: string
    ): Promise<ICustomerGroup> {
        const {data} = await this.http.post(
            `/customer/group`,
            {
                name,
                description
            }
        );

        return data;
    }

    /**
     * Rename/update a customer group's description.
     * @param id Group id to update.
     * @param name New group name.
     * @param description New group description, optional.
     * @returns The updated group.
     */
    public async updateGroup(
        id: number,
        name: string,
        description?: string
    ): Promise<ICustomerGroup> {
        const {data} = await this.http.put(
            `/customer/group/${id}`,
            {
                name,
                description
            }
        );

        return data;
    }

    /**
     * Delete a customer group (members are kept, ungrouped).
     * @param id Group id to delete.
     */
    public async deleteGroup(id: number): Promise<void> {
        await this.http.delete(
            `/customer/group/${id}`
        );
    }

    /**
     * Assign a customer to a group.
     * @param customerId Customer id to assign.
     * @param groupId Group id to assign the customer to.
     */
    public async assignCustomerToGroup(
        customerId: number,
        groupId: number
    ): Promise<void> {
        await this.http.put(
            `/customer/${customerId}/group/${groupId}`
        );
    }

    /**
     * Remove a customer from whichever group they're in.
     * @param customerId Customer id to unassign.
     */
    public async removeCustomerFromGroup(
        customerId: number
    ): Promise<void> {
        await this.http.delete(
            `/customer/${customerId}/group`
        );
    }
}
