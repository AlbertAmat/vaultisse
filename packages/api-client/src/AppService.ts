import type {AxiosInstance} from "axios";
import IAppVersion from "@vaultisse/types/app/IAppVersion";
import IPolicyResponse from "@vaultisse/types/IPolicyResponse";

/**
 * Thin HTTP client for the `/api/rest/app` endpoints (see server/src/routes/AppRoute.ts).
 *
 * @example
 * const {version} = await api.app.getVersion();
 */
export class AppService {

    constructor(private readonly http: AxiosInstance) {}

    /** @returns The running server's version and uptime. */
    public async getVersion(): Promise<IAppVersion> {
        const {data} = await this.http.get(`/app/version`, {suppressErrorDialog: true})
        return data;
    }

    /**
     * Fetch the bootstrap payload (`GET /app/policy`): the logged-in user, every
     * reference list and the UI labels. Requires an authenticated session.
     * @returns The policy payload.
     */
    public async getPolicy(): Promise<IPolicyResponse> {
        const {data} = await this.http.get(`/app/policy`);
        return data;
    }
}
