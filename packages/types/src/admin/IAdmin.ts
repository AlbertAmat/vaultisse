/**
 * Wire types of the admin portal API (`/api/admin/*`, see server/src/admin/). Dates arrive as ISO strings.
 * Everything here is metadata about the installation: there is deliberately no type for a vault's content.
 */

export type AdminRole = "superadmin" | "readonly";

export interface IAdminSelf {
    id: number;
    email: string;
    name: string;
    role: AdminRole;
    /** Until when dangerous actions are unlocked by a fresh password + code check; null when locked. */
    reauthUntil: string | null;
}

export interface IAdminUser {
    id: number;
    email: string;
    name: string;
    role: AdminRole;
    disabled: boolean;
    totpEnabled: boolean;
    createdDate: string;
    lastLoginDate: string | null;
}

export interface IPaged<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
}

// --- Login ---------------------------------------------------------------------------------------

/** What the second login step is: enter a code, or set two-factor up first. */
export type AdminLoginStep = "totp" | "enroll";

export interface IEnrollStart {
    secret: string;
    otpauthUrl: string;
    /** PNG data URL of the QR code. */
    qrCode: string;
}

export interface IEnrollConfirm {
    admin: Pick<IAdminSelf, "id" | "email" | "name" | "role">;
    /** One-time backup codes, shown once. */
    backupCodes: string[];
}

// --- Settings ------------------------------------------------------------------------------------

export type SettingType = "string" | "number" | "boolean" | "secret" | "select";
export type SettingSource = "database" | "env" | "default";

export interface ISetting {
    /** The env var name this setting overrides. */
    key: string;
    label: string;
    description: string;
    type: SettingType;
    options: string[] | null;
    /** Current value; always null for secrets, which are never sent back. */
    value: string | null;
    isSet: boolean;
    source: SettingSource;
    defaultValue: string | null;
    /** A stored secret that can't be decrypted any more (the encryption key changed): enter it again. */
    unreadable: boolean;
}

export interface ISettingGroup {
    id: string;
    label: string;
    description: string;
    items: ISetting[];
}

/** A string sets the value, `null` goes back to the env var / default. */
export type SettingChanges = Record<string, string | null>;

export interface ISystemInfo {
    /** This installation's permanent random id. */
    instanceUuid: string;
    version: string;
    node: string;
    uptimeSeconds: number;
    database: "ok" | "unreachable";
    databaseLatencyMs: number;
    memoryMb: number;
    bootstrap: {
        apiPort: number | null;
        adminPort: number;
        adminUrl: string | null;
        adminAllowedIps: number;
        frontEndUrl: string | null;
        trustProxy: boolean;
        allowHttp: boolean;
        demoMode: boolean;
        debugLogging: boolean;
        encryptionKeySeparate: boolean;
    };
    features: {mail: boolean; sso: boolean; registration: boolean; approvalRequired: boolean};
}

// --- Overview ------------------------------------------------------------------------------------

export interface IOverview {
    counts: {
        users: number; usersPending: number; usersDisabled: number; usersUnverified: number; usersWithTwoFactor: number; usersSso: number;
        activeNow: number; activeDay: number; activeWeek: number; activeMonth: number; signupsWeek: number;
        vaults: number; vaultsSuspended: number; vaultsShared: number;
        books: number; stocks: number; fileBytes: number; pendingDeletions: number;
    };
    signups: {day: string; count: number}[];
    logins: {day: string; count: number}[];
}

// --- Accounts ------------------------------------------------------------------------------------

export type UserStatus = "active" | "pending" | "disabled" | "pending_deletion" | "unverified";

export interface IAccount {
    id: number;
    code: string;
    name: string;
    email: string;
    disabled: boolean;
    /** 'pending_approval' | 'pending_deletion' | 'admin' | null */
    disabledReason: string | null;
    emailVerified: boolean;
    totpEnabled: boolean;
    sso: boolean;
    createdDate: string | null;
    lastLoginDate: string | null;
    lastActivityDate: string | null;
    vaultCount: number;
    deletionScheduledFor: string | null;
}

export interface IAccountMembership {
    vaultId: number;
    vaultName: string;
    role: string;
    /** 0 pending, 1 accepted, 2 rejected */
    status: number;
    suspended: boolean;
}

