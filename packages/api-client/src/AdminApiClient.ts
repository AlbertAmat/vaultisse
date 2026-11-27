/**
 * Client of the admin portal API (`/api/admin/*`). Separate from {@link createApiClient} because it talks
 * to a different origin/port (the admin listener) with a different session, and has two behaviours of its
 * own: when the session is gone it calls `onSessionExpired`, and when the server asks for a fresh
 * password + code check before a dangerous action (403 `reauthRequired`) it calls `reauth` and, if that
 * succeeds, repeats the request - so a caller just awaits the action and the UI handles the prompt.
 *
 * @example
 * const admin = createAdminApiClient({
 *     onSessionExpired: () => router.push("/login"),
 *     reauth: () => askForPasswordAndCode(),   // resolves true once POST /auth/reauth succeeded
 * });
 * await admin.users.remove(12, "alice");
 */
import axios, {AxiosError, AxiosInstance, AxiosRequestConfig} from "axios";
import type {
    IJob, IJobRun, IRetentionItem, ClearScope, PreviousAdmins, IClearCounts, IMergeResult, IChartsData, IAccountNote, IAdminSession, IDataRequest, DataRequestKind, IWebhook, IWebhookDelivery, IWebhookEvent, IWebhookInput,
    AdminLoginStep, AdminRole, IAccountDetail, IAccount, IAdminSelf, IAdminUser, IAdminVault, IAuditEntry, IBlockedIp, IDeletionRequestResult,
    IEnrollConfirm, IEnrollStart, ILockout, IOverview, IPaged, IPlan, IPlanInput, IScheduledDeletion, ISecurityEvent, ISecuritySummary,
    ILoginMap, IComplianceOverview, IControlInput, IRegisterEntry, IRegisterInput, RegisterKind, IIncident, IIncidentInput, IAccessReview, IAnnouncement, IBroadcast, IBroadcastAudience, IBroadcastPreview, IBulkResult, IInactivityPreview, IMaintenance, ITermsCounts, ITermsRow, AnnouncementLevel, BroadcastAudience, BulkAccountAction, TermsDocument, TermsStatus, IMailEntry, IOnboardingStatus, INotificationEntry, INotificationsOverview, ISystemDetails, IVersionStatus, IServerLog, ISettingGroup, ISystemInfo, ITopIp, ITraffic, IUserSession, IVaultDetail, IActivityEntry, SettingChanges, UserStatus,
} from "@vaultisse/types/admin/IAdmin";

export interface AdminClientOptions {
    /** Origin of the admin listener, without a path. Omit for same-origin (the admin web app itself). */
    baseURL?: string;
    /** The session is gone (401 `sessionExpired`): show the login screen. */
    onSessionExpired?: () => void;
    /** Any other failed request that isn't handled by the caller (`suppressErrorDialog`). */
    onError?: (error: AxiosError<{message?: string}>) => void;
    /** Ask the admin for password + code and call `POST /auth/reauth`; resolve true on success. */
    reauth?: () => Promise<boolean>;
}

type Query = Record<string, string | number | boolean | undefined | null>;

