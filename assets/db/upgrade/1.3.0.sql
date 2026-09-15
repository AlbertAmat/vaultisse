-- Upgrade to v1.3.0 - schema changes made on 2026-09-15.
-- Brings an already-installed database in line with the v1.3.0 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)

-- ============================================================
-- Multi-user vault sharing (issue #7)
-- New tables, alters, and backfill migration
-- ============================================================
--
-- Sequencing:
--   1. Run "NEW TABLES"
--   2. Run "ALTERS" (adds vault_id nullable, renames user_id -> user_created)
--   3. Run "BACKFILL" (creates one vault per existing user, populates vault_id)
--   4. Run "TIGHTEN CONSTRAINTS" (sets vault_id NOT NULL now data exists)
--
-- Open product decisions not resolved by this schema (flag to reviewers):
--   - book_stocks.code: kept globally UNIQUE (not vault-scoped) since it's
--     a physical printed barcode; change to UNIQUE (code, vault_id) if two
--     vaults printing the same code is not a real-world concern.
--   - "vault must have >= 1 admin" is enforced by the trigger below at the
--     DB level; app-level UI should also block the action before it ever
--     hits the DB, for a better error message.
--   - users.leasing_enabled is superseded by vault.leasing_enabled but left
--     in place here; drop it in a follow-up migration once app code reads
--     vault.leasing_enabled exclusively.
--   - Deleting a vault is intentionally left blocked (default RESTRICT) as
--     long as it still owns any content - there's no cascade-delete-a-shared-
--     library path today. Revisit once a "delete vault" feature exists.

-- ============================================================
-- 1. NEW TABLES
-- ============================================================

CREATE TABLE vault
(
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(65) NOT NULL,
    description      VARCHAR(255),
    invitation_uuid  UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    leasing_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    date_created     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Role lookup table. `rank` (not `code`) is what "most permissive wins"
-- logic should compare on, since code values don't sort in permission order.
CREATE TABLE vault_roles
(
    code                SMALLINT PRIMARY KEY,
    name                VARCHAR(30) NOT NULL UNIQUE,
    rank                SMALLINT NOT NULL UNIQUE,
    can_borrow          BOOLEAN NOT NULL DEFAULT FALSE,
    can_edit_catalog    BOOLEAN NOT NULL DEFAULT FALSE,
    can_manage_members  BOOLEAN NOT NULL DEFAULT FALSE,
    can_manage_settings BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO vault_roles (code, name, rank, can_borrow, can_edit_catalog, can_manage_members, can_manage_settings)
VALUES
    (3, 'readonly', 0, FALSE, FALSE, FALSE, FALSE),
    (2, 'borrower', 1, TRUE,  FALSE, FALSE, FALSE),
    (0, 'normal',   2, TRUE,  TRUE,  FALSE, FALSE),
    (1, 'admin',    3, TRUE,  TRUE,  TRUE,  TRUE);

CREATE TABLE vault_users
(
    vault_id     INT NOT NULL REFERENCES vault (id) ON DELETE CASCADE,
    user_id      INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role         SMALLINT NOT NULL DEFAULT 0 REFERENCES vault_roles (code),
    status       SMALLINT NOT NULL DEFAULT 0, -- 0 pending, 1 accepted, 2 rejected
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (vault_id, user_id)
);

-- Enforces "a vault must keep at least one admin" at the DB level.
CREATE OR REPLACE FUNCTION enforce_vault_has_admin()
RETURNS TRIGGER AS $$
DECLARE
  remaining_admins INT;
  affected_vault INT := COALESCE(OLD.vault_id, NEW.vault_id);
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 1) OR
     (TG_OP = 'UPDATE' AND OLD.role = 1 AND NEW.role != 1) THEN
    SELECT count(*) INTO remaining_admins
    FROM vault_users
    WHERE vault_id = affected_vault AND role = 1 AND user_id != OLD.user_id;
    IF remaining_admins = 0 THEN
      RAISE EXCEPTION 'Vault % must keep at least one admin', affected_vault;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vault_min_one_admin
    BEFORE UPDATE OR DELETE ON vault_users
    FOR EACH ROW
EXECUTE FUNCTION enforce_vault_has_admin();

-- ============================================================
-- 2. ALTERS
-- ============================================================

-- users: track which vault to load on login
ALTER TABLE users ADD COLUMN last_used_vault_id INT REFERENCES vault (id);

-- customer_groups
ALTER TABLE customer_groups ADD COLUMN vault_id INT REFERENCES vault (id);
ALTER TABLE customer_groups RENAME COLUMN user_id TO user_created;
ALTER TABLE customer_groups ALTER COLUMN user_created DROP NOT NULL;
ALTER TABLE customer_groups DROP CONSTRAINT customer_groups_user_id_fkey;
ALTER TABLE customer_groups ADD FOREIGN KEY (user_created) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE customer_groups DROP CONSTRAINT unique_user_customer_group;
ALTER TABLE customer_groups ADD CONSTRAINT unique_vault_customer_group UNIQUE (vault_id, name);

-- customers
ALTER TABLE customers ADD COLUMN vault_id INT REFERENCES vault (id);
ALTER TABLE customers RENAME COLUMN user_id TO user_created;
ALTER TABLE customers ALTER COLUMN user_created DROP NOT NULL;
ALTER TABLE customers DROP CONSTRAINT customers_user_id_fkey;
ALTER TABLE customers ADD FOREIGN KEY (user_created) REFERENCES users (id) ON DELETE SET NULL;

-- locations
ALTER TABLE locations ADD COLUMN vault_id INT REFERENCES vault (id);
ALTER TABLE locations RENAME COLUMN user_id TO user_created;
ALTER TABLE locations ALTER COLUMN user_created DROP NOT NULL;
ALTER TABLE locations DROP CONSTRAINT locations_user_id_fkey;
ALTER TABLE locations ADD FOREIGN KEY (user_created) REFERENCES users (id) ON DELETE SET NULL;
DROP INDEX locations_one_default_per_user;
CREATE UNIQUE INDEX locations_one_default_per_vault ON locations (vault_id) WHERE "default";

-- categories
ALTER TABLE categories ADD COLUMN vault_id INT REFERENCES vault (id);
ALTER TABLE categories RENAME COLUMN user_id TO user_created;
ALTER TABLE categories ALTER COLUMN user_created DROP NOT NULL;
ALTER TABLE categories DROP CONSTRAINT categories_user_id_fkey;
ALTER TABLE categories ADD FOREIGN KEY (user_created) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE categories DROP CONSTRAINT unique_user_category;
ALTER TABLE categories ADD CONSTRAINT unique_vault_category UNIQUE (vault_id, name);

-- authors
ALTER TABLE authors ADD COLUMN vault_id INT REFERENCES vault (id);
ALTER TABLE authors RENAME COLUMN user_id TO user_created;
ALTER TABLE authors ALTER COLUMN user_created DROP NOT NULL;
ALTER TABLE authors DROP CONSTRAINT authors_user_id_fkey;
ALTER TABLE authors ADD FOREIGN KEY (user_created) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE authors DROP CONSTRAINT unique_user_author;
ALTER TABLE authors ADD CONSTRAINT unique_vault_author UNIQUE (vault_id, name);

-- books
ALTER TABLE books ADD COLUMN vault_id INT REFERENCES vault (id);
ALTER TABLE books RENAME COLUMN user_id TO user_created;
ALTER TABLE books ALTER COLUMN user_created DROP NOT NULL;
ALTER TABLE books DROP CONSTRAINT books_user_id_fkey;
ALTER TABLE books ADD FOREIGN KEY (user_created) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE books DROP CONSTRAINT books_isbn_user_unique;
ALTER TABLE books ADD CONSTRAINT books_isbn_vault_unique UNIQUE (isbn, vault_id);

-- book_authors (pure join table — drop user_id rather than rename it)
ALTER TABLE book_authors ADD COLUMN vault_id INT REFERENCES vault (id);
ALTER TABLE book_authors DROP COLUMN user_id;

-- book_stocks
ALTER TABLE book_stocks ADD COLUMN vault_id INT REFERENCES vault (id);
ALTER TABLE book_stocks RENAME COLUMN user_id TO user_created;
ALTER TABLE book_stocks ALTER COLUMN user_created DROP NOT NULL;
ALTER TABLE book_stocks DROP CONSTRAINT book_stocks_user_id_fkey;
ALTER TABLE book_stocks ADD FOREIGN KEY (user_created) REFERENCES users (id) ON DELETE SET NULL;
-- code (printed barcode) stays globally UNIQUE, not vault-scoped — see note at top of file

-- loan_history
ALTER TABLE loan_history ADD COLUMN vault_id INT REFERENCES vault (id);
ALTER TABLE loan_history RENAME COLUMN user_id TO user_created;
ALTER TABLE loan_history ALTER COLUMN user_created DROP NOT NULL;
ALTER TABLE loan_history DROP CONSTRAINT loan_history_user_id_fkey;
ALTER TABLE loan_history ADD FOREIGN KEY (user_created) REFERENCES users (id) ON DELETE SET NULL;
-- Reports/queries now scope by vault, not by the individual who created the
-- loan — replace the per-user index with a per-vault one.
DROP INDEX idx_loan_history_user_loaned_at;
CREATE INDEX idx_loan_history_vault_loaned_at ON loan_history (vault_id, loaned_at DESC);

-- book_files
ALTER TABLE book_files ADD COLUMN vault_id INT REFERENCES vault (id);
ALTER TABLE book_files RENAME COLUMN user_id TO user_created;
ALTER TABLE book_files ALTER COLUMN user_created DROP NOT NULL;
ALTER TABLE book_files DROP CONSTRAINT book_files_user_id_fkey;
ALTER TABLE book_files ADD FOREIGN KEY (user_created) REFERENCES users (id) ON DELETE SET NULL;

-- ============================================================
-- 3. BACKFILL: one vault per existing user, populate vault_id everywhere
-- ============================================================

DO $$
DECLARE
    u RECORD;
    new_vault_id INT;
BEGIN
    FOR u IN SELECT id, name, leasing_enabled FROM users LOOP
        INSERT INTO vault (name, leasing_enabled)
        VALUES (u.name || '''s library', u.leasing_enabled)
        RETURNING id INTO new_vault_id;

        INSERT INTO vault_users (vault_id, user_id, role, status)
        VALUES (new_vault_id, u.id, 1, 1);

        UPDATE users SET last_used_vault_id = new_vault_id WHERE id = u.id;

        UPDATE customer_groups SET vault_id = new_vault_id WHERE user_created = u.id;
        UPDATE customers       SET vault_id = new_vault_id WHERE user_created = u.id;
        UPDATE locations       SET vault_id = new_vault_id WHERE user_created = u.id;
        UPDATE categories      SET vault_id = new_vault_id WHERE user_created = u.id;
        UPDATE authors         SET vault_id = new_vault_id WHERE user_created = u.id;
        UPDATE books           SET vault_id = new_vault_id WHERE user_created = u.id;
        UPDATE book_stocks     SET vault_id = new_vault_id WHERE user_created = u.id;
        UPDATE loan_history    SET vault_id = new_vault_id WHERE user_created = u.id;
        UPDATE book_files      SET vault_id = new_vault_id WHERE user_created = u.id;

        -- book_authors has no user_created left to key off — derive from books
        UPDATE book_authors ba SET vault_id = new_vault_id
        FROM books b
        WHERE ba.book_id = b.id AND b.vault_id = new_vault_id AND ba.vault_id IS NULL;
    END LOOP;
END $$;

-- ============================================================
-- 4. TIGHTEN CONSTRAINTS: vault_id NOT NULL now every row has one
-- ============================================================

ALTER TABLE customer_groups ALTER COLUMN vault_id SET NOT NULL;
ALTER TABLE customers       ALTER COLUMN vault_id SET NOT NULL;
ALTER TABLE locations       ALTER COLUMN vault_id SET NOT NULL;
ALTER TABLE categories      ALTER COLUMN vault_id SET NOT NULL;
ALTER TABLE authors         ALTER COLUMN vault_id SET NOT NULL;
ALTER TABLE books           ALTER COLUMN vault_id SET NOT NULL;
ALTER TABLE book_authors    ALTER COLUMN vault_id SET NOT NULL;
ALTER TABLE book_stocks     ALTER COLUMN vault_id SET NOT NULL;
ALTER TABLE loan_history    ALTER COLUMN vault_id SET NOT NULL;
ALTER TABLE book_files      ALTER COLUMN vault_id SET NOT NULL;
