/**
 * The settings that can be edited from the admin portal. Each `key` is the name of the env var it
 * overrides, so the rest of the server keeps reading "env-shaped" configuration: an override simply
 * takes the env var's place (see SettingsService.effectiveEnv). Anything not listed here - the
 * database connection, ports, JWT secret, proxy trust, CSP - stays env-only because it is needed
 * before the database is reachable or only takes effect at start-up.
 */
export type SettingType = "string" | "number" | "boolean" | "secret" | "select";

export interface SettingDefinition {
    /** Env var name this setting overrides. */
    key: string;
    group: SettingGroupId;
    label: string;
    description: string;
    type: SettingType;
    /** Allowed values for `select`. */
    options?: string[];
    /** Shown when neither the database nor the env var provides a value. */
    defaultValue?: string;
    /** Smallest allowed value for `number`. */
    min?: number;
    /** A secret the portal can check against its provider (see ApiKeyTester). */
    testable?: boolean;
}

export type SettingGroupId = "email" | "registration" | "sso" | "metadata" | "limits" | "inactivity" | "admin";

export const SETTING_GROUPS: {id: SettingGroupId; label: string; description: string}[] = [
    {id: "email", label: "Email (SMTP)", description: "Outgoing mail for verification links and notifications. Leave host and from empty to run without email."},
    {id: "registration", label: "Registration", description: "Who can create an account on this installation."},
    {id: "sso", label: "Single sign-on (OIDC)", description: "Sign in through an identity provider such as Authentik or Keycloak. Issuer, client id, client secret and redirect URI are all required to turn it on."},
    {id: "metadata", label: "API keys", description: "Keys for the services that look up book details and covers by ISBN. Each one can be tested before you save it."},
    {id: "limits", label: "Upload limits", description: "Largest files users can upload."},
    {id: "inactivity", label: "Inactive accounts", description: "Permanently deletes accounts nobody has used for a while. Leave the days empty to never delete."},
    {id: "admin", label: "Admin portal", description: "Behaviour of the portal itself."},
];

export const SETTINGS_CATALOG: SettingDefinition[] = [
    {key: "SMTP_HOST", group: "email", label: "SMTP host", description: "Mail server, e.g. smtp.example.com.", type: "string"},
    {key: "SMTP_PORT", group: "email", label: "SMTP port", description: "Usually 587 (STARTTLS) or 465 (TLS).", type: "number", defaultValue: "587", min: 1},
    {key: "SMTP_SECURE", group: "email", label: "Use TLS from the start", description: "Enable for port 465. Defaults to on only for port 465.", type: "select", options: ["", "true", "false"]},
    {key: "SMTP_REQUIRE_TLS", group: "email", label: "Require STARTTLS", description: "Refuse to send without STARTTLS. Defaults to on when a user name is set.", type: "select", options: ["", "true", "false"]},
    {key: "SMTP_USER", group: "email", label: "SMTP user", description: "Leave empty if the server needs no login.", type: "string"},
    {key: "SMTP_PASSWORD", group: "email", label: "SMTP password", description: "Stored encrypted.", type: "secret"},
    {key: "SMTP_FROM", group: "email", label: "Sender address", description: "e.g. Vaultisse <library@example.com>.", type: "string"},

    {key: "REGISTRATION_ENABLED", group: "registration", label: "Allow registration", description: "Turn off once everyone who needs an account has one.", type: "boolean", defaultValue: "true"},
    {key: "REGISTRATION_REQUIRES_APPROVAL", group: "registration", label: "Require admin approval", description: "New accounts stay disabled until approved under Users.", type: "boolean", defaultValue: "false"},

    {key: "OIDC_ISSUER", group: "sso", label: "Issuer URL", description: "The identity provider's issuer, used for discovery.", type: "string"},
    {key: "OIDC_CLIENT_ID", group: "sso", label: "Client id", description: "", type: "string"},
    {key: "OIDC_CLIENT_SECRET", group: "sso", label: "Client secret", description: "Stored encrypted.", type: "secret"},
    {key: "OIDC_REDIRECT_URI", group: "sso", label: "Redirect URI", description: "Exactly as registered at the provider, e.g. https://books.example.com/auth/oidc/callback.", type: "string"},
    {key: "OIDC_SCOPES", group: "sso", label: "Scopes", description: "", type: "string", defaultValue: "openid profile email"},
    {key: "OIDC_BUTTON_LABEL", group: "sso", label: "Button label", description: "Text of the login button.", type: "string", defaultValue: "Sign in with SSO"},
    {key: "OIDC_GROUPS_CLAIM", group: "sso", label: "Groups claim", description: "Claim listing the user's groups, mapped to vault roles.", type: "string", defaultValue: "groups"},
    {key: "OIDC_PERSONAL_VAULT", group: "sso", label: "Personal vault for new SSO users", description: "Give each new SSO user a library of their own.", type: "boolean", defaultValue: "true"},
    {key: "SSO_ONLY", group: "sso", label: "SSO only", description: "Switch password login and registration off. Ignored unless SSO is fully configured.", type: "boolean", defaultValue: "false"},

    {key: "GOOGLE_BOOKS_API_KEY", group: "metadata", label: "Google Books API key", description: "Optional extra source of book details. Without it Open Library and the national catalogs are still used. Create one in the Google Cloud console (Books API).", type: "secret", testable: true},
    {key: "LIBRARYTHING_API_KEY", group: "metadata", label: "LibraryThing dev key", description: "Optional third fallback for covers, used when Google Books and Open Library have none. Free with a LibraryThing account (librarything.com/services/keys.php).", type: "secret", testable: true},

    {key: "MAX_EBOOK_FILE_SIZE_MB", group: "limits", label: "Largest ebook file (MB)", description: "EPUB, PDF and Kindle uploads.", type: "number", defaultValue: "10", min: 1},
    {key: "MAX_IMPORT_FILE_SIZE_MB", group: "limits", label: "Largest import file (MB)", description: "Library import CSV/JSON.", type: "number", defaultValue: "10", min: 1},

    {key: "ACCOUNT_INACTIVITY_DAYS", group: "inactivity", label: "Delete after (days)", description: "Permanently deletes inactive accounts, and libraries only they belong to.", type: "number", min: 1},
    {key: "ACCOUNT_DELETION_NOTICE_DAYS", group: "inactivity", label: "Warn before deletion (days)", description: "Needs email, and must be smaller than the days above. Empty = no warning.", type: "number", min: 1},

    {key: "ADMIN_DELETION_GRACE_DAYS", group: "admin", label: "Deletion grace period (days)", description: "Deleting an account or vault from the portal locks it out first and only deletes it after this many days, so it can be cancelled. 0 = delete immediately.", type: "number", defaultValue: "7", min: 0},
];

const BY_KEY = new Map(SETTINGS_CATALOG.map((definition) => [definition.key, definition]));

/**
 * @param key Setting key.
 * @returns Its definition, or undefined for a key the portal doesn't manage.
 */
export function findSetting(key: string): SettingDefinition | undefined {
    return BY_KEY.get(key);
}
