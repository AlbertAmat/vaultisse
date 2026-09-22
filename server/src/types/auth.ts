export interface LoginCandidate {
    id: number;
    code: string;
    password: string;
    tokenVersion: number;
    totpEnabled: boolean;
    /** Consecutive wrong-password count (security audit #5) - see AuthService.login. */
    failedLoginCount: number;
    /** Set once failedLoginCount crosses the threshold; login is rejected while this is in the future. */
    lockoutUntil: Date | null;
}

export interface PendingTwoFactorUser {
    id: number;
    tokenVersion: number;
    totpSecret: string;
    /** Consecutive wrong-2FA-code count for this account (security audit #5) - see AuthService.completeTwoFactorLogin. */
    totpFailedCount: number;
    /** Set once totpFailedCount crosses the threshold; the 2FA step is rejected while this is in the future. */
    totpLockoutUntil: Date | null;
    /** Absolute TOTP time-step of the last code accepted, for replay protection - see TwoFactorAuth.ts. */
    totpLastUsedStep: number | null;
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
