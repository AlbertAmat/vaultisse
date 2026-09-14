import {UserProfile} from "./user";

export interface AppPolicyCategory {
    id: number;
    name: string;
}

export interface AppPolicyCustomer {
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

export interface AppPolicy {
    user: UserProfile;
    categories: AppPolicyCategory[];
    languages: AppPolicyLanguage[];
    formats: AppPolicyFormat[];
    locations: AppPolicyLocation[];
    customers: AppPolicyCustomer[];
    labels: Record<string, string>;
    maxImportFileSizeMb: number;
}
