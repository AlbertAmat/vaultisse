-- Upgrade to v1.1.7 - schema changes made on 2026-09-13.
-- Brings an already-installed database in line with the v1.1.7 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)

-- Optional OIDC link on users: issuer URL + subject from the IdP, used by
-- GET /auth/oidc/callback to find or JIT-provision an account (see
-- server/src/utils/OidcUsers.ts). Password-only rows stay NULL; UNIQUE
-- allows several NULLs so existing local accounts are unaffected.
ALTER TABLE users ADD COLUMN oidc_issuer TEXT;
ALTER TABLE users ADD COLUMN oidc_sub TEXT;
ALTER TABLE users ADD CONSTRAINT users_oidc_issuer_sub_unique UNIQUE (oidc_issuer, oidc_sub);
