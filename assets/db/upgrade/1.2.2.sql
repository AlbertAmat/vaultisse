-- Upgrade to v1.2.2 - schema changes made on 2026-09-22.
-- Brings an already-installed database in line with the v1.2.2 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)

-- Per-account brute-force protection (security audit #5): login and 2FA
-- rate limiting was previously per-IP only (server/src/routes/auth/AuthRoute.ts),
-- so credential stuffing spread across many IPs, or an attacker who already
-- knows the password, wasn't slowed down at all. AuthService.ts now locks an
-- account out for a while after too many wrong passwords, and separately
-- after too many wrong 2FA codes during the same pending login.
ALTER TABLE users
    ADD COLUMN failed_login_count SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN lockout_until TIMESTAMP,
    ADD COLUMN totp_failed_count SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN totp_lockout_until TIMESTAMP,
    -- Absolute TOTP time-step of the last code accepted at login, so the
    -- exact same 6-digit code can't be replayed a second time inside its
    -- ~30s validity window (security audit #5). See TwoFactorAuth.ts.
    ADD COLUMN totp_last_used_step BIGINT;
