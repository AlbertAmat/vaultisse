-- Upgrade to v1.3.9 - schema changes made on 2026-11-26 and 2026-11-27.
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

-- ============================================================
-- Customer library cards
-- ============================================================

-- Library card data. The uuid is what the card's barcode carries.
ALTER TABLE customers ADD COLUMN uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE customers ADD COLUMN image BYTEA;
ALTER TABLE customers ADD COLUMN member_since DATE NOT NULL DEFAULT CURRENT_DATE;

-- What every card of a vault shows besides the customer's own data.
CREATE TABLE customer_card_settings
(
    vault_id     INT PRIMARY KEY REFERENCES vault (id) ON DELETE CASCADE,
    field1_label VARCHAR(30),
    field1_value VARCHAR(60),
    field2_label VARCHAR(30),
    field2_value VARCHAR(60),
    background   BYTEA
);

-- Existing customers: date their membership from their first recorded loan.
UPDATE customers c SET member_since = h.first_loan
  FROM (SELECT customer_id, MIN(loaned_at)::date AS first_loan FROM loan_history WHERE customer_id IS NOT NULL GROUP BY customer_id) h
 WHERE h.customer_id = c.id;

INSERT INTO app_labels (language, code, text)
VALUES ('en', 'CUSTOMER_CARD', 'Library card'),
       ('ca', 'CUSTOMER_CARD', 'Carnet de biblioteca'),
       ('es', 'CUSTOMER_CARD', 'Carné de biblioteca'),
       ('it', 'CUSTOMER_CARD', 'Tessera della biblioteca'),
       ('fr', 'CUSTOMER_CARD', 'Carte de bibliothèque'),
       ('de', 'CUSTOMER_CARD', 'Bibliotheksausweis'),
       ('en', 'CARD_SETUP', 'Card setup'),
       ('ca', 'CARD_SETUP', 'Configura el carnet'),
       ('es', 'CARD_SETUP', 'Configurar carné'),
       ('it', 'CARD_SETUP', 'Imposta tessera'),
       ('fr', 'CARD_SETUP', 'Configurer la carte'),
       ('de', 'CARD_SETUP', 'Ausweis einrichten'),
       ('en', 'CARD_SCAN', 'Scan card'),
       ('ca', 'CARD_SCAN', 'Escaneja carnet'),
       ('es', 'CARD_SCAN', 'Escanear carné'),
       ('it', 'CARD_SCAN', 'Scansiona tessera'),
       ('fr', 'CARD_SCAN', 'Scanner une carte'),
       ('de', 'CARD_SCAN', 'Ausweis scannen'),
       ('en', 'CARD_CODE', 'Card code'),
       ('ca', 'CARD_CODE', 'Codi del carnet'),
       ('es', 'CARD_CODE', 'Código del carné'),
       ('it', 'CARD_CODE', 'Codice tessera'),
       ('fr', 'CARD_CODE', 'Code de la carte'),
       ('de', 'CARD_CODE', 'Ausweiscode'),
       ('en', 'CARD_FIELD_LABEL', 'Field {number}: label'),
       ('ca', 'CARD_FIELD_LABEL', 'Camp {number}: etiqueta'),
       ('es', 'CARD_FIELD_LABEL', 'Campo {number}: etiqueta'),
       ('it', 'CARD_FIELD_LABEL', 'Campo {number}: etichetta'),
       ('fr', 'CARD_FIELD_LABEL', 'Champ {number} : libellé'),
       ('de', 'CARD_FIELD_LABEL', 'Feld {number}: Bezeichnung'),
       ('en', 'CARD_FIELD_VALUE', 'Field {number}: value'),
       ('ca', 'CARD_FIELD_VALUE', 'Camp {number}: valor'),
       ('es', 'CARD_FIELD_VALUE', 'Campo {number}: valor'),
       ('it', 'CARD_FIELD_VALUE', 'Campo {number}: valore'),
       ('fr', 'CARD_FIELD_VALUE', 'Champ {number} : valeur'),
       ('de', 'CARD_FIELD_VALUE', 'Feld {number}: Wert'),
       ('en', 'CARD_BACKGROUND', 'Background image'),
       ('ca', 'CARD_BACKGROUND', 'Imatge de fons'),
       ('es', 'CARD_BACKGROUND', 'Imagen de fondo'),
       ('it', 'CARD_BACKGROUND', 'Immagine di sfondo'),
       ('fr', 'CARD_BACKGROUND', 'Image de fond'),
       ('de', 'CARD_BACKGROUND', 'Hintergrundbild'),
       ('en', 'CARD_PHOTO', 'Photo'),
       ('ca', 'CARD_PHOTO', 'Fotografia'),
       ('es', 'CARD_PHOTO', 'Fotografía'),
       ('it', 'CARD_PHOTO', 'Fotografia'),
       ('fr', 'CARD_PHOTO', 'Photo'),
       ('de', 'CARD_PHOTO', 'Foto'),
       ('en', 'CARD_MEMBER_SINCE', 'Member since'),
       ('ca', 'CARD_MEMBER_SINCE', 'Soci des de'),
       ('es', 'CARD_MEMBER_SINCE', 'Socio desde'),
       ('it', 'CARD_MEMBER_SINCE', 'Iscritto dal'),
       ('fr', 'CARD_MEMBER_SINCE', 'Membre depuis'),
       ('de', 'CARD_MEMBER_SINCE', 'Mitglied seit'),
       ('en', 'CARD_DOWNLOAD', 'Download card (PDF)'),
       ('ca', 'CARD_DOWNLOAD', 'Descarrega el carnet (PDF)'),
       ('es', 'CARD_DOWNLOAD', 'Descargar carné (PDF)'),
       ('it', 'CARD_DOWNLOAD', 'Scarica tessera (PDF)'),
       ('fr', 'CARD_DOWNLOAD', 'Télécharger la carte (PDF)'),
       ('de', 'CARD_DOWNLOAD', 'Ausweis herunterladen (PDF)'),
       ('en', 'CARD_LEND_SCAN', 'Scan a book to lend it'),
       ('ca', 'CARD_LEND_SCAN', 'Escaneja un llibre per prestar-lo'),
       ('es', 'CARD_LEND_SCAN', 'Escanea un libro para prestarlo'),
       ('it', 'CARD_LEND_SCAN', 'Scansiona un libro per prestarlo'),
       ('fr', 'CARD_LEND_SCAN', 'Scanne un livre pour le prêter'),
       ('de', 'CARD_LEND_SCAN', 'Buch zum Verleihen scannen'),
       ('en', 'SNACKBAR_CARD_SAVED', 'Card saved'),
       ('ca', 'SNACKBAR_CARD_SAVED', 'Carnet desat'),
       ('es', 'SNACKBAR_CARD_SAVED', 'Carné guardado'),
       ('it', 'SNACKBAR_CARD_SAVED', 'Tessera salvata'),
       ('fr', 'SNACKBAR_CARD_SAVED', 'Carte enregistrée'),
       ('de', 'SNACKBAR_CARD_SAVED', 'Ausweis gespeichert'),
       ('en', 'SNACKBAR_BOOK_LENT', 'Book lent'),
       ('ca', 'SNACKBAR_BOOK_LENT', 'Llibre prestat'),
       ('es', 'SNACKBAR_BOOK_LENT', 'Libro prestado'),
       ('it', 'SNACKBAR_BOOK_LENT', 'Libro prestato'),
       ('fr', 'SNACKBAR_BOOK_LENT', 'Livre prêté'),
       ('de', 'SNACKBAR_BOOK_LENT', 'Buch verliehen');

