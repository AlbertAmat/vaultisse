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
