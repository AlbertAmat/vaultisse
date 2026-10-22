/**
 * Builds the axios instance every service in this package talks through.
 * Centralizes the cross-cutting concerns that must behave the same in every
 * host (web client, browser extension, ...) while leaving the UI reaction to
 * the host via callbacks:
 *  - `withCredentials: true` by default so the httpOnly session cookie is sent.
 *  - A response interceptor that reports failures to `onError` / `onSessionExpired`,
 *    unless the request opts out with `suppressErrorDialog: true`.
 *
 * @example
 * const http = createHttpClient({baseURL: "https://books.example.com", onError: e => console.error(e)});
 * const {data} = await http.get("/book/12");
 *
 * // Skip the `onError` callback for a request (e.g. batch imports that
 * // render their own per-item error UI):
 * await http.post("/book/isbn/123", body, {suppressErrorDialog: true});
 */
import axios, {AxiosError, AxiosInstance} from "axios";
import {AppError, AppErrorsList} from "@vaultisse/types/AppError";

declare module "axios" {
    interface AxiosRequestConfig {
        /** When true, the interceptor does not call `onError` - the caller renders its own error UI. */
        suppressErrorDialog?: boolean;
    }
}

/** Path every REST route is mounted under (see server/src/AppService.ts's `ROUTE_PREFIX`). */
export const API_PATH_PREFIX = "/api/rest";

export interface HttpClientOptions {
    /**
     * Origin of the Vaultisse server, without a trailing path (e.g. `https://books.example.com`).
     * Omit (or pass `""`) for same-origin requests, as the web client does.
     */
    baseURL?: string;
    /** Send cookies with requests. Defaults to `true`. */
    withCredentials?: boolean;
    /** Extra default headers (e.g. an auth token for a browser extension). */
    headers?: Record<string, string>;
    /**
     * Called for every failed request that is not suppressed (see `suppressErrorDialog`)
     * and that is not an app-level error the calling code handles itself (see `AppError`).
     * Receives network errors (no `response`) as well as HTTP errors.
     */
    onError?: (error: AxiosError) => void;
    /**
     * Called when the server reports the session itself is gone (401 with `sessionExpired`),
     * as opposed to a 401 from in-request logic like a wrong current password.
     */
    onSessionExpired?: (error: AxiosError) => void;
}

/**
 * Create the axios instance used by the services. Every request is
 * prefixed with `baseURL` + {@link API_PATH_PREFIX}; errors are always
 * re-thrown so calling code can still handle them.
 * @param options See {@link HttpClientOptions}.
 * @returns A configured axios instance.
 */
export function createHttpClient(options: HttpClientOptions = {}): AxiosInstance {
    const http = axios.create({
        baseURL: `${(options.baseURL ?? "").replace(/\/+$/, "")}${API_PATH_PREFIX}`,
        withCredentials: options.withCredentials ?? true,
        headers: options.headers
    });

    http.interceptors.response.use(
        response => response,
        (error: AxiosError<any>) => {
            // See `sessionExpired` in AuthMiddleware.ts's `requireAuth`.
            if (error.response?.status === 401 && error.response.data?.sessionExpired) {
                options.onSessionExpired?.(error);
                return Promise.reject(error);
            }

            // App-level errors: the calling component renders its own state.
            const status = error.response?.status;
            if (status !== undefined && AppErrorsList.includes(status as AppError)) {
                return Promise.reject(error);
            }

            if (!error.config?.suppressErrorDialog) {
                options.onError?.(error);
            }

            return Promise.reject(error);
        }
    );

    return http;
}
