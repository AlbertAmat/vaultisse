/**
 * Holds the settings overridden from the admin portal and merges them over the process env.
 *
 * Precedence for every setting in the catalog: database override, then env var, then built-in default.
 * The rest of the server never reads this directly: AppService asks for {@link effectiveEnv}, an
 * env-shaped object, and runs its existing env readers (MailService.readConfig, ...) on it. That keeps
 * "configured by env var" and "configured by the portal" on one code path.
 *
 * Overrides are only loaded when the portal is enabled; otherwise {@link effectiveEnv} is simply
 * `process.env`, so turning the portal off really does hand configuration back to the env vars.
 */
import {Pool} from "pg";
import {ValidationError} from "../../errors/DomainError";
import {Logger} from "../../utils/Logger";
import {SettingsRepository} from "../repositories/SettingsRepository";
import {SETTING_GROUPS, SETTINGS_CATALOG, SettingDefinition, SettingGroupId, findSetting} from "./settingsCatalog";
import {SettingsCrypto} from "./SettingsCrypto";
import {ConfigRow} from "./ConfigReport";

/** Where a setting's current value comes from. */
export type SettingSource = "database" | "env" | "default";

export interface SettingView {
    key: string;
    label: string;
    description: string;
    type: SettingDefinition["type"];
    options: string[] | null;
    /** Current value; always null for secrets, which are never sent back. */
    value: string | null;
    /** Whether a value is set (the only thing known about a secret). */
    isSet: boolean;
    source: SettingSource;
    /** The value used when nothing else is set. */
    defaultValue: string | null;
    /** Whether the key can be tested against its provider. */
    testable: boolean;
    /** The environment variable is also set (and ignored while a value is saved here). */
    envSet: boolean;
    /** Its value; null when not set, and always null for secrets. */
    envValue: string | null;
    /** A stored secret that could not be decrypted (the encryption key changed): enter it again. */
    unreadable: boolean;
}

export interface SettingGroupView {
    id: SettingGroupId;
    label: string;
    description: string;
    items: SettingView[];
}

/** A change set: a string sets, `null` goes back to the env var / default, a missing key is left alone. */
export type SettingChanges = Record<string, string | null>;

/** Throws when the env built from a change set would make the server's config invalid. */
export type EnvValidator = (env: NodeJS.ProcessEnv, touchedKeys: string[]) => void;

/** Reads, merges and persists the portal-managed settings. */
export class SettingsService {
    private overrides_ = new Map<string, string>();
    private unreadable = new Set<string>();
    private readonly repo: SettingsRepository;

    /**
     * @param pool Database pool.
     * @param crypto Encrypts secret values at rest.
     * @param logger Server logger.
     * @param enabled Whether the admin portal is on; when false nothing is loaded or applied.
     */
    public constructor(
        pool: Pool,
        private readonly crypto: SettingsCrypto,
        private readonly logger: Logger,
        private readonly enabled: boolean
    ) {
        this.repo = new SettingsRepository(pool);
    }

    /** Loads every stored override into memory (a no-op while the portal is off). */
    public async load(): Promise<void> {
        if (!this.enabled) {
            return;
        }
        const next = new Map<string, string>();
        const unreadable = new Set<string>();
        for (const row of await this.repo.loadAll()) {
            if (!findSetting(row.key)) {
                continue;
            }
            try {
                next.set(row.key, row.isSecret ? this.crypto.decrypt(row.value) : row.value);
            } catch {
                unreadable.add(row.key);
                this.logger.error(`Setting ${row.key} could not be decrypted (the encryption key changed?) - enter it again in the admin portal.`);
            }
        }
        this.overrides_ = next;
        this.unreadable = unreadable;
    }

    /**
     * @param overrides Overrides to merge; defaults to the loaded ones.
     * @returns `process.env` with the overrides applied on top.
     */
    public effectiveEnv(overrides: Map<string, string> = this.overrides_): NodeJS.ProcessEnv {
        if (!this.enabled) {
            return process.env;
        }
        const env: NodeJS.ProcessEnv = {...process.env};
        for (const [key, value] of overrides) {
            env[key] = value;
        }
        return env;
    }

    /** @returns A copy of the loaded overrides (for building a trial configuration, e.g. a test email). */
    public overrides(): Map<string, string> {
        return new Map(this.enabled ? this.overrides_ : []);
    }

    /**
     * @param key Setting key.
     * @returns The effective value, or undefined when nothing sets it.
     */
    public get(key: string): string | undefined {
        return this.effectiveEnv()[key];
    }

    /**
     * @returns Every setting, grouped, for the portal's settings page. Secrets are reported as set/unset only.
     */
    public describe(): SettingGroupView[] {
        return SETTING_GROUPS.map((group) => ({
            id: group.id,
            label: group.label,
            description: group.description,
            items: SETTINGS_CATALOG.filter((definition) => definition.group === group.id).map((definition) => this.view(definition)),
        }));
    }

