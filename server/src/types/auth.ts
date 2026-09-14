export interface LoginCandidate {
    id: number;
    code: string;
    password: string;
    tokenVersion: number;
    totpEnabled: boolean;
}

export interface PendingTwoFactorUser {
    id: number;
    tokenVersion: number;
    totpSecret: string;
}

export interface BackupCode {
    id: number;
    codeHash: string;
}

export interface NewUserFields {
    name: string;
    code: string;
    email: string;
    passwordHash: string;
    disabled: boolean;
}

/** Minimal shape needed to mint a session token/cookie after any login path (password, 2FA, or OIDC). */
export interface ResolvedAuthUser {
    id: number;
    tokenVersion: number;
}
