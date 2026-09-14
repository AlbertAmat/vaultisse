export interface Loan {
    stockId: number;
    stockCode: string;
    loanedAt: string | null;
    bookId: number;
    bookName: string;
    imageUrl: string | null;
    customerId: number;
    customerName: string;
    groupId: number | null;
    groupName: string | null;
}

export interface LoanHistoryRow {
    bookName: string;
    stockCode: string;
    customerName: string;
    groupName: string | null;
    loanedAt: string;
    returnedAt: string | null;
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
}
