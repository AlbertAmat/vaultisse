// Type definition for a User object coming from the backend
import { IUser } from "@/types/user/IUser";

// Vue's reactive reference utilities
import { ref, Ref } from "vue";

// Service for performing API calls related to the user
import { userService } from "@/service/user/UserService";

// Controller for showing feedback messages (snackbars) to the user
import { appSnackbarController } from "@/components/appSnackbar/AppSnackbarController";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

/**
 * Represents a user of the application and provides methods to
 * access and modify the user's profile data reactively.
 */
export default class User {

    /**
     * Unique immutable user code assigned by the system.
     * @private
     */
    private readonly m_code: string;

    /**
     * User's name stored as a reactive value.
     * @private
     */
    private m_name: Ref<string>;

    /**
     * User's email address stored as a reactive value.
     * @private
     */
    private m_email: Ref<string>;

    /**
     * User's preferred language stored as a reactive value.
     * @private
     */
    private m_language: Ref<string>;

    /**
     * User's region stored as a reactive value.
     * @private
     */
    private m_region: Ref<string>;

    /**
     * Base64 or URL of the user's profile image, if any.
     * Stored as a reactive value to allow UI updates.
     * @private
     */
    private m_image: Ref<string | null>;

    /**
     * UI theme preference ("beige" or "library"). Stored as a reactive
     * value so Settings can reflect a change immediately.
     * @private
     */
    private m_theme: Ref<string>;

    /**
     * Whether the left nav collapses to icon-only "rail" mode (expanding on
     * hover) instead of staying fully expanded. Stored as a reactive value
     * so the nav (AppMenu.vue) reflects a change immediately.
     * @private
     */
    private m_sidebarRail: Ref<boolean>;

    /**
     * Whether the Loans and Customers pages (and their nav items) are
     * shown. Off by default. Stored as a reactive value so the nav
     * (AppMenu.vue) and router (Router.ts) reflect a change immediately.
     * @private
     */
    private m_leasingEnabled: Ref<boolean>;

    /**
     * Whether this account belongs to a public institution (e.g. a school).
     * Set by an administrator directly in the database — not editable from the app.
     * @private
     */
    private readonly m_isPublicInstitution: boolean;

    /**
     * Whether this account has acknowledged the security-measures notice
     * (see SecurityNoticeDialog.vue). Stored as a reactive value so the
     * dialog hides itself immediately after `acceptSecurityNotice()`.
     * @private
     */
    private m_securityNoticeAccepted: Ref<boolean>;

    /**
     * Whether this account has accepted the Terms of Service (see
     * TermsOfServiceDialog.vue). Stored as a reactive value so the dialog
     * hides itself immediately after `acceptTermsOfService()`. Required
     * from every account, unlike `m_securityNoticeAccepted`.
     * @private
     */
    private m_termsOfServiceAccepted: Ref<boolean>;

    /**
     * Whether two-factor authentication (TOTP) is enabled for this account.
     * Stored as a reactive value so the settings view updates immediately
     * after enabling/disabling (see TwoFactorSetupDialog.vue / TwoFactorDisableDialog.vue).
     * @private
     */
    private m_totpEnabled: Ref<boolean>;

    /**
     * Initializes a User instance with data from the backend.
     * @param data - IUser object containing initial user information.
     */
    public constructor(data: IUser) {
        this.m_code = data.code;
        this.m_email = ref(data.email);
        this.m_name = ref(data.name);
        this.m_language = ref(data.language);
        this.m_region = ref(data.region);
        this.m_image = ref(data.image);
        this.m_theme = ref(data.theme);
        this.m_sidebarRail = ref(data.sidebarRail);
        this.m_leasingEnabled = ref(data.leasingEnabled);
        this.m_isPublicInstitution = data.isPublicInstitution;
        this.m_securityNoticeAccepted = ref(data.securityNoticeAccepted);
        this.m_termsOfServiceAccepted = ref(data.termsOfServiceAccepted);
        this.m_totpEnabled = ref(data.totpEnabled);
    }

    /**
     * Returns the immutable user code.
     */
    public getCode(): string {
        return this.m_code;
    }

    /**
     * Returns the current email address.
     */
    public getEmail(): string {
        return this.m_email.value;
    }

    /**
     * Returns the current display name of the user.
     */
    public getName(): string {
        return this.m_name.value;
    }

    /**
     * Returns the user's preferred language.
     */
    public getLanguage(): string {
        return this.m_language.value;
    }

    /**
     * Returns the user's region.
     */
    public getRegion(): string {
        return this.m_region.value;
    }

    /**
     * Returns the current profile image as a Base64 string or URL.
     */
    public getImage(): string | null {
        return this.m_image.value;
    }

    /**
     * Checks if the user has an associated profile image.
     */
    public hasImage(): boolean {
        return this.m_image.value != null;
    }

    /**
     * Returns the current UI theme preference ("beige" or "library").
     */
    public getTheme(): string {
        return this.m_theme.value;
    }

