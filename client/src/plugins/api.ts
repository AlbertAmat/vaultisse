/**
 * The app-wide API client (`@vaultisse/api-client`): one instance of every
 * resource service sharing a single axios instance. This file is the only
 * place that decides how this host (the Vue web client) reacts to API
 * failures - the shared package just reports them:
 *  - an expired/revoked session does a full navigation to `/login` (not a
 *    router push, since Vue Router state for a logged-out SPA isn't
 *    meaningful to keep around). It is only reported for responses flagged
 *    `sessionExpired` (see `requireAuth` in AuthMiddleware.ts), as opposed to a
 *    401 from in-page logic like a wrong current password, which falls
 *    through to the generic dialog instead.
 *  - every other failure opens the global error dialog, unless the request
 *    opts out with `suppressErrorDialog: true` (e.g. batch imports that
 *    render their own per-item error UI).
 *
 * @example
 * import {api} from "@/plugins/api";
 * const book = await api.books.getBook(12);
 *
 * // Skip the automatic error dialog for a request:
 * await api.http.post("/book/isbn/123", body, {suppressErrorDialog: true});
 */
import {createApiClient} from "@vaultisse/api-client";
import {errorDialogController} from "@/components/errorDialog/ErrorDialogController";

export const api = createApiClient({
    // always send cookies (the httpOnly session cookie)
    withCredentials: true,

    onSessionExpired: () => {
        window.location.href = "/login";
    },

    onError: error => {
        if (error.response) {
            // Server responded with a status outside 2xx
            console.error("Server Error:", {
                status: error.response.status,
                data: error.response.data,
            });

            errorDialogController.showDialog(error);
        } else if (error.request) {
            // Request was sent but no response received
            console.error("No Response:", error.request);
        } else {
            // Something else happened while setting up the request
            console.error("Request Setup Error:", error.message);
        }
    },
});
