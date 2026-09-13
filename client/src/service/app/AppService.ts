import {PATH_PREFIX} from "@/Constants";
import axiosInstance from "@/plugins/axiosInstance";
import IAppVersion from "@/types/app/IAppVersion";

/**
 * Thin HTTP client for the `/api/rest/app` endpoints (see server/src/routes/AppRoute.ts).
 *
 * @example
 * const {version} = await appService.getVersion();
 */
class AppService {

    /** @returns The running server's version and uptime. */
    public async getVersion(): Promise<IAppVersion> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/app/version`, {suppressErrorDialog: true} as any)
        return data;
    }
}

/** Singleton instance shared by every part of the app. */
export const appService = new AppService();
