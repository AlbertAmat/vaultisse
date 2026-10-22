import type {AxiosInstance} from "axios";
import IUserSession from "@vaultisse/types/user/IUserSession";
import IActivityLogEntry from "@vaultisse/types/user/IActivityLogEntry";

/**
 * Thin HTTP client for the `/api/rest/user` endpoints (see server/src/routes/UserRoute.ts):
 * self-service account management for the logged-in user.
 *
 * @example
 * await api.users.update("Jane Doe", "jane@example.com", "en", "US");
 * await api.users.changePassword("OldS3cret!", "NewS3cret!456");
 */
export class UserService {

    constructor(private readonly http: AxiosInstance) {}

    /**
     * Upload/replace the current user's profile picture.
     * @param file PNG or JPEG image, max 2MB (enforced server-side).
     */
    public async uploadImage(file: File) {
        const formData = new FormData();
        formData.append("image", file); // "image" must match upload.single("image")

        await this.http.post(`/user/image`, formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            }
        })
    }

    /** Remove the current user's profile picture. */
    public async removeImage() {
        await this.http.delete(`/user/image`)
    }

    /**
     * Permanently delete the current user's account.
     * @param password Current account password, required as re-auth.
     */
    public async delete(password: string) {
        await this.http.delete(`/user`, {data: {password}})
    }

    /**
     * Change the current user's password. New password reissues the session cookie.
     * @param currentPassword Current (soon to be old) password, for verification.
     * @param newPassword New password to set.
     */
    public async changePassword(currentPassword: string, newPassword: string) {
        await this.http.post(`/user/password`, {
            currentPassword: currentPassword,
            newPassword : newPassword,
        })
    }

    /**
     * Update the current user's profile fields. Changing the email requires
     * `currentPassword` (server-enforced - see `PUT /user` in
     * server/src/routes/UserRoute.ts); omit it when the email isn't changing.
     * @param name New display name.
     * @param email New email address.
     * @param language New preferred UI language (2-letter code).
     * @param region New preferred region code.
     * @param currentPassword Current password, required only when `email` differs from the stored one.
     */
    public async update(name: string, email: string, language: string, region: string, currentPassword?: string) {
        await this.http.put(`/user`, {
            name: name,
            email: email,
            language: language,
            region: region,
            currentPassword: currentPassword,
        })
    }

    /**
     * Update the current user's UI theme preference.
     * @param theme "beige" (warm/light) or "library" (dark/blue).
     */
    public async updateTheme(theme: string) {
        await this.http.patch(`/user/theme`, {theme});
    }

    /**
     * Update whether the left nav collapses to icon-only "rail" mode
     * (expanding on hover) instead of staying fully expanded.
     * @param sidebarRail Whether rail mode is enabled.
     */
    public async updateSidebarRail(sidebarRail: boolean) {
        await this.http.patch(`/user/sidebar-rail`, {sidebarRail});
    }

    /** Whether the current user has an OPDS feed token (Settings > OPDS feed). */
    public async getOpdsEnabled(): Promise<boolean> {
        const response = await this.http.get(`/user/opds`);
        return response.data.enabled;
    }

    /**
     * Create (or rotate) the current user's OPDS feed token.
     * @returns The server-relative feed path (`/opds/<token>`) - the only time it is available.
     */
    public async createOpdsToken(): Promise<string> {
        const response = await this.http.post(`/user/opds`);
        return response.data.path;
    }

    /** Disable the current user's OPDS feed. */
    public async revokeOpdsToken(): Promise<void> {
        await this.http.delete(`/user/opds`);
    }

    /** List the current user's active login sessions (Settings > Active sessions). */
    public async getSessions(): Promise<IUserSession[]> {
        const response = await this.http.get(`/user/sessions`);
        return response.data;
    }

    /**
     * Revoke one of the current user's own sessions ("Log out" next to a
     * device in Settings > Active sessions).
     * @param sessionId The session's `id` (from `getSessions`).
     */
    public async revokeSession(sessionId: number): Promise<void> {
        await this.http.delete(`/user/sessions/${sessionId}`);
    }

    /**
     * List the current user's recent auth activity (Settings > Recent logins).
     * @param limit Max rows to return (default 20, capped at 50 server-side).
     */
    public async getActivity(limit: number = 20): Promise<IActivityLogEntry[]> {
        const response = await this.http.get(`/user/activity`, {params: {limit}});
        return response.data;
    }

    /**
     * Acknowledge the security-measures notice shown to public-institution
     * accounts (see SecurityNoticeDialog.vue). Records the acceptance date
     * server-side so the dialog doesn't show again for this user.
     */
    public async acceptSecurityNotice() {
        await this.http.post(`/user/security-notice/accept`)
    }

    /**
     * Accept the Terms of Service, required from every account (see
     * TermsOfServiceDialog.vue). Records the acceptance date server-side
     * so the dialog doesn't show again for this user.
     */
    public async acceptTermsOfService() {
        await this.http.post(`/user/terms-of-service/accept`)
    }

    /**
     * Start (or restart) two-factor auth setup: generates a new TOTP secret
     * server-side and returns it plus a scannable QR code data URL.
     */
    public async setupTwoFactor(): Promise<{ secret: string; qrCodeDataUrl: string }> {
        const response = await this.http.post(`/user/2fa/setup`);
        return response.data;
    }

    /**
     * Confirm setup and turn two-factor auth on.
     * @param code 6-digit code from the authenticator app.
     * @returns One-time backup codes, shown to the user exactly once.
     */
    public async enableTwoFactor(code: string): Promise<string[]> {
        const response = await this.http.post(`/user/2fa/enable`, {code});
        return response.data.backupCodes;
    }

    /**
     * Turn two-factor auth off.
     * @param password Current account password, required as re-auth.
     */
    public async disableTwoFactor(password: string) {
        await this.http.post(`/user/2fa/disable`, {password});
    }

}
