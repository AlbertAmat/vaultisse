import {PATH_PREFIX} from "@/Constants";
import axiosInstance from "@/plugins/axiosInstance";
import ILoansResponse from "@/types/loans/ILoan";
import ILoanHistoryEntry from "@/types/loans/ILoanHistory";
import {IMyLoan, IMyLoanHistoryRow} from "@/types/loans/IMyLoan";

/**
 * Thin HTTP client for the `/api/rest/loans` endpoint (see server/src/routes/LoansRoute.ts).
 *
 * @example
 * const {loans, total} = await loansService.getLoans(0, null, null, null);
 */
class LoansService {

    /**
     * The copies currently on loan to the logged-in vault member.
     * @returns Every copy booked to them.
     */
    public async getMyLoans(): Promise<IMyLoan[]> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/loans/mine`);
        return data.loans;
    }

    /**
     * The logged-in vault member's whole loan history, newest first.
     * @returns Every loan to them, returned or still open.
     */
    public async getMyLoanHistory(): Promise<IMyLoanHistoryRow[]> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/loans/mine/history`);
        return data.rows;
    }

    /**
     * Paginated, filterable list of books currently on loan.
     * @param page Zero-based page index (50 results per page).
     * @param groupId Restrict to customers in this group, or null for all.
     * @param dateFrom Only loans made on/after this date ("YYYY-MM-DD"), or null.
     * @param dateTo Only loans made on/before this date ("YYYY-MM-DD"), or null.
     * @returns A page of matching loans plus pagination info.
     */
    public async getLoans(
        page: number,
        groupId: number | null,
        dateFrom: string | null,
        dateTo: string | null
    ): Promise<ILoansResponse> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/loans`, {
            params: {
                page: page,
                group_id: groupId,
                date_from: dateFrom,
                date_to: dateTo
            }
        });

        return data;
    }

    /**
     * Unpaginated loan history for the Excel report: every loan (returned or
     * not) in a date range, optionally narrowed by group and/or customer.
     * @param dateFrom Only loans made on/after this date ("YYYY-MM-DD"). Required.
     * @param dateTo Only loans made on/before this date ("YYYY-MM-DD"). Required.
     * @param groupId Restrict to customers in this group, or null for all.
     * @param customerId Restrict to this customer, or null for all.
     * @returns Every matching loan, newest first.
     */
    public async getLoanHistory(
        dateFrom: string,
        dateTo: string,
        groupId: number | null,
        customerId: number | null
    ): Promise<ILoanHistoryEntry[]> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/loans/report`, {
            params: {
                date_from: dateFrom,
                date_to: dateTo,
                group_id: groupId,
                customer_id: customerId
            }
        });

        return data.rows;
    }
}

/** Singleton instance shared by every part of the app. */
export const loansService = new LoansService();
