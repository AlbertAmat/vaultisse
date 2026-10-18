-- Upgrade to v1.3.6 - schema changes made on 2026-10-18.
-- Brings an already-installed database in line with the v1.3.6 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)

-- ============================================================
-- Vault member roles from SSO groups (issue #29)
-- ============================================================

-- 0 = the role was set by hand (default), 1 = it follows the member's SSO
-- groups and is re-applied at each SSO login.
ALTER TABLE vault_users
    ADD COLUMN role_source SMALLINT NOT NULL DEFAULT 0;

-- UI label for the role picker's extra option
INSERT INTO app_labels (language, code, text)
VALUES
       ('en', 'VAULT_ROLE_FROM_SSO', 'Based on SSO groups'),
       ('ca', 'VAULT_ROLE_FROM_SSO', 'Segons els grups SSO'),
       ('es', 'VAULT_ROLE_FROM_SSO', 'Según los grupos SSO'),
       ('it', 'VAULT_ROLE_FROM_SSO', 'In base ai gruppi SSO'),
       ('fr', 'VAULT_ROLE_FROM_SSO', 'Selon les groupes SSO'),
       ('de', 'VAULT_ROLE_FROM_SSO', 'Nach SSO-Gruppen');