    private view(definition: SettingDefinition): SettingView {
        const override = this.enabled ? this.overrides_.get(definition.key) : undefined;
        const envValue = process.env[definition.key];
        let source: SettingSource = "default";
        let value: string | undefined;
        if (override !== undefined) {
            source = "database";
            value = override;
        } else if (envValue !== undefined && envValue !== "") {
            source = "env";
            value = envValue;
        }
        const secret = definition.type === "secret";
        return {
            key: definition.key,
            label: definition.label,
            description: definition.description,
            type: definition.type,
            options: definition.options ?? null,
            value: secret ? null : (value ?? definition.defaultValue ?? ""),
            isSet: value !== undefined && value !== "",
            source,
            defaultValue: secret ? null : (definition.defaultValue ?? null),
            testable: definition.testable === true,
            envSet: envValue !== undefined && envValue !== "",
            envValue: secret || envValue === undefined || envValue === "" ? null : envValue,
            unreadable: this.unreadable.has(definition.key),
        };
    }

    /**
     * @returns For every setting, what the env var and the admin portal say and which one is applied.
     */
    public comparison(): ConfigRow[] {
        return SETTINGS_CATALOG.map((definition) => {
            const secret = definition.type === "secret";
            const envRaw = process.env[definition.key];
            const envSet = envRaw !== undefined && envRaw !== "";
            const panelRaw = this.enabled ? this.overrides_.get(definition.key) : undefined;
            const panelSet = panelRaw !== undefined;
            const show = (raw: string) => (secret ? "(set)" : raw);
            return {
                key: definition.key,
                envValue: envSet ? show(envRaw as string) : null,
                panelValue: panelSet ? (this.unreadable.has(definition.key) ? "(unreadable)" : show(panelRaw as string)) : this.unreadable.has(definition.key) ? "(unreadable)" : null,
                applied: panelSet ? "panel" : envSet ? "env" : "default",
                conflict: panelSet && envSet && panelRaw !== envRaw,
            } as ConfigRow;
        });
    }

    /**
     * Removes every setting saved in the portal, so the env vars (and defaults) apply again. Only
     * editable settings are touched: the instance id and other plain rows stay.
     * @returns How many saved settings were removed.
     */
    public async resetAll(): Promise<number> {
        const removed = await this.repo.removeMany(SETTINGS_CATALOG.map((definition) => definition.key));
        this.overrides_ = new Map();
        this.unreadable = new Set();
        return removed;
    }

    /** @returns The plain-row storage (onboarding flag etc.). */
    public plain(): SettingsRepository {
        return this.repo;
    }

    /**
     * Validates and saves a set of changes, then makes them effective.
     * @param changes Key -> new value (`null` = revert to env var / default).
     * @param adminId Admin making the change.
     * @param validate Checks the resulting configuration as a whole (e.g. half-configured SMTP).
     * @returns The keys that were changed.
     * @throws ValidationError when a key is unknown, a value is malformed, or the result is invalid.
     */
    public async update(changes: SettingChanges, adminId: number, validate: EnvValidator): Promise<string[]> {
        const next = new Map(this.overrides_);
        const touched: string[] = [];

        for (const [key, raw] of Object.entries(changes)) {
            const definition = findSetting(key);
            if (!definition) {
                throw new ValidationError(`Unknown setting "${key}".`);
            }
            if (raw === null) {
                next.delete(key);
            } else {
                next.set(key, SettingsService.normalise(definition, raw));
            }
            touched.push(key);
        }

        try {
            validate(this.effectiveEnv(next), touched);
        } catch (error) {
            throw new ValidationError(error instanceof Error ? error.message : String(error));
        }

        for (const key of touched) {
            const value = next.get(key);
            if (value === undefined) {
                await this.repo.remove(key);
            } else {
                const secret = findSetting(key)!.type === "secret";
                await this.repo.upsert(key, secret ? this.crypto.encrypt(value) : value, secret, adminId);
            }
            this.unreadable.delete(key);
        }

        this.overrides_ = next;
        return touched;
    }

    private static normalise(definition: SettingDefinition, raw: unknown): string {
        if (typeof raw !== "string") {
            throw new ValidationError(`"${definition.label}" must be text.`);
        }
        const value = raw.trim();
        if (/[\r\n]/.test(value)) {
            throw new ValidationError(`"${definition.label}" can't contain line breaks.`);
        }
        if (value.length > (definition.type === "secret" ? 1000 : 500)) {
            throw new ValidationError(`"${definition.label}" is too long.`);
        }
        if (value === "") {
            return value;
        }
        switch (definition.type) {
            case "number": {
                const number = Number(value);
                if (!Number.isInteger(number) || number < (definition.min ?? 0)) {
                    throw new ValidationError(`"${definition.label}" must be a whole number of at least ${definition.min ?? 0}.`);
                }
                return String(number);
            }
            case "boolean":
                if (value !== "true" && value !== "false") {
                    throw new ValidationError(`"${definition.label}" must be on or off.`);
                }
                return value;
            case "select":
                if (!definition.options?.includes(value)) {
                    throw new ValidationError(`"${definition.label}" has an invalid value.`);
                }
                return value;
            default:
                return value;
        }
    }
}
