/**
 * Who a booked copy is lent to: exactly one of a customer or a vault member
 * (a `book_stocks` row carries `customer_id` or `member_user_id`, never both).
 *
 * @example
 * const toCustomer: IBorrower = { customerId: 7, memberUserId: null };
 * const toMember: IBorrower = { customerId: null, memberUserId: 12 };
 */
export interface IBorrower {
    /** Customer id, or null when lent to a vault member. */
    customerId: number | null;
    /** Vault member's user id, or null when lent to a customer. */
    memberUserId: number | null;
}

/** A vault member with borrow permission, as listed in the policy payload. */
export interface IBorrowingMember {
    /** The member's user id. */
    id: number;
    /** The member's display name. */
    name: string;
}
