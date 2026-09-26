/**
 * The current user's profile, as returned inside `IPolicyResponse.user`
 * (`GET /app/policy`) and updated via `PUT /user`.
 *
 * @example
 * const u: IUser = {
 *   code: "jdoe", name: "Jane Doe", email: "jane@example.com",
 *   language: "en", region: "US", image: null, isPublicInstitution: false,
 *   securityNoticeAccepted: false, termsOfServiceAccepted: false
 * };
 */
export interface IUser {
    /** Numeric account id - matches `vault_users.user_id` for telling a caller's own row apart from other vault members (see VaultsCard.vue). */
    id: number;
    /** Unique immutable login code. */
    code: string;
    /** Display name. */
    name: string;
    /** Email address. */
    email: string;
    /** Preferred UI language (2-letter code). */
    language: string;
    /** Preferred region code. */
    region: string;
    /** UI theme preference: "beige" (warm/light) or "library" (dark/blue). */
    theme: string;
    /** Whether the left nav collapses to icon-only "rail" mode (expanding on hover). Off by default. */
    sidebarRail: boolean;
    /** Whether the Loans and Customers pages (and their nav items) are shown. Off by default. */
    leasingEnabled: boolean;
    /** Base64 data-URI of the profile picture, or null if unset. */
    image: string | null;
    /** Whether this account belongs to a public institution (e.g. a school). */
    isPublicInstitution: boolean;
    /** Whether two-factor authentication (TOTP) is enabled for this account. */
    totpEnabled: boolean;
    /**
     * Whether this account has acknowledged the security-measures notice
     * (see SecurityNoticeDialog.vue). Always `false` for accounts where
     * `isPublicInstitution` is `false` - the dialog only applies to
     * public-institution accounts.
     */
    securityNoticeAccepted: boolean;
    /**
     * Whether this account has accepted the Terms of Service (see
     * TermsOfServiceDialog.vue). Required from every account, unlike
     * `securityNoticeAccepted`.
     */
    termsOfServiceAccepted: boolean;
    /**
     * The vault (shared library, issue #7) this account last worked in -
     * loaded on login, and what every catalog resource (books, categories,
     * etc.) is scoped to server-side. See VaultsCard.vue for switching it.
     */
    activeVault: number;
}
