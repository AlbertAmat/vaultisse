export interface Loan {
    stockId: number;
    stockCode: string;
    loanedAt: string | null;
    bookId: number;
    bookName: string;
    imageUrl: string | null;
    /** Set when loaned to a customer; null when loaned to a vault member. */
    customerId: number | null;
    /** Set when loaned to a vault member; null when loaned to a customer. */
    memberUserId: number | null;
    /** The customer's or member's name. */
    customerName: string;
    groupId: number | null;
    groupName: string | null;
}

/** A copy currently on loan to the calling vault member. */
export interface MyLoan {
    stockId: number;
    stockCode: string;
    loanedAt: string | null;
    bookId: number;
    bookName: string;
    imageUrl: string | null;
}

/** One past or present loan to the calling vault member, from `loan_history`. */
export interface MyLoanHistoryRow {
    bookId: number | null;
    bookName: string;
    stockCode: string;
    loanedAt: string;
    returnedAt: string | null;
}

export interface LoanHistoryRow {
    bookName: string;
    stockCode: string;
    customerName: string;
    groupName: string | null;
    loanedAt: string;
    returnedAt: string | null;
}

/** A copy that can be lent right now. */
export interface AvailableStock {
    code: string;
    bookName: string;
    imageUrl: string | null;
    locationName: string | null;
}

export interface LoanListFilter {
    groupId?: number | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    page?: number;
}

export interface LoanReportFilter {
    dateFrom: string;
    dateTo: string;
    groupId?: number | null;
    customerId?: number | null;
    memberUserId?: number | null;
}
