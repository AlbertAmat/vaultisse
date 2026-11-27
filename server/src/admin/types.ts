/** Request augmentation: the admin a request is authenticated as (set by `requireAdmin`). */
import {AdminRole} from "./repositories/AdminUserRepository";

export interface AdminContext {
    id: number;
    email: string;
    name: string;
    role: AdminRole;
    /** The admin must choose a new password before doing anything else. */
    mustChangePassword: boolean;
    sessionId: number;
    /** When the session's fresh password+code verification lapses; null/past = dangerous actions need `/auth/reauth` first. */
    reauthUntil: Date | null;
    /** The password is past its lifetime (see PasswordPolicy): it must be changed before anything else. */
    passwordExpired?: boolean;
    /** When the password expires; null when passwords never expire. */
    passwordExpiresAt?: Date | null;
    /** Whole days left (0 or less once expired); null when passwords never expire. */
    passwordDaysLeft?: number | null;
    /** Inside the warning window (or expired): the console tells the admin. */
    passwordExpiryWarning?: boolean;
}

declare global {
    namespace Express {
        interface Request {
            admin?: AdminContext;
        }
    }
}

export {};
