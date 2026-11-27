/** Request augmentation: the admin a request is authenticated as (set by `requireAdmin`). */
import {AdminRole} from "./repositories/AdminUserRepository";

export interface AdminContext {
    id: number;
    email: string;
    name: string;
    role: AdminRole;
    sessionId: number;
    /** When the session's fresh password+code verification lapses; null/past = dangerous actions need `/auth/reauth` first. */
    reauthUntil: Date | null;
}

declare global {
    namespace Express {
        interface Request {
            admin?: AdminContext;
        }
    }
}

export {};