-- ============================================================
-- Add all unprinted stock labels to the print queue
-- ============================================================

INSERT INTO app_labels (language, code, text)
VALUES ('en', 'PRINT_ADD_PENDING', 'Add unprinted labels'),
       ('ca', 'PRINT_ADD_PENDING', 'Afegeix les etiquetes no impreses'),
       ('es', 'PRINT_ADD_PENDING', 'Añadir etiquetas sin imprimir'),
       ('it', 'PRINT_ADD_PENDING', 'Aggiungi etichette non stampate'),
       ('fr', 'PRINT_ADD_PENDING', 'Ajouter les étiquettes non imprimées'),
       ('de', 'PRINT_ADD_PENDING', 'Ungedruckte Etiketten hinzufügen'),
       ('en', 'SNACKBAR_NO_PENDING_LABELS', 'No labels pending to print'),
       ('ca', 'SNACKBAR_NO_PENDING_LABELS', 'No hi ha etiquetes pendents d’imprimir'),
       ('es', 'SNACKBAR_NO_PENDING_LABELS', 'No hay etiquetas pendientes de imprimir'),
       ('it', 'SNACKBAR_NO_PENDING_LABELS', 'Nessuna etichetta da stampare'),
       ('fr', 'SNACKBAR_NO_PENDING_LABELS', 'Aucune étiquette à imprimer'),
       ('de', 'SNACKBAR_NO_PENDING_LABELS', 'Keine Etiketten ausstehend'),
       ('en', 'SNACKBAR_PENDING_LABELS_ADDED', 'Labels added to the queue: {count}'),
       ('ca', 'SNACKBAR_PENDING_LABELS_ADDED', 'Etiquetes afegides a la cua: {count}'),
       ('es', 'SNACKBAR_PENDING_LABELS_ADDED', 'Etiquetas añadidas a la cola: {count}'),
       ('it', 'SNACKBAR_PENDING_LABELS_ADDED', 'Etichette aggiunte alla coda: {count}'),
       ('fr', 'SNACKBAR_PENDING_LABELS_ADDED', 'Étiquettes ajoutées à la file : {count}'),
       ('de', 'SNACKBAR_PENDING_LABELS_ADDED', 'Etiketten zur Warteschlange hinzugefügt: {count}'),
       ('en', 'SNACKBAR_PENDING_LABELS_MORE', 'Labels added: {count}. Print them, then add again: {remaining} more pending'),
       ('ca', 'SNACKBAR_PENDING_LABELS_MORE', 'Etiquetes afegides: {count}. Imprimeix-les i torna a afegir: en queden {remaining}'),
       ('es', 'SNACKBAR_PENDING_LABELS_MORE', 'Etiquetas añadidas: {count}. Imprímelas y vuelve a añadir: quedan {remaining}'),
       ('it', 'SNACKBAR_PENDING_LABELS_MORE', 'Etichette aggiunte: {count}. Stampale e aggiungi di nuovo: ne restano {remaining}'),
       ('fr', 'SNACKBAR_PENDING_LABELS_MORE', 'Étiquettes ajoutées : {count}. Imprime-les puis ajoute à nouveau : il en reste {remaining}'),
       ('de', 'SNACKBAR_PENDING_LABELS_MORE', 'Hinzugefügt: {count}. Drucken und erneut hinzufügen: noch {remaining} ausstehend');

