-- Upgrade to v1.4.0 - schema changes made on 2026-11-27.
-- Brings an already-installed database in line with the v1.4.0 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)
--
-- Everything below belongs to the optional admin portal (ADMIN_ENABLED=true, see
-- docs/ADMIN.md). The tables are created on every install so upgrading is the same
-- either way, but nothing reads them while the portal is off.

-- ============================================================
-- Settings edited from the admin portal instead of env vars
-- ============================================================

-- One row per overridden setting. `key` is the env var name it overrides (SMTP_HOST,
-- REGISTRATION_ENABLED, ...). Secrets are stored encrypted ("enc:v1:...", see
-- server/src/admin/services/SettingsCrypto.ts), never in clear text.
CREATE TABLE app_settings
(
    key        VARCHAR(80) PRIMARY KEY,
    value      TEXT        NOT NULL,
    is_secret  BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_by INT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Admin accounts - deliberately NOT rows of `users`
-- ============================================================

-- Operators of the installation. A separate table, cookie and JWT audience from the
-- regular users, so a bug in the user API can never grant admin rights.
-- role: 'superadmin' can change things, 'readonly' can only look.
CREATE TABLE admin_users
(
    id                 SERIAL PRIMARY KEY,
    email              VARCHAR(100) UNIQUE NOT NULL,
    name               VARCHAR(100)        NOT NULL,
    password           TEXT                NOT NULL,
    role               VARCHAR(12)         NOT NULL DEFAULT 'superadmin' CHECK (role IN ('superadmin', 'readonly')),
    disabled           BOOLEAN             NOT NULL DEFAULT FALSE,
    token_version      INT                 NOT NULL DEFAULT 0,
    -- Two-factor auth is mandatory: an admin without totp_enabled must enrol at first login.
    totp_secret        TEXT,
    totp_enabled       BOOLEAN             NOT NULL DEFAULT FALSE,
    totp_last_used_step BIGINT,
    -- SHA-256 hex of each unused one-time backup code.
    backup_code_hashes TEXT[]              NOT NULL DEFAULT '{}',
    failed_login_count SMALLINT            NOT NULL DEFAULT 0,
    lockout_until      TIMESTAMPTZ,
    last_login_date    TIMESTAMPTZ,
    created_date       TIMESTAMPTZ         NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_sessions
(
    id             SERIAL PRIMARY KEY,
    admin_id       INT         NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
    session_key    TEXT        NOT NULL UNIQUE,
    user_agent     TEXT,
    ip_address     VARCHAR(45),
    created_date   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_date   TIMESTAMPTZ,
    -- Dangerous actions need a fresh password + TOTP check (POST /auth/reauth); this is
    -- until when this session counts as freshly verified.
    reauth_until   TIMESTAMPTZ
);
CREATE INDEX idx_admin_sessions_admin ON admin_sessions (admin_id);

ALTER TABLE app_settings
    ADD CONSTRAINT app_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES admin_users (id) ON DELETE SET NULL;

-- ============================================================
-- Admin audit log - append only
-- ============================================================

-- What every admin did. admin_email is a snapshot so the trail survives deleting the admin.
-- A trigger rejects UPDATE/DELETE/TRUNCATE: not even an admin can rewrite history from the portal.
CREATE TABLE admin_audit_log
(
    id           BIGSERIAL PRIMARY KEY,
    admin_id     INT,
    admin_email  VARCHAR(100),
    action       VARCHAR(60) NOT NULL,
    entity_type  VARCHAR(30),
    entity_id    INT,
    entity_label VARCHAR(150),
    metadata     JSONB       NOT NULL DEFAULT '{}',
    ip_address   VARCHAR(45),
    created_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_admin_audit_log_created ON admin_audit_log (created_date DESC);

CREATE FUNCTION admin_audit_log_append_only() RETURNS trigger AS
$$
BEGIN
    RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admin_audit_log_no_change
    BEFORE UPDATE OR DELETE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION admin_audit_log_append_only();
CREATE TRIGGER trg_admin_audit_log_no_truncate
    BEFORE TRUNCATE ON admin_audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_log_append_only();

-- ============================================================
-- Security events and IP blocking
-- ============================================================

-- Aggregated per (type, ip, minute) so a flood of requests is one row, not a million.
-- Types: rate_limited, login_failed, login_locked, admin_login_failed, blocked_ip_hit.
CREATE TABLE security_events
(
    type       VARCHAR(30)  NOT NULL,
    ip_address VARCHAR(45)  NOT NULL,
    bucket     TIMESTAMPTZ  NOT NULL,
    count      INT          NOT NULL DEFAULT 1,
    user_agent TEXT,
    last_path  VARCHAR(200),
    detail     VARCHAR(200),
    PRIMARY KEY (type, ip_address, bucket)
);
CREATE INDEX idx_security_events_bucket ON security_events (bucket DESC);

CREATE TABLE blocked_ips
(
    ip_address   VARCHAR(45) PRIMARY KEY,
    reason       VARCHAR(200),
    blocked_by   INT REFERENCES admin_users (id) ON DELETE SET NULL,
    created_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- NULL = until unblocked by hand.
    expires_at   TIMESTAMPTZ
);

-- ============================================================
-- Deleting accounts and vaults with a grace period
-- ============================================================

-- A delete from the portal first locks the account/vault out and only really deletes
-- it once execute_after has passed, so a mistake can be cancelled.
CREATE TABLE scheduled_deletions
(
    id            SERIAL PRIMARY KEY,
    entity_type   VARCHAR(10)  NOT NULL CHECK (entity_type IN ('user', 'vault')),
    entity_id     INT          NOT NULL,
    entity_label  VARCHAR(150) NOT NULL,
    requested_by  INT REFERENCES admin_users (id) ON DELETE SET NULL,
    requested_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    execute_after TIMESTAMPTZ  NOT NULL,
    cancelled_at  TIMESTAMPTZ,
    executed_at   TIMESTAMPTZ,
    last_error    TEXT
);
-- At most one open deletion per entity.
CREATE UNIQUE INDEX idx_scheduled_deletions_open
    ON scheduled_deletions (entity_type, entity_id) WHERE cancelled_at IS NULL AND executed_at IS NULL;

-- ============================================================
-- Account and vault state set from the portal
-- ============================================================

-- Why an account is disabled: 'pending_approval' (new registration waiting for an admin),
-- 'pending_deletion' (deletion scheduled), 'admin' (suspended by an admin). NULL on
-- accounts disabled before this column existed.
ALTER TABLE users ADD COLUMN disabled_reason VARCHAR(20);
UPDATE users SET disabled_reason = 'pending_approval' WHERE disabled = TRUE AND last_login_date IS NULL;

-- A suspended vault resolves to nothing for its members (see AuthRepository).
ALTER TABLE vault ADD COLUMN suspended_at TIMESTAMPTZ;
ALTER TABLE vault ADD COLUMN suspended_reason VARCHAR(20);

-- ============================================================
-- Plans and quotas (only enforced while the portal is enabled)
-- ============================================================

-- A NULL limit means unlimited. A vault with no plan uses the default plan, if any.
CREATE TABLE plans
(
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(30) UNIQUE NOT NULL,
    name           VARCHAR(60)        NOT NULL,
    max_books      INT CHECK (max_books IS NULL OR max_books >= 0),
    max_members    INT CHECK (max_members IS NULL OR max_members >= 1),
    max_storage_mb INT CHECK (max_storage_mb IS NULL OR max_storage_mb >= 0),
    is_default     BOOLEAN            NOT NULL DEFAULT FALSE,
    created_date   TIMESTAMPTZ        NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_plans_single_default ON plans (is_default) WHERE is_default;

ALTER TABLE vault ADD COLUMN plan_id INT REFERENCES plans (id) ON DELETE SET NULL;

-- ============================================================
-- Log of emails sent to users (shown in the admin portal)
-- ============================================================

-- Who was mailed, what subject, and whether the SMTP server accepted it. The message body is
-- deliberately NOT stored: it carries verification links.
CREATE TABLE mail_log
(
    id           BIGSERIAL PRIMARY KEY,
    to_address   VARCHAR(255) NOT NULL,
    subject      VARCHAR(255) NOT NULL,
    status       VARCHAR(10)  NOT NULL CHECK (status IN ('sent', 'failed')),
    error        TEXT,
    created_date TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_mail_log_created ON mail_log (created_date DESC);
