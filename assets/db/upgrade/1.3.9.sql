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