-- ============================================================
-- Optional admin portal
-- ============================================================

-- Everything from here to the end belongs to the optional admin portal (ADMIN_ENABLED=true, see
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
    -- TRUE for the generated first admin and for admins created by another admin: the console makes
    -- them choose their own password before anything else.
    must_change_password BOOLEAN           NOT NULL DEFAULT FALSE,
    -- Whether this admin gets the portal's notification emails (new accounts to approve, problems, ...).
    notify_email       BOOLEAN             NOT NULL DEFAULT TRUE,
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
    -- Periodic review of who has admin access (ISO/IEC 27001 A.5.18): when an admin last confirmed this account
    -- still needs its access, and who did.
    access_reviewed_at TIMESTAMPTZ,
    access_reviewed_by INT,
    -- Password lifetime: when it was last set, the hashes of the last five (so they can't be reused) and the day an
    -- expiry reminder was last emailed (at most one a day).
    password_changed_at TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    password_history   TEXT[]          NOT NULL DEFAULT '{}',
    password_warned_on DATE,
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
    -- Entries are never changed. The only way one leaves is the retention job (Data retention page), which says so
    -- for its own transaction, and only for an entry older than 90 days: nobody can quietly erase recent history.
    IF TG_OP = 'DELETE' THEN
        IF current_setting('vaultisse.audit_retention', true) = 'on' AND OLD.created_date < CURRENT_TIMESTAMP - INTERVAL '90 days' THEN
            RETURN OLD;
        END IF;
    END IF;
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
    expires_at   TIMESTAMPTZ,
    -- TRUE when the portal blocked it by itself after too many failed logins.
    automatic    BOOLEAN     NOT NULL DEFAULT FALSE
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

-- ============================================================
-- Instance identity
-- ============================================================

-- A random id generated once per installation (new installs and upgrades alike), to tell instances
-- apart in the future. Never changed afterwards and not editable from the admin portal. Exists
-- whether or not the portal is enabled; the server also recreates it on start if it is missing.
INSERT INTO app_settings (key, value) VALUES ('INSTANCE_UUID', gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Notifications sent to admins (shown in the admin portal)
-- ============================================================

-- What the portal told its admins by email and how it went. 'skipped' = nothing was sent (email not
-- configured, or no admin subscribed). dedupe_key stops the same alert from being sent over and over.
CREATE TABLE admin_notifications
(
    id           BIGSERIAL PRIMARY KEY,
    type         VARCHAR(30)  NOT NULL,
    subject      VARCHAR(200) NOT NULL,
    recipients   INT          NOT NULL DEFAULT 0,
    status       VARCHAR(10)  NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
    detail       TEXT,
    dedupe_key   VARCHAR(100),
    created_date TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_admin_notifications_created ON admin_notifications (created_date DESC);
CREATE INDEX idx_admin_notifications_dedupe ON admin_notifications (dedupe_key, created_date DESC);

-- ============================================================
-- Announcements, broadcast emails
-- ============================================================

-- Banners shown to every user of the app (maintenance windows, news). Shown while enabled and between
-- starts_at and ends_at. (Maintenance mode itself is a plain row in app_settings.)
CREATE TABLE announcements
(
    id           SERIAL PRIMARY KEY,
    message      VARCHAR(500) NOT NULL,
    level        VARCHAR(10)  NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'critical')),
    starts_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at      TIMESTAMPTZ,
    enabled      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by   INT REFERENCES admin_users (id) ON DELETE SET NULL,
    created_date TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Emails an admin sent to the users, and how the sending went. The message text is kept so the history
-- shows exactly what people received.
CREATE TABLE broadcasts
(
    id           SERIAL PRIMARY KEY,
    subject      VARCHAR(200) NOT NULL,
    body         TEXT         NOT NULL,
    audience     VARCHAR(30)  NOT NULL,
    recipients   INT          NOT NULL,
    sent         INT          NOT NULL DEFAULT 0,
    failed       INT          NOT NULL DEFAULT 0,
    status       VARCHAR(12)  NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'done', 'cancelled', 'interrupted')),
    created_by   INT REFERENCES admin_users (id) ON DELETE SET NULL,
    created_date TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at  TIMESTAMPTZ
);

-- ============================================================
-- Compliance (ISO/IEC 27001, GDPR, ...): evidence kept next to the live checks
-- ============================================================

-- What a person recorded about one control of the compliance catalogue (the catalogue itself lives in code):
-- who owns it, its status when it can't be measured by the portal, the evidence and the next review.
CREATE TABLE compliance_controls
(
    control_id     VARCHAR(40) PRIMARY KEY,
    status         VARCHAR(16) CHECK (status IN ('implemented', 'partial', 'planned', 'not_applicable')),
    owner          VARCHAR(100),
    justification  TEXT,
    evidence_url   VARCHAR(500),
    reviewed_at    TIMESTAMPTZ,
    reviewed_by    INT REFERENCES admin_users (id) ON DELETE SET NULL,
    next_review_at DATE
);

-- Registers an ISMS needs: policies and procedures, suppliers, risks and assets, one row each.
CREATE TABLE compliance_register
(
    id             SERIAL PRIMARY KEY,
    kind           VARCHAR(10)  NOT NULL CHECK (kind IN ('policy', 'supplier', 'risk', 'asset')),
    title          VARCHAR(200) NOT NULL,
    owner          VARCHAR(100),
    status         VARCHAR(12)  NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
    -- Risk level for a risk, criticality for a supplier or asset.
    rating         VARCHAR(8) CHECK (rating IN ('low', 'medium', 'high')),
    version        VARCHAR(20),
    details        TEXT,
    reference_url  VARCHAR(500),
    approved_at    DATE,
    next_review_at DATE,
    created_by     INT REFERENCES admin_users (id) ON DELETE SET NULL,
    created_date   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_date   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_compliance_register_kind ON compliance_register (kind);

-- Security incidents (ISO/IEC 27001 A.5.24-A.5.28; GDPR art. 33 asks to notify a personal-data breach within 72 hours).
CREATE TABLE security_incidents
(
    id               SERIAL PRIMARY KEY,
    title            VARCHAR(200) NOT NULL,
    severity         VARCHAR(8)   NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status           VARCHAR(12)  NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'contained', 'resolved', 'closed')),
    detected_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at      TIMESTAMPTZ,
    description      TEXT,
    actions          TEXT,
    lessons          TEXT,
    personal_data    BOOLEAN      NOT NULL DEFAULT FALSE,
    authority_notified_at TIMESTAMPTZ,
    users_notified_at     TIMESTAMPTZ,
    created_by       INT REFERENCES admin_users (id) ON DELETE SET NULL,
    created_date     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- Support notes, data requests and webhooks of the admin portal
-- ============================================================

-- Private notes and tags admins keep on accounts ("VIP", "abuse warning", ...). Never shown to the user.
CREATE TABLE account_notes
(
    id           SERIAL PRIMARY KEY,
    user_id      INT         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    body         TEXT        NOT NULL,
    created_by   INT REFERENCES admin_users (id) ON DELETE SET NULL,
    created_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_account_notes_user ON account_notes (user_id);

CREATE TABLE account_tags
(
    user_id      INT         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    tag          VARCHAR(30) NOT NULL,
    created_by   INT REFERENCES admin_users (id) ON DELETE SET NULL,
    created_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, tag)
);
CREATE INDEX idx_account_tags_tag ON account_tags (tag);

-- GDPR requests from the people the app holds data about (art. 15 access, art. 17 erasure). The answer is due
-- within one month (art. 12(3)), extendable once by up to two more months for complex requests. The request
-- stays on record after the account is erased: that record is the proof it was answered.
CREATE TABLE data_requests
(
    id               SERIAL PRIMARY KEY,
    kind             VARCHAR(10)  NOT NULL CHECK (kind IN ('access', 'erasure')),
    user_id          INT REFERENCES users (id) ON DELETE SET NULL,
    subject_name     VARCHAR(100),
    subject_email    VARCHAR(100) NOT NULL,
    received_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_at           TIMESTAMPTZ  NOT NULL,
    extended_at      TIMESTAMPTZ,
    extension_reason TEXT,
    status           VARCHAR(12)  NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'completed', 'rejected')),
    completed_at     TIMESTAMPTZ,
    resolution       TEXT,
    notes            TEXT,
    created_by       INT REFERENCES admin_users (id) ON DELETE SET NULL,
    handled_by       INT REFERENCES admin_users (id) ON DELETE SET NULL,
    created_date     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_data_requests_status ON data_requests (status, due_at);

