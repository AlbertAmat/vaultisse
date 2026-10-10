import ICategory from "@/types/category/ICategory";
import ILanguage from "@/types/language/ILanguage";
import {IFormat} from "@/types/format/IFormat";
import ILocation from "@/types/location/ILocation";
import {IUser} from "@/types/user/IUser";
import ICustomer from "@/types/customer/ICustomer";
import {IBorrowingMember} from "@/types/book/IBorrower";
import {AppLabels} from "@/plugins/i18n/AppLabels";

/**
 * Bootstrap payload fetched once after login from `GET /app/policy`: the
 * current user's profile plus every reference list (categories, languages,
 * formats, locations, customers) and UI label translations needed to
 * render the app shell. See `ApplicationService` for how this is loaded
 * and cached client-side.
 */
export default interface IPolicyResponse {
    /** The logged-in user's profile. */
    user: IUser;
    /** Every customer belonging to the user. */
    customers: ICustomer[];
    /** Accepted vault members whose role can borrow (the member half of the borrower picker). */
    borrowingMembers: IBorrowingMember[];
    /** The caller's permissions in their active vault. */
    vaultPermissions: {canBorrow: boolean; canEditCatalog: boolean; canManageMembers: boolean; canManageSettings: boolean};
    /** Every category belonging to the user. */
    categories: ICategory[];
    /** Every language option (global, not user-scoped). */
    languages: ILanguage[];
    /** Every book format option (global, not user-scoped). */
    formats: IFormat[];
    /** Every location belonging to the user. */
    locations: ILocation[];
    /** UI translation strings for the user's language, keyed by `AppLabels`. */
    labels: Record<AppLabels, string>;
    /** Max accepted size, in MB, for a `POST /import/library` upload - see `ImportRoute.ts`. */
    maxImportFileSizeMb: number;
}