    /**
     * Persists a new UI theme preference and updates the local reactive
     * value on success. The caller (SettingsView) applies the theme
     * immediately client-side rather than waiting on this to resolve.
     * @param theme "beige" or "library".
     */
    public async setTheme(theme: string) {
        try {
            await userService.updateTheme(theme);
            this.m_theme.value = theme;
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_APPEARANCE_UPDATED)});
        } catch (e) {
            console.error("Error while updating theme: ", e);
        }
    }

    /**
     * Returns whether the left nav collapses to icon-only "rail" mode
     * (expanding on hover) instead of staying fully expanded.
     */
    public isSidebarRail(): boolean {
        return this.m_sidebarRail.value;
    }

    /**
     * Persists a new left-nav rail-mode preference and updates the local
     * reactive value on success. The caller (SettingsView) applies it
     * immediately client-side rather than waiting on this to resolve.
     * @param sidebarRail Whether rail mode is enabled.
     */
    public async setSidebarRail(sidebarRail: boolean) {
        try {
            await userService.updateSidebarRail(sidebarRail);
            this.m_sidebarRail.value = sidebarRail;
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_APPEARANCE_UPDATED)});
        } catch (e) {
            console.error("Error while updating sidebar rail preference: ", e);
        }
    }

    /**
     * Returns whether the Loans and Customers pages (and their nav items)
     * are shown.
     */
    public isLeasingEnabled(): boolean {
        return this.m_leasingEnabled.value;
    }

    /**
     * Persists a new leasing preference and updates the local reactive
     * value on success. The caller (SettingsView) applies it immediately
     * client-side rather than waiting on this to resolve.
     * @param leasingEnabled Whether leasing is enabled.
     */
    public async setLeasingEnabled(leasingEnabled: boolean) {
        try {
            await userService.updateLeasingEnabled(leasingEnabled);
            this.m_leasingEnabled.value = leasingEnabled;
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_LEASING_UPDATED)});
        } catch (e) {
            console.error("Error while updating leasing preference: ", e);
        }
    }

    /**
     * Returns true if this account is registered as a public institution
     * (e.g. a school), in which case customer/group data may include
     * students and should avoid storing sensitive personal information.
     */
    public isPublicInstitution(): boolean {
        return this.m_isPublicInstitution;
    }

    /**
     * Returns true once this account has acknowledged the security-measures
     * notice. Meaningless for accounts where `isPublicInstitution()` is
     * false - see SecurityNoticeDialog.vue for how the two are combined.
     */
    public hasAcceptedSecurityNotice(): boolean {
        return this.m_securityNoticeAccepted.value;
    }

    /**
     * Returns true once this account has accepted the Terms of Service -
     * see TermsOfServiceDialog.vue. Required from every account.
     */
    public hasAcceptedTermsOfService(): boolean {
        return this.m_termsOfServiceAccepted.value;
    }

    /**
     * Returns true if two-factor authentication is currently enabled.
     */
    public isTotpEnabled(): boolean {
        return this.m_totpEnabled.value;
    }

    /**
     * Updates the local reactive two-factor-auth flag. The enable/disable
     * network calls themselves live in TwoFactorSetupDialog.vue and
     * TwoFactorDisableDialog.vue (they need inline error display on
     * failure, same as ChangePasswordDialog.vue) - this is only called
     * once one of those actually succeeds.
     * @param enabled
     */
    public setTotpEnabled(enabled: boolean) {
        this.m_totpEnabled.value = enabled;
    }

    /**
     * Acknowledges the security-measures notice, persisting it server-side
     * so the dialog doesn't show again for this user.
     */
    public async acceptSecurityNotice() {
        try {
            await userService.acceptSecurityNotice();
            this.m_securityNoticeAccepted.value = true;
        } catch (e) {
            console.error("Error while accepting security notice: ", e);
        }
    }

    /**
     * Accepts the Terms of Service, persisting it server-side so the
     * dialog doesn't show again for this user.
     */
    public async acceptTermsOfService() {
        try {
            await userService.acceptTermsOfService();
            this.m_termsOfServiceAccepted.value = true;
        } catch (e) {
            console.error("Error while accepting terms of service: ", e);
        }
    }

    /**
     * Updates the user's profile information and shows a success snackbar.
     * On success, it updates the reactive properties locally.
     * @param name - New name of the user
     * @param email - New email address
     * @param language - New preferred language
     * @param region - New region
     * @param currentPassword - Current password, required only when `email` differs from the stored one (server-enforced, see PUT /user)
     */
    public async update(name: string, email: string, language: string, region: string, currentPassword?: string) {
        try {
            await userService.update(name, email, language, region, currentPassword);
            appSnackbarController.show({ message: i18n.global.t(AppLabels.SNACKBAR_PROFILE_UPDATED) });
            this.m_email.value = email;
            this.m_name.value = name;
            this.m_language.value = language;
            this.m_region.value = region;
        } catch (e) {
            console.error("Error while updating user profile: ", e);
        }
    }

    /**
     * Removes the current profile image, updates local state,
     * and shows a success snackbar.
     */
    public async removeImage() {
        try {
            await userService.removeImage();
            this.m_image.value = null;
            appSnackbarController.show({ message: i18n.global.t(AppLabels.SNACKBAR_PROFILE_IMAGE_DELETED)});
        } catch (e) {
            console.error("Error while removing image: ", e);
        }
    }

    /**
     * Uploads a new profile image, updates the local reactive image
     * with a Base64 preview, and shows a success snackbar.
     * @param image - The image file to upload.
     */
    public async uploadImage(image: File) {
        try {
            await userService.uploadImage(image);
            const base64 = await this.__toBase64(image);
            this.m_image.value = base64;
            appSnackbarController.show({ message: i18n.global.t(AppLabels.SNACKBAR_PROFILE_IMAGE_UPDATED) });
        } catch (e) {
            console.error("Error while uploading image: ", e);
        }
    }

    /**
     * Converts a File object to a Base64-encoded string.
     * @param file - File to convert.
     * @returns Promise that resolves to a Base64 string or null if an error occurs.
     * @private
     */
    private __toBase64(file: File): Promise<string | null> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file); // Convert file to Base64 data URL
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(null);
        });
    }
}