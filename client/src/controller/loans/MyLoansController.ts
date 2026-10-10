/**
 * Backs the "My loans" view for vault members who borrow books: the copies
 * currently on loan to them, and their whole loan history.
 */
import {BaseController} from "@/controller/BaseController";
import {IMyLoan, IMyLoanHistoryRow, IMyLoansData} from "@/types/loans/IMyLoan";
import {loansService} from "@/service/loans/LoansService";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

export default class MyLoansController extends BaseController<IMyLoansData> {

    /** Copies currently on loan to the caller. */
    private m_loans: IMyLoan[] = [];

    /** The caller's whole loan history. */
    private m_history: IMyLoanHistoryRow[] = [];

    public constructor() {
        super(i18n.global.t(AppLabels.MY_LOANS));
    }

    /** @returns The caller's current loans and loan history. */
    async fetchData(): Promise<IMyLoansData> {
        const [loans, history] = await Promise.all([loansService.getMyLoans(), loansService.getMyLoanHistory()]);
        return {loans, history};
    }

    /** @param data Raw loans and history from the server, or null. */
    setData(data: IMyLoansData | null) {
        this.m_loans = data ? data.loans : [];
        this.m_history = data ? data.history : [];
    }

    /** @returns The copies currently on loan to the caller. */
    public getLoans(): IMyLoan[] {
        return this.m_loans;
    }

    /** @returns The caller's whole loan history, newest first. */
    public getHistory(): IMyLoanHistoryRow[] {
        return this.m_history;
    }
}
