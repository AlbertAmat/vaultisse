import {UserProfile} from "./user";

export interface AppPolicyCategory {
    id: number;
    name: string;
}

export interface AppPolicyCustomer {
    id: number;
    name: string;
}

/** A vault member with borrow permission - the vault-member half of the borrower picker. */
export interface AppPolicyBorrowingMember {
    id: number;
    name: string;
}

export interface AppPolicyLanguage {
    code: string;
    name: string;
}

export interface AppPolicyFormat {
    id: number;
    name: string;
}

export interface AppPolicyLocation {
    id: number;
    name: string;
    description: string | null;
    default: boolean;
}

/** The caller's permissions in their active vault, so the UI can hide actions the server would reject. */
export interface AppPolicyVaultPermissions {
    canBorrow: boolean;
    canEditCatalog: boolean;
    canManageMembers: boolean;
    canManageSettings: boolean;
}

export interface AppPolicy {
    user: UserProfile;
    categories: AppPolicyCategory[];
    languages: AppPolicyLanguage[];
    formats: AppPolicyFormat[];
    locations: AppPolicyLocation[];
    customers: AppPolicyCustomer[];
    borrowingMembers: AppPolicyBorrowingMember[];
    vaultPermissions: AppPolicyVaultPermissions;
    labels: Record<string, string>;
    maxImportFileSizeMb: number;
}