/** Strips undefined/empty values so they don't show up in the query string. */
function clean(query: Query = {}): Query {
    return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

/** Everything the admin portal can do, grouped like its pages. */
export interface AdminApiClient {
    http: AxiosInstance;
    auth: {
        login(email: string, password: string): Promise<{next: AdminLoginStep}>;
        verifyCode(input: {code?: string; backupCode?: string}): Promise<void>;
        enrollStart(): Promise<IEnrollStart>;
        enrollConfirm(code: string): Promise<IEnrollConfirm>;
        me(): Promise<IAdminSelf>;
        logout(): Promise<void>;
        reauth(password: string, input: {code?: string; backupCode?: string}): Promise<string>;
        changePassword(currentPassword: string, newPassword: string): Promise<void>;
    };
    overview(): Promise<IOverview>;
    overviewCharts(days: number): Promise<IChartsData>;
    system(): Promise<ISystemInfo>;
    announcements: {
        list(): Promise<{items: IAnnouncement[]; maintenance: IMaintenance}>;
        create(input: {message: string; level: AnnouncementLevel; startsAt?: string | null; endsAt?: string | null}): Promise<void>;
        update(id: number, input: {message: string; level: AnnouncementLevel; startsAt: string; endsAt: string | null; enabled: boolean}): Promise<void>;
        remove(id: number): Promise<void>;
        /** Read-only mode for the whole app. Turning it on needs a fresh verification (handled by the client). */
        setMaintenance(enabled: boolean, message?: string): Promise<IMaintenance>;
    };
    map: {
        logins(days: number): Promise<ILoginMap>;
    };
    compliance: {
        overview(): Promise<IComplianceOverview>;
        saveControl(id: string, input: IControlInput): Promise<void>;
        register(kind?: RegisterKind): Promise<IRegisterEntry[]>;
        createRegister(input: IRegisterInput): Promise<void>;
        updateRegister(id: number, input: IRegisterInput): Promise<void>;
        removeRegister(id: number): Promise<void>;
        incidents(): Promise<IIncident[]>;
        createIncident(input: IIncidentInput): Promise<void>;
        updateIncident(id: number, input: IIncidentInput): Promise<void>;
        access(): Promise<IAccessReview[]>;
        confirmAccess(ids?: number[]): Promise<number>;
    };
    broadcast: {
        audiences(): Promise<{items: IBroadcastAudience[]; mailEnabled: boolean}>;
        preview(input: {audience: BroadcastAudience; subject: string; body: string}): Promise<IBroadcastPreview>;
        test(input: {subject: string; body: string}): Promise<{ok: boolean; error: string | null; to: string}>;
        send(input: {audience: BroadcastAudience; subject: string; body: string; expectedCount: number}): Promise<IBroadcast>;
        list(query: {page?: number; pageSize?: number}): Promise<IPaged<IBroadcast>>;
        get(id: number): Promise<IBroadcast>;
        cancel(id: number): Promise<void>;
    };
    inactivity: {
        preview(query: {days?: number; horizon?: number}): Promise<IInactivityPreview>;
        keep(id: number): Promise<void>;
    };
    terms: {
        summary(): Promise<Record<TermsDocument, ITermsCounts>>;
        list(query: {doc: TermsDocument; status?: TermsStatus; search?: string; page?: number; pageSize?: number}): Promise<IPaged<ITermsRow>>;
        /** URL of the CSV export (same origin, so the session cookie authorises the download). */
        exportUrl(query: {doc: TermsDocument; status?: TermsStatus; search?: string}): string;
    };
    onboarding: {
        status(): Promise<IOnboardingStatus>;
        complete(): Promise<void>;
    };
    /** The System page: version and updates, database, migrations, runtime. */
    systemDetails(): Promise<ISystemDetails>;
    checkUpdates(): Promise<IVersionStatus>;
    notifications: {
        overview(): Promise<INotificationsOverview>;
        history(query: {page?: number; pageSize?: number}): Promise<IPaged<INotificationEntry>>;
        /** Subscribe/unsubscribe yourself (`adminId` omitted) or, as a superadmin, another admin. */
        setSubscription(notifyEmail: boolean, adminId?: number): Promise<void>;
        test(): Promise<{ok: boolean; error: string | null; to: string}>;
    };
    settings: {
        list(): Promise<ISettingGroup[]>;
        update(changes: SettingChanges): Promise<ISettingGroup[]>;
        /** `unsaved`: SMTP_* values typed in the form but not saved yet; a secret left out keeps the saved one. */
        /** Tries an API key against its provider: the typed value, or the saved one when omitted. */
        testKey(key: string, value?: string): Promise<{ok: boolean; message: string}>;
        /** Danger zone, step 1: emails a one-time code to the signed-in admin. Needs a fresh verification. */
        resetRequest(): Promise<{sentTo: string; expiresAt: string}>;
        /** Danger zone, step 2: with the emailed code and the word RESET, removes every saved setting. */
        resetConfirm(code: string): Promise<{removed: number; groups: ISettingGroup[]}>;
        testEmail(to: string, unsaved?: Record<string, string>): Promise<{ok: boolean; error: string | null}>;
    };
    users: {
        list(query: {search?: string; status?: UserStatus; tag?: string; sort?: string; page?: number; pageSize?: number}): Promise<IPaged<IAccount>>;
        get(id: number): Promise<IAccountDetail>;
        /** Private admin notes and tags (never shown to the user). */
        tags(): Promise<{tag: string; count: number}[]>;
        setTags(id: number, tags: string[]): Promise<string[]>;
        addNote(id: number, body: string): Promise<IAccountNote[]>;
        removeNote(id: number, noteId: number): Promise<IAccountNote[]>;
        approve(id: number): Promise<void>;
        disable(id: number, reason?: string): Promise<void>;
        enable(id: number): Promise<void>;
        forceLogout(id: number): Promise<void>;
        resetTwoFactor(id: number): Promise<void>;
        remove(id: number, confirm: string, immediate?: boolean): Promise<IDeletionRequestResult>;
        /** Changes the email address. Needs a fresh verification (handled by the client). */
        changeEmail(id: number, email: string, verified: boolean): Promise<{email: string; verified: boolean; notified: boolean}>;
        /** Folds the account `sourceId` into this one and deletes it. `confirm` is the source's username. */
        merge(id: number, sourceId: number, confirm: string): Promise<IMergeResult>;
        /** The same action on many accounts: a selection (`ids`) or everyone with a status (`status`). */
        bulk(action: BulkAccountAction, target: {ids?: number[]; status?: UserStatus}, extra?: {reason?: string; confirm?: string}): Promise<IBulkResult>;
    };
    vaults: {
        list(query: {search?: string; status?: string; page?: number; pageSize?: number}): Promise<IPaged<IAdminVault>>;
        get(id: number): Promise<IVaultDetail>;
        suspend(id: number, reason?: string): Promise<void>;
        unsuspend(id: number): Promise<void>;
        setPlan(id: number, planId: number | null): Promise<void>;
        remove(id: number, confirm: string, immediate?: boolean): Promise<IDeletionRequestResult>;
        /** Makes a member the admin of the vault. */
        transfer(id: number, toUserId: number, previous: PreviousAdmins): Promise<{vault: string; newAdmin: string; changed: number}>;
        /** How much of each kind of content the vault holds (counts only). */
        content(id: number): Promise<{vault: {id: number; name: string}; counts: IClearCounts}>;
        /** Deletes the chosen kinds of content. `confirm` is the vault's name. Cannot be undone. */
        clear(id: number, scopes: ClearScope[], confirm: string): Promise<{removed: Record<string, number>; counts: IClearCounts}>;
    };
    plans: {
        list(): Promise<IPlan[]>;
        create(input: IPlanInput & {code: string}): Promise<void>;
        update(id: number, input: IPlanInput): Promise<void>;
        remove(id: number): Promise<void>;
        setDefault(id: number | null): Promise<void>;
    };
    deletions: {
        list(query: {open?: boolean; page?: number; pageSize?: number}): Promise<IPaged<IScheduledDeletion>>;
        cancel(id: number): Promise<void>;
        execute(id: number): Promise<void>;
    };
    security: {
        summary(): Promise<ISecuritySummary>;
        traffic(): Promise<ITraffic>;
        events(query: {type?: string; ip?: string; page?: number; pageSize?: number}): Promise<IPaged<ISecurityEvent>>;
        topIps(hours: number): Promise<ITopIp[]>;
        lockouts(): Promise<ILockout[]>;
        clearLockout(userId: number): Promise<void>;
        blockedIps(): Promise<IBlockedIp[]>;
        blockIp(ip: string, reason?: string, hours?: number | null): Promise<void>;
        unblockIp(ip: string): Promise<void>;
        sessions(query: {page?: number; pageSize?: number}): Promise<IPaged<IUserSession>>;
        revokeSession(id: number): Promise<void>;
    };
    logs: {
        activity(query: {action?: string; actorId?: number; ip?: string; page?: number; pageSize?: number}): Promise<IPaged<IActivityEntry>>;
        server(query: {lines?: number; level?: string; q?: string}): Promise<IServerLog>;
        mail(query: {status?: string; q?: string; page?: number; pageSize?: number}): Promise<IPaged<IMailEntry>>;
        audit(query: {action?: string; adminId?: number; entityType?: string; page?: number; pageSize?: number}): Promise<IPaged<IAuditEntry>>;
    };
    admins: {
        list(): Promise<IAdminUser[]>;
        create(input: {email: string; name: string; password: string; role: AdminRole}): Promise<void>;
        update(id: number, input: {role?: AdminRole; disabled?: boolean}): Promise<void>;
        resetTwoFactor(id: number): Promise<void>;
        remove(id: number): Promise<void>;
        /** Live admin sessions (a read-only admin sees only their own). */
        sessions(): Promise<IAdminSession[]>;
        /** Ends another admin's session. Needs a fresh verification (handled by the client). */
        revokeSession(id: number): Promise<void>;
    };
    jobs: {
        list(): Promise<IJob[]>;
        /** Runs it now. A job that deletes data needs a fresh verification (handled by the client). */
        run(id: string): Promise<IJobRun>;
        history(id: string): Promise<IJobRun[]>;
    };
    retention: {
        list(): Promise<{items: IRetentionItem[]; auditFloorDays: number}>;
    };
    dataRequests: {
        list(status?: string): Promise<{items: IDataRequest[]; counts: {open: number; overdue: number}}>;
        create(input: {kind: DataRequestKind; userId?: number; email?: string; name?: string; receivedAt?: string; notes?: string}): Promise<IDataRequest>;
        extend(id: number, reason: string): Promise<IDataRequest>;
        close(id: number, outcome: "completed" | "rejected", resolution: string): Promise<IDataRequest>;
        /** Carries out an erasure request through the deletion flow. */
        erase(id: number, immediate?: boolean): Promise<{executed: boolean; executeAfter: string | null; item: IDataRequest}>;
        /** A one-minute link that downloads the personal-data export (ZIP) of an account. Needs a fresh verification. */
        exportLink(userId: number): Promise<string>;
    };
    webhooks: {
        list(): Promise<{items: IWebhook[]; events: IWebhookEvent[]}>;
        create(input: IWebhookInput): Promise<IWebhook>;
        /** Without a target (`url`, `token`+`chatId`) the saved one stays. */
        update(id: number, input: {name: string; events: string[]; url?: string; token?: string; chatId?: string; secret?: string}): Promise<IWebhook>;
        setEnabled(id: number, enabled: boolean): Promise<void>;
        remove(id: number): Promise<void>;
        test(id: number): Promise<{ok: boolean; error: string | null}>;
        deliveries(id: number): Promise<IWebhookDelivery[]>;
    };
}

/**
 * @param options See {@link AdminClientOptions}.
 * @returns The admin API client.
 */
export function createAdminApiClient(options: AdminClientOptions = {}): AdminApiClient {
    const http = axios.create({
        baseURL: `${(options.baseURL ?? "").replace(/\/+$/, "")}/api/admin`,
        withCredentials: true,
    });

    http.interceptors.response.use(
        (response) => response,
        async (error: AxiosError<{message?: string; sessionExpired?: boolean; reauthRequired?: boolean}>) => {
            const config = error.config as (AxiosRequestConfig & {_retried?: boolean}) | undefined;
            if (error.response?.status === 401 && error.response.data?.sessionExpired) {
                options.onSessionExpired?.();
                return Promise.reject(error);
            }
            if (error.response?.status === 403 && error.response.data?.reauthRequired && options.reauth && config && !config._retried) {
                if (await options.reauth()) {
                    config._retried = true;
                    return http.request(config);
                }
                return Promise.reject(error);
            }
            if (!config?.suppressErrorDialog) {
                options.onError?.(error);
            }
            return Promise.reject(error);
        }
    );

    const get = async <T>(url: string, query?: Query): Promise<T> => (await http.get<T>(url, {params: clean(query)})).data;
    const post = async <T = void>(url: string, body: object = {}): Promise<T> => (await http.post<T>(url, body)).data;
    const put = async <T = void>(url: string, body: object = {}): Promise<T> => (await http.put<T>(url, body)).data;
    const patch = async <T = void>(url: string, body: object = {}): Promise<T> => (await http.patch<T>(url, body)).data;
    const del = async <T = void>(url: string, body?: object): Promise<T> => (await http.delete<T>(url, {data: body})).data;

    return {
        http,
        auth: {
            // The login steps report wrong passwords/codes themselves, in the form.
            login: async (email, password) => (await http.post("/auth/login", {email, password}, {suppressErrorDialog: true})).data,
            verifyCode: async (input) => { await http.post("/auth/2fa", input, {suppressErrorDialog: true}); },
            enrollStart: async () => (await http.post("/auth/enroll/start", {}, {suppressErrorDialog: true})).data,
            enrollConfirm: async (code) => (await http.post("/auth/enroll/confirm", {code}, {suppressErrorDialog: true})).data,
            me: async () => (await http.get("/auth/me", {suppressErrorDialog: true})).data,
            logout: () => post("/auth/logout"),
            reauth: async (password, input) => (await http.post("/auth/reauth", {password, ...input}, {suppressErrorDialog: true})).data.reauthUntil,
            changePassword: async (currentPassword, newPassword) => { await http.post("/auth/password", {currentPassword, newPassword}, {suppressErrorDialog: true}); },
        },
        overview: () => get("/overview"),
        overviewCharts: (days) => get("/overview/charts", {days}),
        system: () => get("/system"),
        announcements: {
            list: () => get("/announcements"),
            create: (input) => post("/announcements", input),
            update: (id, input) => put(`/announcements/${id}`, input),
            remove: (id) => del(`/announcements/${id}`),
            setMaintenance: async (enabled, message) => (await put<{maintenance: IMaintenance}>("/announcements/maintenance", {enabled, message})).maintenance,
        },
        map: {
            logins: (days) => get("/map/logins", {days}),
        },
        compliance: {
            overview: () => get("/compliance"),
            saveControl: (id, input) => put(`/compliance/controls/${encodeURIComponent(id)}`, input),
            register: async (kind) => (await get<{items: IRegisterEntry[]}>("/compliance/register", {kind})).items,
            createRegister: (input) => post("/compliance/register", input),
            updateRegister: (id, input) => put(`/compliance/register/${id}`, input),
            removeRegister: (id) => del(`/compliance/register/${id}`),
            incidents: async () => (await get<{items: IIncident[]}>("/compliance/incidents")).items,
            createIncident: (input) => post("/compliance/incidents", input),
            updateIncident: (id, input) => put(`/compliance/incidents/${id}`, input),
            access: async () => (await get<{items: IAccessReview[]}>("/compliance/access")).items,
            confirmAccess: async (ids) => (await post<{confirmed: number}>("/compliance/access", {ids})).confirmed,
        },
        broadcast: {
            audiences: () => get("/broadcast/audiences"),
            preview: (input) => post("/broadcast/preview", input),
            test: (input) => post("/broadcast/test", input),
            send: async (input) => (await post<{broadcast: IBroadcast}>("/broadcast", input)).broadcast,
            list: (query) => get("/broadcast", query),
            get: async (id) => (await get<{broadcast: IBroadcast}>(`/broadcast/${id}`)).broadcast,
            cancel: (id) => post(`/broadcast/${id}/cancel`),
        },
        inactivity: {
            preview: (query) => get("/inactivity", query),
            keep: (id) => post(`/inactivity/${id}/keep`),
        },
        terms: {
            summary: () => get("/terms/summary"),
            list: (query) => get("/terms/list", query),
            exportUrl: (query) => `${http.defaults.baseURL}/terms/export.csv?${new URLSearchParams(Object.entries(clean(query)).map(([k, v]) => [k, String(v)])).toString()}`,
        },
        onboarding: {
            status: () => get("/onboarding"),
            complete: () => post("/onboarding/complete"),
        },
        systemDetails: () => get("/system/details"),
        checkUpdates: () => post("/system/check-updates"),
        notifications: {
            overview: () => get("/notifications"),
            history: (query) => get("/notifications/history", query),
            setSubscription: (notifyEmail, adminId) => adminId === undefined ? put("/notifications/me", {notifyEmail}) : patch(`/notifications/recipients/${adminId}`, {notifyEmail}),
            test: () => post("/notifications/test"),
        },
        settings: {
            list: async () => (await get<{groups: ISettingGroup[]}>("/settings")).groups,
            update: async (changes) => (await put<{groups: ISettingGroup[]}>("/settings", {changes})).groups,
            testKey: (key, value) => post("/settings/test-key", {key, value}),
            resetRequest: () => post("/settings/reset/request"),
            // A wrong code is explained inline by the dialog, so no extra toast.
            resetConfirm: async (code) => (await http.post("/settings/reset/confirm", {code, confirm: "RESET"}, {suppressErrorDialog: true})).data,
            testEmail: (to, unsaved) => post("/settings/test-email", {to, settings: unsaved}),
        },
        users: {
            list: (query) => get("/users", query),
            get: (id) => get(`/users/${id}`),
            approve: (id) => post(`/users/${id}/approve`),
            disable: (id, reason) => post(`/users/${id}/disable`, {reason}),
            enable: (id) => post(`/users/${id}/enable`),
            forceLogout: (id) => post(`/users/${id}/force-logout`),
            resetTwoFactor: (id) => post(`/users/${id}/reset-2fa`),
            remove: (id, confirm, immediate = false) => del(`/users/${id}`, {confirm, immediate}),
            changeEmail: (id, email, verified) => post(`/users/${id}/email`, {email, verified}),
            merge: (id, sourceId, confirm) => post(`/users/${id}/merge`, {sourceId, confirm}),
            bulk: (action, target, extra) => post("/users/bulk", {action, ...target, ...extra}),
            tags: async () => (await get<{items: {tag: string; count: number}[]}>("/users/tags")).items,
            setTags: async (id, tags) => (await put<{tags: string[]}>(`/users/${id}/tags`, {tags})).tags,
            addNote: async (id, body) => (await post<{notes: IAccountNote[]}>(`/users/${id}/notes`, {body})).notes,
            removeNote: async (id, noteId) => (await del<{notes: IAccountNote[]}>(`/users/${id}/notes/${noteId}`)).notes,
        },
        vaults: {
            list: (query) => get("/vaults", query),
            get: (id) => get(`/vaults/${id}`),
            suspend: (id, reason) => post(`/vaults/${id}/suspend`, {reason}),
            unsuspend: (id) => post(`/vaults/${id}/unsuspend`),
            setPlan: (id, planId) => put(`/vaults/${id}/plan`, {planId}),
            remove: (id, confirm, immediate = false) => del(`/vaults/${id}`, {confirm, immediate}),
            transfer: (id, toUserId, previous) => post(`/vaults/${id}/transfer`, {toUserId, previous}),
            content: (id) => get(`/vaults/${id}/content`),
            clear: (id, scopes, confirm) => post(`/vaults/${id}/clear`, {scopes, confirm}),
        },
        plans: {
            list: async () => (await get<{items: IPlan[]}>("/plans")).items,
            create: (input) => post("/plans", input),
            update: (id, input) => put(`/plans/${id}`, input),
            remove: (id) => del(`/plans/${id}`),
            setDefault: (id) => put("/plans/default", {planId: id}),
        },
        deletions: {
            list: (query) => get("/deletions", query),
            cancel: (id) => post(`/deletions/${id}/cancel`),
            execute: (id) => post(`/deletions/${id}/execute`),
        },
        security: {
            summary: () => get("/security/summary"),
            traffic: () => get("/security/traffic"),
            events: (query) => get("/security/events", query),
            topIps: async (hours) => (await get<{items: ITopIp[]}>("/security/top-ips", {hours})).items,
            lockouts: async () => (await get<{items: ILockout[]}>("/security/lockouts")).items,
            clearLockout: (userId) => post(`/security/lockouts/${userId}/clear`),
            blockedIps: async () => (await get<{items: IBlockedIp[]}>("/security/blocked-ips")).items,
            blockIp: (ip, reason, hours) => post("/security/blocked-ips", {ip, reason, hours}),
            unblockIp: (ip) => del(`/security/blocked-ips/${encodeURIComponent(ip)}`),
            sessions: (query) => get("/security/sessions", query),
            revokeSession: (id) => post(`/security/sessions/${id}/revoke`),
        },
        logs: {
            activity: (query) => get("/logs/activity", query),
            server: (query) => get("/logs/server", query),
            mail: (query) => get("/logs/mail", query),
            audit: (query) => get("/logs/audit", query),
        },
        admins: {
            list: async () => (await get<{items: IAdminUser[]}>("/admins")).items,
            create: (input) => post("/admins", input),
            update: (id, input) => patch(`/admins/${id}`, input),
            resetTwoFactor: (id) => post(`/admins/${id}/reset-2fa`),
            remove: (id) => del(`/admins/${id}`),
            sessions: async () => (await get<{items: IAdminSession[]}>("/admins/sessions")).items,
            revokeSession: (id) => post(`/admins/sessions/${id}/revoke`),
        },
        jobs: {
            list: async () => (await get<{items: IJob[]}>("/jobs")).items,
            run: async (id) => (await post<{run: IJobRun}>(`/jobs/${id}/run`)).run,
            history: async (id) => (await get<{items: IJobRun[]}>(`/jobs/${id}/history`)).items,
        },
        retention: {
            list: () => get("/retention"),
        },
        dataRequests: {
            list: (status) => get("/data-requests", {status}),
            create: async (input) => (await post<{item: IDataRequest}>("/data-requests", input)).item,
            extend: async (id, reason) => (await post<{item: IDataRequest}>(`/data-requests/${id}/extend`, {reason})).item,
            close: async (id, outcome, resolution) => (await post<{item: IDataRequest}>(`/data-requests/${id}/close`, {outcome, resolution})).item,
            erase: (id, immediate = false) => post(`/data-requests/${id}/erase`, {immediate}),
            exportLink: async (userId) => (await post<{url: string}>(`/data-requests/export/${userId}`)).url,
        },
        webhooks: {
            list: () => get("/webhooks"),
            create: async (input) => (await post<{item: IWebhook}>("/webhooks", input)).item,
            update: async (id, input) => (await put<{item: IWebhook}>(`/webhooks/${id}`, input)).item,
            setEnabled: (id, enabled) => patch(`/webhooks/${id}`, {enabled}),
            remove: (id) => del(`/webhooks/${id}`),
            test: (id) => post(`/webhooks/${id}/test`),
            deliveries: async (id) => (await get<{items: IWebhookDelivery[]}>(`/webhooks/${id}/deliveries`)).items,
        },
    };
}
