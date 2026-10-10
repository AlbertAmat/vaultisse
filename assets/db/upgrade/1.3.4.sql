-- Upgrade to v1.3.4 - schema changes made on 2026-10-10.
-- Brings an already-installed database in line with the v1.3.4 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)

-- ============================================================
-- Loans to vault members (not just customers)
-- ============================================================

-- book_stocks: a booked copy is now on loan to exactly one of a customer
-- (customer_id) or a vault member (member_user_id).
ALTER TABLE book_stocks
    ADD COLUMN member_user_id INT REFERENCES users (id);

-- The old CHECK was auto-named, so find it by its definition and drop it.
DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'book_stocks'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%customer_id%'
    LOOP
        EXECUTE format('ALTER TABLE book_stocks DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE book_stocks
    ADD CONSTRAINT book_stocks_borrower_check CHECK (
        (status = 2 AND (customer_id IS NOT NULL) <> (member_user_id IS NOT NULL)) OR
        (status != 2 AND customer_id IS NULL AND member_user_id IS NULL)
    );

-- loan_history: the borrower is now referenced (customer_id / member_user_id /
-- group_id), not snapshotted by name, so renames show up everywhere.
-- Deleting the customer or user deletes their history, so rows whose customer
-- was already deleted (customer_id NULL) have no borrower left and are removed.
DELETE FROM loan_history WHERE customer_id IS NULL;

ALTER TABLE loan_history
    DROP COLUMN customer_name,
    DROP COLUMN group_name,
    ADD COLUMN member_user_id INT REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE loan_history
    DROP CONSTRAINT loan_history_customer_id_fkey,
    ADD CONSTRAINT loan_history_customer_id_fkey
        FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE;

ALTER TABLE loan_history
    ADD CONSTRAINT loan_history_borrower_check CHECK (
        (customer_id IS NOT NULL AND member_user_id IS NULL) OR
        (customer_id IS NULL AND member_user_id IS NOT NULL AND group_id IS NULL)
    );

-- ============================================================
-- Per-user reading status
-- ============================================================

CREATE TABLE book_reading_status
(
    book_id INT      NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    user_id INT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status  SMALLINT NOT NULL CHECK (status IN (0, 1, 2)),
    PRIMARY KEY (book_id, user_id)
);

-- books.reading_status was shared by the whole vault; hand each existing value
-- to every accepted admin of the book's vault (the members who could set it).
INSERT INTO book_reading_status (book_id, user_id, status)
SELECT b.id, vu.user_id, b.reading_status
  FROM books b
  JOIN vault_users vu ON vu.vault_id = b.vault_id AND vu.role = 1 AND vu.status = 1
 WHERE b.reading_status IS NOT NULL;

ALTER TABLE books DROP COLUMN reading_status;

-- ============================================================
-- "My loans" page labels
-- ============================================================

INSERT INTO app_labels (language, code, text)
VALUES ('en', 'MY_LOANS', 'My loans'),
       ('ca', 'MY_LOANS', 'Els meus préstecs'),
       ('de', 'MY_LOANS', 'Meine Ausleihen'),
       ('es', 'MY_LOANS', 'Mis préstamos'),
       ('fr', 'MY_LOANS', 'Mes emprunts'),
       ('it', 'MY_LOANS', 'I miei prestiti'),
       ('en', 'LOAN_HISTORY', 'Loan history'),
       ('ca', 'LOAN_HISTORY', 'Historial de préstecs'),
       ('de', 'LOAN_HISTORY', 'Ausleihverlauf'),
       ('es', 'LOAN_HISTORY', 'Historial de préstamos'),
       ('fr', 'LOAN_HISTORY', 'Historique des prêts'),
       ('it', 'LOAN_HISTORY', 'Storico dei prestiti');

-- Empty-state text for the "My loans" tabs

INSERT INTO app_labels (language, code, text)
VALUES ('en', 'MY_LOANS_EMPTY_DESC', 'Books you borrow from this library will show up here.'),
       ('en', 'MY_LOAN_HISTORY_EMPTY', 'You haven''t borrowed any books yet'),
       ('ca', 'MY_LOANS_EMPTY_DESC', 'Els llibres que agafis en préstec d''aquesta biblioteca apareixeran aquí.'),
       ('ca', 'MY_LOAN_HISTORY_EMPTY', 'Encara no has agafat cap llibre en préstec'),
       ('de', 'MY_LOANS_EMPTY_DESC', 'Bücher, die du aus dieser Bibliothek ausleihst, erscheinen hier.'),
       ('de', 'MY_LOAN_HISTORY_EMPTY', 'Du hast noch keine Bücher ausgeliehen'),
       ('es', 'MY_LOANS_EMPTY_DESC', 'Los libros que tomes prestados de esta biblioteca aparecerán aquí.'),
       ('es', 'MY_LOAN_HISTORY_EMPTY', 'Todavía no has tomado prestado ningún libro'),
       ('fr', 'MY_LOANS_EMPTY_DESC', 'Les livres que vous empruntez à cette bibliothèque apparaîtront ici.'),
       ('fr', 'MY_LOAN_HISTORY_EMPTY', 'Vous n''avez encore emprunté aucun livre'),
       ('it', 'MY_LOANS_EMPTY_DESC', 'I libri che prendi in prestito da questa biblioteca appariranno qui.'),
       ('it', 'MY_LOAN_HISTORY_EMPTY', 'Non hai ancora preso in prestito nessun libro');
