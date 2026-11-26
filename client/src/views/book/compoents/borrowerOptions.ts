/**
 * The "who can a copy be lent to" picker shared by LendStockDialog and
 * BookStockDialog: customers plus vault members with borrow permission.
 * Values are prefixed ("c:" customer, "m:" member) because the two kinds
 * have separate id spaces.
 */
import {IBorrower} from "@vaultisse/types/book/IBorrower";
import {applicationService} from "@/service/ApplicationService";

/** @returns One `{value, text}` item per possible borrower. */
export function borrowerItems(): {value: string, text: string}[] {
	const customers = applicationService.getCustomers().map((customer) => ({
		value: `c:${customer.getCustomerId()}`,
		text: customer.getCustomerName()
	}));
	const members = applicationService.getBorrowingMembers().map((member) => ({
		value: `m:${member.id}`,
		text: member.name
	}));
	return [...customers, ...members];
}

/**
 * Splits a picker value back into the customer/member pair the API expects.
 * @param value Selected item value, or null for none.
 * @returns The borrower.
 */
export function toBorrower(value: string | null): IBorrower {
	if (!value) {
		return {customerId: null, memberUserId: null};
	}
	const id = Number(value.slice(2));
	return value.startsWith("m:") ? {customerId: null, memberUserId: id} : {customerId: id, memberUserId: null};
}
