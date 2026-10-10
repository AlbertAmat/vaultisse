import {Pool} from "pg";
import {AppRepository} from "../repositories/AppRepository";
import {UserRepository} from "../repositories/UserRepository";
import {VaultRepository} from "../repositories/VaultRepository";
import {AppPolicy, AppPolicyBorrowingMember, AppPolicyCategory, AppPolicyCustomer, AppPolicyFormat, AppPolicyLanguage, AppPolicyLocation, AppPolicyVaultPermissions} from "../types/app";

/**
 * Business logic for the Policy resource: builds the bootstrap payload
 * fetched once after login. Named `PolicyService` rather than `AppService`
 * to avoid colliding with the pre-existing `AppService.ts` (the Express
 * app/config singleton class).
 */
export class PolicyService {
    /**
     * @param pool Database connection pool, forwarded to a fresh AppRepository on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Builds the bootstrap payload: the current user's profile plus every
     * reference list (categories, languages, formats, locations, customers)
     * and UI label translations needed to render the app. Each section is
     * fetched independently and defaults to `[]`/`{}` on failure so one
     * failing query doesn't take down the whole app shell.
     *
     * The catalog reference lists (categories/locations/customers) are
     * scoped to the caller's active vault (issue #7), not to the user
     * directly - `vaultId` may be undefined for a user with no active vault
     * (shouldn't happen outside test setup races), in which case those
     * lists are simply left empty rather than erroring.
     *
     * @param userId Owning user's id - used only for the profile/labels/notice-acknowledgement bookkeeping below, which stays per-account.
     * @param vaultId Caller's active vault id, or undefined if they have none.
     * @param maxImportFileSizeMb Configured import-file size cap, passed through into the payload as-is.
     * @returns The full policy payload.
     */
    public async getPolicy(userId: number, vaultId: number | undefined, maxImportFileSizeMb: number): Promise<AppPolicy> {
        const repo = new AppRepository(this.pool);

        let categories: AppPolicyCategory[] = [];
        let languages: AppPolicyLanguage[] = [];
        let formats: AppPolicyFormat[] = [];
        let locations: AppPolicyLocation[] = [];
        let customers: AppPolicyCustomer[] = [];
        let borrowingMembers: AppPolicyBorrowingMember[] = [];
        let labels: Record<string, string> = {};
        // Fail closed: no membership found means no permissions.
        let vaultPermissions: AppPolicyVaultPermissions = {canBorrow: false, canEditCatalog: false, canManageMembers: false, canManageSettings: false};

        try {
            if (vaultId !== undefined) {
                const membership = await new VaultRepository(this.pool).getMembership(vaultId, userId);
                if (membership) {
                    vaultPermissions = {
                        canBorrow: membership.can_borrow,
                        canEditCatalog: membership.can_edit_catalog,
                        canManageMembers: membership.can_manage_members,
                        canManageSettings: membership.can_manage_settings,
                    };
                }
            }
        } catch (e) {
            console.error("Error when getting vault permissions. ", e);
        }

        try {
            if (vaultId !== undefined) {
                categories = await repo.getCategoryNames(vaultId);
            }
        } catch (e) {
            console.error("Error when getting categories. ", e);
        }

        try {
            languages = await repo.getLanguages();
        } catch (e) {
            console.error("Error when getting languages. ", e);
        }

        try {
            formats = await repo.getFormats();
        } catch (e) {
            console.error("Error when getting formats. ", e);
        }

        try {
            if (vaultId !== undefined) {
                locations = await repo.getLocationSummaries(vaultId);
            }
        } catch (e) {
            console.error("Error when getting locations. ", e);
        }

        try {
            if (vaultId !== undefined) {
                customers = await repo.getCustomerNames(vaultId);
            }
        } catch (e) {
            console.error("Error when getting customers. ", e);
        }

        try {
            if (vaultId !== undefined) {
                borrowingMembers = await new VaultRepository(this.pool).listBorrowingMembers(vaultId);
            }
        } catch (e) {
            console.error("Error when getting borrowing members. ", e);
        }

        // Who else borrows what is for the people running the library; a plain
        // borrower only ever sees their own loans, so they get no borrower lists.
        if (!vaultPermissions.canEditCatalog) {
            customers = [];
            borrowingMembers = [];
        }

        try {
            labels = await repo.getAppLabels(userId);
        } catch (e) {
            console.error("Error when getting app labels. ", e);
        }

        const userRepo = new UserRepository(this.pool);
        const user = await userRepo.getProfile(userId);

        // Public-institution accounts get a persistent security-measures notice
        // after login until they acknowledge it (see SecurityNoticeDialog.vue).
        // Record that it was sent the first time it's actually going to be
        // shown; recordSecurityNoticeSent is a no-op on every later fetch.
        if (user.isPublicInstitution && !user.securityNoticeAccepted) {
            try {
                await userRepo.recordSecurityNoticeSent(userId);
            } catch (e) {
                console.error("Error recording security notice sent date. ", e);
            }
        }

        // Every account, regardless of isPublicInstitution, must accept the
        // Terms of Service once (see TermsOfServiceDialog.vue). Same
        // record-on-first-serve pattern as the security notice above.
        if (!user.termsOfServiceAccepted) {
            try {
                await userRepo.recordTermsOfServiceSent(userId);
            } catch (e) {
                console.error("Error recording terms of service sent date. ", e);
            }
        }

        return {
            user,
            categories,
            languages,
            formats,
            locations,
            customers,
            borrowingMembers,
            vaultPermissions,
            labels,
            maxImportFileSizeMb,
        };
    }
}
