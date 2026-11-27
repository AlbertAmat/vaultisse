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
    /** The admin must choose a new password before anything else (generated first admin, or created by another admin). */
    mustChangePassword: boolean;
    /** Until when dangerous actions are unlocked by a fresh password + code check; null when locked. */
    reauthUntil: string | null;
}

export interface IAdminUser {
    id: number;
    email: string;
    name: string;
    role: AdminRole;
    disabled: boolean;
    mustChangePassword: boolean;
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
    /** Whether the key can be tested against its provider (`POST /settings/test-key`). */
    testable: boolean;
    /** The environment variable is also set; it is ignored while a value is saved in the console. */
    envSet: boolean;
    /** The env var's value; null when not set, and always null for secrets. */
    envValue: string | null;
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
    /** Private labels admins put on the account. */
    tags: string[];
    noteCount: number;
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
    notes: IAccountNote[];
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
    /** Blocked by the portal itself after too many failed logins. */
    automatic: boolean;
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

// --- System ------------------------------------------------------------------------------------------

export interface IVersionStatus {
    installed: string;
    /** A build that isn't a release (no version number). */
    isDevBuild: boolean;
    checkEnabled: boolean;
    latest: string | null;
    /** Null when it can't be told (check off, failed, or a development build). */
    updateAvailable: boolean | null;
    releaseUrl: string | null;
    publishedAt: string | null;
    checkedAt: string | null;
    error: string | null;
}

export interface IDatabaseInfo {
    status: "ok" | "warning" | "down";
    problems: string[];
    /** How this server was told to connect (from its environment). */
    connection: {mode: "tcp" | "socket"; host: string | null; port: number | null; name: string | null; user: string | null};
    /** What the database itself reports. */
    server: {address: string | null; port: number | null; version: string | null; startedAt: string | null; uptimeSeconds: number | null} | null;
    latencyMs: number | null;
    sizeBytes: number | null;
    connections: {current: number; max: number; poolTotal: number; poolIdle: number; poolWaiting: number} | null;
    largestTables: {name: string; bytes: number; rows: number}[];
}

export interface IMigration {
    filename: string;
    appliedAt: string;
}

export interface ISystemDetails {
    instanceUuid: string;
    version: IVersionStatus;
    database: IDatabaseInfo;
    migrations: {items: IMigration[]; total: number};
    runtime: {node: string; platform: string; arch: string; hostname: string; uptimeSeconds: number; memoryMb: number; environment: string; inDocker: boolean};
}

// --- Notifications ----------------------------------------------------------------------------------

export interface INotificationRecipient {
    id: number;
    email: string;
    name: string;
    role: AdminRole;
    disabled: boolean;
    notifyEmail: boolean;
}

export interface INotificationsOverview {
    mailEnabled: boolean;
    /** The signed-in admin's id. */
    me: number;
    recipients: INotificationRecipient[];
}

export interface INotificationEntry {
    id: number;
    type: string;
    subject: string;
    recipients: number;
    status: "sent" | "failed" | "skipped";
    detail: string | null;
    createdDate: string;
}

export interface IOnboardingStatus {
    completed: boolean;
    completedAt: string | null;
}

// --- Announcements and maintenance ---------------------------------------------------------------------

export type AnnouncementLevel = "info" | "warning" | "critical";

export interface IAnnouncement {
    id: number;
    message: string;
    level: AnnouncementLevel;
    startsAt: string;
    endsAt: string | null;
    enabled: boolean;
    createdBy: string | null;
    createdDate: string;
    /** Where it stands right now. */
    state: "active" | "scheduled" | "expired" | "off";
}

export interface IMaintenance {
    enabled: boolean;
    message: string;
    since: string | null;
}

/** What the app shows its users (`GET /api/rest/app/notice`, public). */
export interface IPublicNotice {
    announcements: {id: number; message: string; level: AnnouncementLevel}[];
    maintenance: {message: string} | null;
}

// --- Broadcast email -------------------------------------------------------------------------------------

export type BroadcastAudience = "all" | "vault_admins" | "active_30" | "no_two_factor";

export interface IBroadcastAudience {
    value: BroadcastAudience;
    label: string;
    description: string;
    count: number;
}

export interface IBroadcastPreview {
    count: number;
    /** A few recipients, masked. */
    sample: string[];
    /** The email as it will read, with the admin's own name for `{name}`. */
    email: {subject: string; text: string};
    mailEnabled: boolean;
}

export interface IBroadcast {
    id: number;
    subject: string;
    body: string;
    audience: string;
    recipients: number;
    sent: number;
    failed: number;
    status: "sending" | "done" | "cancelled" | "interrupted";
    createdBy: string | null;
    createdDate: string;
    finishedAt: string | null;
}

// --- Inactive accounts -------------------------------------------------------------------------------------

export type InactivityStatus = "due" | "warned" | "to_warn" | "upcoming";

export interface IInactiveAccount {
    id: number;
    code: string;
    name: string;
    email: string;
    lastActivity: string;
    warnedAt: string | null;
    status: InactivityStatus;
    warnOn: string | null;
    deleteOn: string;
}

export interface IInactivityPreview {
    enabled: boolean;
    configuredDays: number | null;
    /** The period used: the configured one, or the simulated one. */
    inactivityDays: number | null;
    noticeDays: number;
    mailEnabled: boolean;
    simulated: boolean;
    horizonDays: number;
    items: IInactiveAccount[];
    counts: {due: number; warned: number; toWarn: number; upcoming: number};
}

// --- Bulk actions -----------------------------------------------------------------------------------------

export type BulkAccountAction = "approve" | "disable" | "enable" | "force-logout" | "delete";

export interface IBulkResult {
    results: {id: number; code: string | null; ok: boolean; message: string}[];
    ok: number;
    failed: number;
}

// --- Terms acceptance ---------------------------------------------------------------------------------------

export type TermsDocument = "tos" | "security";
export type TermsStatus = "accepted" | "pending" | "never";

export interface ITermsCounts {
    accepted: number;
    pending: number;
    never: number;
    total: number;
}

export interface ITermsRow {
    id: number;
    code: string;
    name: string;
    email: string;
    disabled: boolean;
    askedDate: string | null;
    acceptedDate: string | null;
    status: TermsStatus;
}

// ---- Login map ----

export interface IMapPoint {
    lat: number;
    lon: number;
    city: string;
    region: string;
    /** ISO 3166-1 alpha-2. */
    country: string;
    logins: number;
    accounts: number;
    failed: number;
    addresses: number;
    lastLogin: string | null;
}

export interface ILoginMap {
    /** False when the offline location database couldn't be loaded. */
    available: boolean;
    days: number;
    points: IMapPoint[];
    countries: {country: string; logins: number; failed: number}[];
    totals: {logins: number; failed: number; located: number; unlocated: number; truncated: boolean};
}

// ---- Compliance ----

export type ControlOutcome = "compliant" | "partial" | "gap" | "planned" | "not_assessed" | "not_applicable";
export type ControlStatus = "implemented" | "partial" | "planned" | "not_applicable";
export type RegisterKind = "policy" | "supplier" | "risk" | "asset";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "contained" | "resolved" | "closed";

export interface IControlRecord {
    controlId: string;
    status: ControlStatus | null;
    owner: string | null;
    justification: string | null;
    evidenceUrl: string | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
    nextReviewAt: string | null;
}

export interface IControl {
    id: string;
    title: string;
    area: "Organisational" | "People" | "Physical" | "Technological";
    summary: string;
    howTo: string;
    refs: {iso: string; gdpr?: string; soc2?: string};
    measured: {state: "pass" | "warn" | "fail"; detail: string} | null;
    record: IControlRecord | null;
    outcome: ControlOutcome;
    reviewOverdue: boolean;
}

export interface IComplianceOverview {
    generatedAt: string;
    score: number;
    counts: Record<ControlOutcome, number>;
    controls: IControl[];
    attention: {kind: string; text: string; link: string}[];
}

export interface IControlInput {
    status: ControlStatus | null;
    owner: string | null;
    justification: string | null;
    evidenceUrl: string | null;
    nextReviewAt: string | null;
    /** Stamp the control as reviewed now. */
    reviewed: boolean;
}

export interface IRegisterEntry {
    id: number;
    kind: RegisterKind;
    title: string;
    owner: string | null;
    status: "draft" | "active" | "retired";
    rating: "low" | "medium" | "high" | null;
    version: string | null;
    details: string | null;
    referenceUrl: string | null;
    approvedAt: string | null;
    nextReviewAt: string | null;
    updatedDate: string;
}

export type IRegisterInput = Omit<IRegisterEntry, "id" | "updatedDate">;

export interface IIncident {
    id: number;
    title: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    detectedAt: string;
    resolvedAt: string | null;
    description: string | null;
    actions: string | null;
    lessons: string | null;
    personalData: boolean;
    authorityNotifiedAt: string | null;
    usersNotifiedAt: string | null;
    createdBy: string | null;
}

export type IIncidentInput = Omit<IIncident, "id" | "createdBy">;

export interface IAccessReview {
    id: number;
    email: string;
    name: string;
    role: string;
    disabled: boolean;
    lastLoginDate: string | null;
    accessReviewedAt: string | null;
    reviewedBy: string | null;
}

// ---- Overview charts ----

export interface IChartsData {
    days: number;
    accountStatus: {active: number; pending: number; disabled: number; unverified: number};
    plans: {name: string; vaults: number}[];
    topByStorage: {id: number; name: string; books: number; bytes: number}[];
    topByBooks: {id: number; name: string; books: number; bytes: number}[];
    growth: {day: string; added: number; total: number}[];
    signups: {day: string; count: number}[];
    logins: {day: string; count: number}[];
    failedLogins: {day: string; users: number; admins: number}[];
    emails: {day: string; sent: number; failed: number}[];
    securityByType: {type: string; total: number}[];
    quota: {id: number; name: string; plan: string; percent: number; limiting: "books" | "storage" | "members"}[];
}

// ---- Support notes ----

export interface IAccountNote {
    id: number;
    body: string;
    createdBy: string | null;
    createdDate: string;
}

// ---- Admin sessions ----

export interface IAdminSession {
    id: number;
    adminId: number;
    adminEmail: string;
    adminName: string;
    userAgent: string | null;
    ipAddress: string | null;
    country: string | null;
    city: string | null;
    createdDate: string;
    lastSeenDate: string;
    current: boolean;
}

// ---- Data requests (GDPR) ----

export type DataRequestKind = "access" | "erasure";
export type DataRequestStatus = "open" | "processing" | "completed" | "rejected";

export interface IDataRequest {
    id: number;
    kind: DataRequestKind;
    userId: number | null;
    userCode: string | null;
    subjectName: string | null;
    subjectEmail: string;
    receivedAt: string;
    dueAt: string;
    extendedAt: string | null;
    extensionReason: string | null;
    status: DataRequestStatus;
    completedAt: string | null;
    resolution: string | null;
    notes: string | null;
    deletionScheduledFor: string | null;
    /** Days to the deadline (negative once overdue); null for a closed request. */
    daysLeft: number | null;
    overdue: boolean;
}

// ---- Webhooks ----

export type WebhookKind = "slack" | "discord" | "telegram" | "generic";

export interface IWebhookEvent {
    id: string;
    label: string;
}

export interface IWebhook {
    id: number;
    name: string;
    kind: WebhookKind;
    targetHint: string;
    events: string[];
    enabled: boolean;
    lastStatus: "sent" | "failed" | null;
    lastError: string | null;
    lastAt: string | null;
}

export interface IWebhookDelivery {
    id: number;
    event: string;
    status: "sent" | "failed";
    httpStatus: number | null;
    error: string | null;
    createdDate: string;
}

export interface IWebhookInput {
    name: string;
    kind: WebhookKind;
    events: string[];
    url?: string;
    token?: string;
    chatId?: string;
    secret?: string;
}
