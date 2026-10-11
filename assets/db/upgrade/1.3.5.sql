-- Upgrade to v1.3.5 - schema changes made on 2026-10-11.
-- Brings an already-installed database in line with the v1.3.5 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)

-- ============================================================
-- Loans are a vault setting, not a per-user one
-- ============================================================

-- vault.leasing_enabled becomes vault.loans_enabled (one term - "loans" - for
-- the whole feature) and is now the only switch for it.
ALTER TABLE vault
    RENAME COLUMN leasing_enabled TO loans_enabled;

-- Keep the feature on for every vault already using it: a member had the old
-- per-user switch on, or the vault already has borrower members or books on loan.
UPDATE vault v
   SET loans_enabled = TRUE
 WHERE EXISTS (SELECT 1
                 FROM vault_users vu
                 JOIN users u ON u.id = vu.user_id
                WHERE vu.vault_id = v.id
                  AND vu.status = 1
                  AND u.leasing_enabled)
    OR EXISTS (SELECT 1 FROM vault_users vu WHERE vu.vault_id = v.id AND vu.role = 2)
    OR EXISTS (SELECT 1 FROM book_stocks bs WHERE bs.vault_id = v.id AND bs.status = 2);

ALTER TABLE users
    DROP COLUMN leasing_enabled;

-- UI labels: the switch moved from Settings > Features to the vault settings.
DELETE FROM app_labels WHERE code = 'SNACKBAR_LEASING_UPDATED';
UPDATE app_labels SET code = 'VAULT_LOANS' WHERE code = 'USERCONF_LEASING';
UPDATE app_labels SET code = 'VAULT_LOANS_DESC' WHERE code = 'USERCONF_LEASING_DESC';
UPDATE app_labels SET text = 'Loans' WHERE language = 'en' AND code = 'VAULT_LOANS';
UPDATE app_labels
   SET text = 'Track who''s borrowing what. Turns on the Loans and Customers pages and the borrower role for this vault.'
 WHERE language = 'en' AND code = 'VAULT_LOANS_DESC';
