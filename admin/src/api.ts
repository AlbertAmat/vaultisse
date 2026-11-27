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

export const api = createAdminApiClient({
    onSessionExpired: () => {
        state.admin = null;
        hooks.sessionExpired();
    },
    onError: (error) => notify(errorMessage(error), "error"),
    reauth: askReauth,
});
