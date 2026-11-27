/** Tiny global state of the admin app: who is signed in, the snackbar, and the re-verification prompt. */
import {reactive} from "vue";
import type {IAdminSelf} from "@vaultisse/types/admin/IAdmin";

/** The same two themes as the client app. */
export type AppTheme = "beige" | "library";

interface ReauthRequest {
    resolve: (ok: boolean) => void;
}

export const state = reactive({
    admin: null as IAdminSelf | null,
    /** True once the first `GET /auth/me` has answered, so the router knows whether to show the login. */
    ready: false,
    snack: {show: false, text: "", color: "success"},
    reauth: null as ReauthRequest | null,
    /** The first-run setup guide is open. */
    onboardingOpen: false,
    theme: (() => {
        try {
            return localStorage.getItem("admin-theme") === "library" ? "library" : "beige";
        } catch {
            return "beige";
        }
    })() as AppTheme,
});

/** Late-bound so the API client doesn't have to import the router (which imports the views, which import the API). */
export const hooks = {sessionExpired: () => undefined as void};

/**
 * Shows a message at the bottom of the screen.
 * @param text Message.
 * @param color Vuetify color name.
 */
export function notify(text: string, color: "success" | "error" | "info" | "warning" = "success"): void {
    state.snack = {show: true, text, color};
}

/** @returns Whether the signed-in admin may change things (read-only admins only look). */
export function canWrite(): boolean {
    return state.admin?.role === "superadmin";
}

/**
 * Opens the "confirm your password and code" prompt; resolves with whether the admin passed it.
 * Used by the API client when the server asks for a fresh verification before a dangerous action.
 */
export function askReauth(): Promise<boolean> {
    return new Promise((resolve) => {
        if (state.reauth) {
            state.reauth.resolve(false);
        }
        state.reauth = {resolve};
    });
}

/** @param theme Theme to use; remembered in this browser. */
export function setTheme(theme: AppTheme): void {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    try {
        localStorage.setItem("admin-theme", theme);
    } catch {
        // Private mode etc.: the choice just isn't remembered.
    }
}
