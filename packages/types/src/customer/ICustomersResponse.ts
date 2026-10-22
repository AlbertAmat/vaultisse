import {ICustomerDetail} from "./ICustomer";

/**
 * Response shape for `GET /customer`.
 */
export interface ICustomersResponse {
    /** All customers belonging to the user. */
    customers: ICustomerDetail[];
}
