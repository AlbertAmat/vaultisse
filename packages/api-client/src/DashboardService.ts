import type {AxiosInstance} from "axios";
import IDashboard from "@vaultisse/types/dashboard/IDashboard";

/**
 * Thin HTTP client for the `/api/rest/dashboard` endpoint (see server/src/routes/DashboardRoute.ts).
 *
 * @example
 * const stats = await api.dashboard.getData();
 */
export class DashboardService {

    constructor(private readonly http: AxiosInstance) {}

    /** @returns Every KPI/chart series the dashboard view needs, in one call. */
    public async getData(): Promise<IDashboard> {
        const {data} = await this.http.get(`/dashboard`)
        return data;
    }
}
