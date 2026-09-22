import {PATH_PREFIX} from "@/Constants";
import axiosInstance from "@/plugins/axiosInstance";
import IUserSession from "@/types/user/IUserSession";
import IActivityLogEntry from "@/types/user/IActivityLogEntry";

/**
 * Thin HTTP client for the `/api/rest/user` endpoints (see server/src/routes/UserRoute.ts):
 * self-service account management for the logged-in user.
 *
 * @example
 * await userService.update("Jane Doe", "jane@example.com", "en", "US");
 * await userService.changePassword("OldS3cret!", "NewS3cret!456");
 */
class UserService {

    /**
     * Upload/replace the current user's profile picture.
     * @param file PNG or JPEG image, max 2MB (enforced server-side).
     */
    public async uploadImage(file: File) {
        const formData = new FormData();
        formData.append("image", file); // "image" must match upload.single("image")

        await axiosInstance.post(`${PATH_PREFIX}/user/image`, formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            }
        })
    }

    /** Remove the current user's profile picture. */
    public async removeImage() {
        await axiosInstance.delete(`${PATH_PREFIX}/user/image`)
    }

    /**
     * Permanently delete the current user's account.
     * @param password Current account password, required as re-auth.
     */
    public async delete(password: string) {
        await axiosInstance.delete(`${PATH_PREFIX}/user`, {data: {password}})
    }

    /**
     * Change the current user's password. New password reissues the session cookie.
     * @param currentPassword Current (soon to be old) password, for verification.
     * @param newPassword New password to set.
     */
    public async changePassword(currentPassword: string, newPassword: string) {
        await axiosInstance.post(`${PATH_PREFIX}/user/password`, {
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
        await axiosInstance.put(`${PATH_PREFIX}/user`, {
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
        await axiosInstance.patch(`${PATH_PREFIX}/user/theme`, {theme});
    }

    /**
     * Update whether the left nav collapses to icon-only "rail" mode
     * (expanding on hover) instead of staying fully expanded.
     * @param sidebarRail Whether rail mode is enabled.
     */
    public async updateSidebarRail(sidebarRail: boolean) {
        await axiosInstance.patch(`${PATH_PREFIX}/user/sidebar-rail`, {sidebarRail});
    }

    /**
     * Update whether the current user's Loans and Customers pages (and
     * their nav items) are shown.
     * @param leasingEnabled Whether leasing is enabled.
     */
    public async updateLeasingEnabled(leasingEnabled: boolean) {
        await axiosInstance.patch(`${PATH_PREFIX}/user/leasing`, {leasingEnabled});
    }

    /** List the current user's active login sessions (Settings > Active sessions). */
    public async getSessions(): Promise<IUserSession[]> {
        const response = await axiosInstance.get(`${PATH_PREFIX}/user/sessions`);
        return response.data;
    }

    /**
     * Revoke one of the current user's own sessions ("Log out" next to a
     * device in Settings > Active sessions).
     * @param sessionId The session's `id` (from `getSessions`).
     */
    public async revokeSession(sessionId: number): Promise<void> {
        await axiosInstance.delete(`${PATH_PREFIX}/user/sessions/${sessionId}`);
    }

    /**
     * List the current user's recent auth activity (Settings > Recent logins).
     * @param limit Max rows to return (default 20, capped at 50 server-side).
     */
    public async getActivity(limit: number = 20): Promise<IActivityLogEntry[]> {
        const response = await axiosInstance.get(`${PATH_PREFIX}/user/activity`, {params: {limit}});
        return response.data;
    }

    /**
     * Acknowledge the security-measures notice shown to public-institution
     * accounts (see SecurityNoticeDialog.vue). Records the acceptance date
     * server-side so the dialog doesn't show again for this user.
     */
    public async acceptSecurityNotice() {
        await axiosInstance.post(`${PATH_PREFIX}/user/security-notice/accept`)
    }

    /**
     * Accept the Terms of Service, required from every account (see
     * TermsOfServiceDialog.vue). Records the acceptance date server-side
     * so the dialog doesn't show again for this user.
     */
    public async acceptTermsOfService() {
        await axiosInstance.post(`${PATH_PREFIX}/user/terms-of-service/accept`)
    }

    /**
     * Start (or restart) two-factor auth setup: generates a new TOTP secret
     * server-side and returns it plus a scannable QR code data URL.
     */
    public async setupTwoFactor(): Promise<{ secret: string; qrCodeDataUrl: string }> {
        const response = await axiosInstance.post(`${PATH_PREFIX}/user/2fa/setup`);
        return response.data;
    }

    /**
     * Confirm setup and turn two-factor auth on.
     * @param code 6-digit code from the authenticator app.
     * @returns One-time backup codes, shown to the user exactly once.
     */
    public async enableTwoFactor(code: string): Promise<string[]> {
        const response = await axiosInstance.post(`${PATH_PREFIX}/user/2fa/enable`, {code});
        return response.data.backupCodes;
    }

    /**
     * Turn two-factor auth off.
     * @param password Current account password, required as re-auth.
     */
    public async disableTwoFactor(password: string) {
        await axiosInstance.post(`${PATH_PREFIX}/user/2fa/disable`, {password});
    }

}

/** Singleton instance shared by every part of the app. */
export const userService = new UserService();