export interface IActivityEntry {
    id: number;
    actorId: number | null;
    actorCode: string | null;
    action: string;
    metadata: Record<string, unknown>;
    createdDate: string;
}

export interface IAccountDetail {
    user: IAccount;
    memberships: IAccountMembership[];
    sessionCount: number;
    recentActivity: IActivityEntry[];
}

export interface IAdminVault {
    id: number;
    name: string;
    description: string | null;
    createdDate: string | null;
    loansEnabled: boolean;
    suspendedAt: string | null;
    /** 'pending_deletion' | 'admin' | null */
    suspendedReason: string | null;
    planId: number | null;
    planName: string | null;
    memberCount: number;
    admins: string[];
    bookCount: number;
    stockCount: number;
    storageBytes: number;
    deletionScheduledFor: string | null;
}

export interface IVaultMember {
    userId: number;
    code: string;
    name: string;
    role: string;
    status: number;
}

export interface IPlan {
    id: number;
    code: string;
    name: string;
    maxBooks: number | null;
    maxMembers: number | null;
    maxStorageMb: number | null;
    isDefault: boolean;
    vaultCount: number;
}

export interface IPlanInput {
    code?: string;
    name: string;
    maxBooks: number | null;
    maxMembers: number | null;
    maxStorageMb: number | null;
}

export interface IVaultDetail {
    vault: IAdminVault;
    members: IVaultMember[];
    usage: {books: number; members: number; storageBytes: number};
    plan: IPlan | null;
}

export interface IScheduledDeletion {
    id: number;
    entityType: "user" | "vault";
    entityId: number;
    entityLabel: string;
    requestedBy: string | null;
    requestedAt: string;
    executeAfter: string;
    cancelledAt: string | null;
    executedAt: string | null;
    lastError: string | null;
}

export interface IDeletionRequestResult {
    deletionId: number;
    /** True when it was carried out right away; false when it waits for its grace period. */
    executed: boolean;
    executeAfter: string;
}

// --- Security ------------------------------------------------------------------------------------

export type SecurityEventType = "rate_limited" | "login_failed" | "login_locked" | "admin_login_failed" | "blocked_ip_hit";

export interface ISecuritySummary {
    events24h: {type: SecurityEventType; total: number; ips: number}[];
    lockedAccounts: number;
    blockedIps: number;
    lastHour: {total: number; clientErrors: number; serverErrors: number; rateLimited: number};
}

export interface ITrafficPoint {
    minute: string;
    total: number;
    clientErrors: number;
    serverErrors: number;
    rateLimited: number;
}

export interface ITraffic {
    series: ITrafficPoint[];
    topIps: {ipAddress: string; requests: number}[];
}

export interface ISecurityEvent {
    type: SecurityEventType;
    ipAddress: string;
    bucket: string;
    count: number;
    userAgent: string | null;
    lastPath: string | null;
    detail: string | null;
}

export interface ITopIp {
    ipAddress: string;
    total: number;
    types: string[];
}

export interface ILockout {
    userId: number;
    code: string;
    email: string;
    failedLoginCount: number;
    lockoutUntil: string | null;
    totpLockoutUntil: string | null;
}

export interface IBlockedIp {
    ipAddress: string;
    reason: string | null;
    blockedBy: string | null;
    createdDate: string;
    expiresAt: string | null;
}

export interface IUserSession {
    id: number;
    userId: number;
    userCode: string;
    userAgent: string | null;
    ipAddress: string | null;
    createdDate: string;
    lastSeenDate: string;
}

// --- Logs ----------------------------------------------------------------------------------------

export interface IAuditEntry {
    id: number;
    adminId: number | null;
    adminEmail: string | null;
    action: string;
    entityType: string | null;
    entityId: number | null;
    entityLabel: string | null;
    metadata: Record<string, unknown>;
    ipAddress: string | null;
    createdDate: string;
}

export interface IMailEntry {
    id: number;
    toAddress: string;
    subject: string;
    status: "sent" | "failed";
    error: string | null;
    createdDate: string;
}

export interface IServerLog {
    lines: string[];
    scannedLines: number;
}
