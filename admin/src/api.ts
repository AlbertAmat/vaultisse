/** The one admin API client of the app, wired to the app's notifications and prompts. */
import type {AxiosError} from "axios";
import {createAdminApiClient} from "@vaultisse/api-client";
import {askReauth, hooks, notify, state} from "@/store";

/**
 * @param error A failed request.
 * @returns The server's message, or a generic one.
 */
export function errorMessage(error: unknown): string {
    const axiosError = error as AxiosError<{message?: string}>;
    if (axiosError?.response?.data?.message) {
        return axiosError.response.data.message;
    }
    if (axiosError?.response?.status === 429) {
        return "Too many attempts. Try again in a few minutes.";
    }
    if (axiosError?.code === "ERR_NETWORK") {
        return "Can't reach the server.";
    }
    return axiosError?.message ?? "Something went wrong.";
}

/**
 * The single API client. Calls look like api.users.list({search: "alice"}) or api.vaults.clear(id, ["authors"], "My library").
 * Behaviour wired in here: an expired session sends the admin to /login; any other failed request shows a red message (unless the call opted out);
 * a 403 "reauthRequired" opens the password + code prompt and repeats the request once the admin passed it.
 */
export const api = createAdminApiClient({
    onSessionExpired: () => {
        state.admin = null;
        hooks.sessionExpired();
    },
    onError: (error) => {
        // The forced password change is handled by the router, not by a toast.
        if ((error.response?.data as {passwordChangeRequired?: boolean} | undefined)?.passwordChangeRequired) {
            if (state.admin) {
                state.admin.mustChangePassword = true;
            }
            hooks.sessionExpired();
            return;
        }
        notify(errorMessage(error), "error");
    },
    reauth: askReauth,
});
