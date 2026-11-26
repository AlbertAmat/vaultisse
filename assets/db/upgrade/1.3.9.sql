-- Upgrade to v1.3.9 - schema changes made on 2026-11-26.
-- Brings an already-installed database in line with the v1.3.9 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)

-- ============================================================
-- Optional SMTP: email verification
-- ============================================================

-- FALSE only while a new registration still has to confirm its address
-- (only when SMTP is configured). Existing accounts count as verified.
ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT TRUE;

-- One pending verification link per user: a new registration (new_email NULL)
-- or an email change awaiting confirmation. Only the token's SHA-256 is stored.
CREATE TABLE user_email_verifications
(
    user_id    INT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    token_hash CHAR(64)     NOT NULL UNIQUE,
    new_email  VARCHAR(100),
    sent_at    TIMESTAMPTZ  NOT NULL,
    expires_at TIMESTAMPTZ  NOT NULL
);

-- ============================================================
-- Optional deletion of inactive accounts
-- ============================================================

-- Inactive-account deletion (see InactivityService.ts): last use that doesn't
-- go through a session (OPDS), and when the deletion warning was sent.
ALTER TABLE users ADD COLUMN last_activity_date TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN deletion_warned_at TIMESTAMPTZ;

-- ============================================================
-- Stock label print date
-- ============================================================

-- When this copy's barcode label was last printed (the label PDF generated);
-- NULL = never.
ALTER TABLE book_stocks ADD COLUMN label_printed_at TIMESTAMPTZ;

INSERT INTO app_labels (language, code, text)
VALUES ('en', 'SNACKBAR_EMAIL_VERIFICATION_SENT', 'Check your new email address and follow the link to confirm the change'),
       ('ca', 'SNACKBAR_EMAIL_VERIFICATION_SENT', 'Revisa la nova adreça de correu i segueix l''enllaç per confirmar el canvi'),
       ('es', 'SNACKBAR_EMAIL_VERIFICATION_SENT', 'Revisa tu nueva dirección de correo y sigue el enlace para confirmar el cambio'),
       ('it', 'SNACKBAR_EMAIL_VERIFICATION_SENT', 'Controlla il nuovo indirizzo email e segui il link per confermare la modifica'),
       ('fr', 'SNACKBAR_EMAIL_VERIFICATION_SENT', 'Consulte ta nouvelle adresse e-mail et suis le lien pour confirmer le changement'),
       ('de', 'SNACKBAR_EMAIL_VERIFICATION_SENT', 'Prüfe deine neue E-Mail-Adresse und folge dem Link, um die Änderung zu bestätigen');

-- ============================================================
-- Lend/Return actions on book stock (issue #41)
-- ============================================================

-- "Booked" reads as "On loan" / "Lent to" (the status value is unchanged).
UPDATE app_labels SET text = v.text
  FROM (VALUES ('en', 'BOOKED', 'On loan'),
               ('ca', 'BOOKED', 'En préstec'),
               ('es', 'BOOKED', 'Prestado'),
               ('it', 'BOOKED', 'In prestito'),
               ('fr', 'BOOKED', 'En prêt'),
               ('de', 'BOOKED', 'Ausgeliehen'),
               ('en', 'BOOKED_BY', 'Lent to'),
               ('ca', 'BOOKED_BY', 'Prestat a'),
               ('es', 'BOOKED_BY', 'Prestado a'),
               ('it', 'BOOKED_BY', 'Prestato a'),
               ('fr', 'BOOKED_BY', 'Prêté à'),
               ('de', 'BOOKED_BY', 'Ausgeliehen an'),
               ('en', 'BOOKED_BOOKS', 'Books on loan'),
               ('ca', 'BOOKED_BOOKS', 'Llibres en préstec'),
               ('es', 'BOOKED_BOOKS', 'Libros prestados'),
               ('it', 'BOOKED_BOOKS', 'Libri in prestito'),
               ('fr', 'BOOKED_BOOKS', 'Livres en prêt'),
               ('de', 'BOOKED_BOOKS', 'Ausgeliehene Bücher')) AS v(language, code, text)
 WHERE app_labels.language = v.language AND app_labels.code = v.code;

INSERT INTO app_labels (language, code, text)
VALUES ('en', 'LEND', 'Lend'),
       ('ca', 'LEND', 'Presta'),
       ('es', 'LEND', 'Prestar'),
       ('it', 'LEND', 'Presta'),
       ('fr', 'LEND', 'Prêter'),
       ('de', 'LEND', 'Verleihen'),
       ('en', 'LEND_BOOK', 'Lend this copy'),
       ('ca', 'LEND_BOOK', 'Presta aquest exemplar'),
       ('es', 'LEND_BOOK', 'Prestar este ejemplar'),
       ('it', 'LEND_BOOK', 'Presta questa copia'),
       ('fr', 'LEND_BOOK', 'Prêter cet exemplaire'),
       ('de', 'LEND_BOOK', 'Dieses Exemplar verleihen'),
       ('en', 'LENT_TO_NAME', 'Lent to {name}'),
       ('ca', 'LENT_TO_NAME', 'Prestat a {name}'),
       ('es', 'LENT_TO_NAME', 'Prestado a {name}'),
       ('it', 'LENT_TO_NAME', 'Prestato a {name}'),
       ('fr', 'LENT_TO_NAME', 'Prêté à {name}'),
       ('de', 'LENT_TO_NAME', 'Ausgeliehen an {name}');