-- Where the portal sends events (Slack, Discord, Telegram or any URL). `target` holds the secret part
-- (webhook URL, bot token, signing secret) encrypted like the other secrets of the portal.
CREATE TABLE webhooks
(
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(60)  NOT NULL,
    kind         VARCHAR(10)  NOT NULL CHECK (kind IN ('slack', 'discord', 'telegram', 'generic')),
    target       TEXT         NOT NULL,
    events       TEXT[]       NOT NULL DEFAULT '{}',
    enabled      BOOLEAN      NOT NULL DEFAULT TRUE,
    last_status  VARCHAR(10),
    last_error   TEXT,
    last_at      TIMESTAMPTZ,
    created_by   INT REFERENCES admin_users (id) ON DELETE SET NULL,
    created_date TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE webhook_deliveries
(
    id           BIGSERIAL PRIMARY KEY,
    webhook_id   INT          NOT NULL REFERENCES webhooks (id) ON DELETE CASCADE,
    event        VARCHAR(40)  NOT NULL,
    status       VARCHAR(10)  NOT NULL CHECK (status IN ('sent', 'failed')),
    http_status  INT,
    error        TEXT,
    created_date TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_webhook_deliveries_hook ON webhook_deliveries (webhook_id, created_date DESC);

-- ============================================================
-- Background jobs of the admin portal
-- ============================================================

-- One row per run of a background job (hourly clean-ups, reminders, deletions, ...), scheduled or started by an admin.
CREATE TABLE job_runs
(
    id          BIGSERIAL PRIMARY KEY,
    job_id      VARCHAR(40)  NOT NULL,
    trigger     VARCHAR(10)  NOT NULL CHECK (trigger IN ('schedule', 'manual')),
    status      VARCHAR(10)  NOT NULL CHECK (status IN ('ok', 'failed')),
    message     TEXT,
    started_at  TIMESTAMPTZ  NOT NULL,
    finished_at TIMESTAMPTZ  NOT NULL,
    run_by      INT REFERENCES admin_users (id) ON DELETE SET NULL
);
CREATE INDEX idx_job_runs_job ON job_runs (job_id, started_at DESC);
