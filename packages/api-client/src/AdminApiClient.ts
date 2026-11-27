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
    AdminLoginStep, AdminRole, IAccountDetail, IAccount, IAdminSelf, IAdminUser, IAdminVault, IAuditEntry, IBlockedIp, IDeletionRequestResult,
    IEnrollConfirm, IEnrollStart, ILockout, IOverview, IPaged, IPlan, IPlanInput, IScheduledDeletion, ISecurityEvent, ISecuritySummary,
    IMailEntry, IServerLog, ISettingGroup, ISystemInfo, ITopIp, ITraffic, IUserSession, IVaultDetail, IActivityEntry, SettingChanges, UserStatus,
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
    system(): Promise<ISystemInfo>;
    settings: {
        list(): Promise<ISettingGroup[]>;
        update(changes: SettingChanges): Promise<ISettingGroup[]>;
        /** `unsaved`: SMTP_* values typed in the form but not saved yet; a secret left out keeps the saved one. */
        testEmail(to: string, unsaved?: Record<string, string>): Promise<{ok: boolean; error: string | null}>;
    };
    users: {
        list(query: {search?: string; status?: UserStatus; sort?: string; page?: number; pageSize?: number}): Promise<IPaged<IAccount>>;
        get(id: number): Promise<IAccountDetail>;
        approve(id: number): Promise<void>;
        disable(id: number, reason?: string): Promise<void>;
        enable(id: number): Promise<void>;
        forceLogout(id: number): Promise<void>;
        resetTwoFactor(id: number): Promise<void>;
        remove(id: number, confirm: string, immediate?: boolean): Promise<IDeletionRequestResult>;
    };
    vaults: {
        list(query: {search?: string; status?: string; page?: number; pageSize?: number}): Promise<IPaged<IAdminVault>>;
        get(id: number): Promise<IVaultDetail>;
        suspend(id: number, reason?: string): Promise<void>;
        unsuspend(id: number): Promise<void>;
        setPlan(id: number, planId: number | null): Promise<void>;
        remove(id: number, confirm: string, immediate?: boolean): Promise<IDeletionRequestResult>;
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
        system: () => get("/system"),
        settings: {
            list: async () => (await get<{groups: ISettingGroup[]}>("/settings")).groups,
            update: async (changes) => (await put<{groups: ISettingGroup[]}>("/settings", {changes})).groups,
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
        },
        vaults: {
            list: (query) => get("/vaults", query),
            get: (id) => get(`/vaults/${id}`),
            suspend: (id, reason) => post(`/vaults/${id}/suspend`, {reason}),
            unsuspend: (id) => post(`/vaults/${id}/unsuspend`),
            setPlan: (id, planId) => put(`/vaults/${id}/plan`, {planId}),
            remove: (id, confirm, immediate = false) => del(`/vaults/${id}`, {confirm, immediate}),
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
        },
    };
}
