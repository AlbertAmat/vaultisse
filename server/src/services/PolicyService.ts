import {Pool} from "pg";
import {AppRepository} from "../repositories/AppRepository";
import {UserRepository} from "../repositories/UserRepository";
import {AppPolicy, AppPolicyCategory, AppPolicyCustomer, AppPolicyFormat, AppPolicyLanguage, AppPolicyLocation} from "../types/app";

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
        let labels: Record<string, string> = {};

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
            labels,
            maxImportFileSizeMb,
        };
    }
}
