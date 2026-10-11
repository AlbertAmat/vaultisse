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

-- ============================================================
-- OPDS feed (issue #18)
-- ============================================================

-- SHA-256 hex of the user's OPDS feed token; NULL = no feed. The raw token is
-- shown once on creation and never stored.
ALTER TABLE users
    ADD COLUMN opds_token_hash CHAR(64) UNIQUE;

-- UI labels for Settings > OPDS feed
INSERT INTO app_labels (language, code, text)
VALUES ('en', 'USERCONF_OPDS', 'OPDS feed'),
       ('en', 'USERCONF_OPDS_DESC', 'Browse and download your digital books from reader apps such as KOReader. Anyone with the link can read your library, so keep it private. It only lists books from your active vault, and switching vault changes what the feed shows.'),
       ('en', 'USERCONF_OPDS_ENABLE', 'Create feed link'),
       ('en', 'USERCONF_OPDS_REGENERATE', 'New link'),
       ('en', 'USERCONF_OPDS_REGENERATE_DESC', 'The current link will stop working. Apps using it will need the new one.'),
       ('en', 'USERCONF_OPDS_DISABLE', 'Disable'),
       ('en', 'USERCONF_OPDS_ACTIVE', 'The feed is active. For security the link is only shown when it is created; create a new one if you lost it.'),
       ('en', 'USERCONF_OPDS_COPY', 'Copy'),
       ('en', 'SNACKBAR_OPDS_COPIED', 'Link copied'),
       ('en', 'SNACKBAR_OPDS_DISABLED', 'OPDS feed disabled'),
       ('ca', 'USERCONF_OPDS', 'Feed OPDS'),
       ('ca', 'USERCONF_OPDS_DESC', 'Explora i descarrega els teus llibres digitals des d''aplicacions de lectura com KOReader. Qui tingui l''enllaç pot llegir la teva biblioteca, així que mantén-lo privat. Només mostra els llibres de la teva biblioteca activa, i canviar de biblioteca canvia el que mostra el feed.'),
       ('ca', 'USERCONF_OPDS_ENABLE', 'Crea l''enllaç del feed'),
       ('ca', 'USERCONF_OPDS_REGENERATE', 'Nou enllaç'),
       ('ca', 'USERCONF_OPDS_REGENERATE_DESC', 'L''enllaç actual deixarà de funcionar. Les aplicacions que l''usen necessitaran el nou.'),
       ('ca', 'USERCONF_OPDS_DISABLE', 'Desactiva'),
       ('ca', 'USERCONF_OPDS_ACTIVE', 'El feed està actiu. Per seguretat, l''enllaç només es mostra quan es crea; crea''n un de nou si l''has perdut.'),
       ('ca', 'USERCONF_OPDS_COPY', 'Copia'),
       ('ca', 'SNACKBAR_OPDS_COPIED', 'Enllaç copiat'),
       ('ca', 'SNACKBAR_OPDS_DISABLED', 'Feed OPDS desactivat'),
       ('es', 'USERCONF_OPDS', 'Feed OPDS'),
       ('es', 'USERCONF_OPDS_DESC', 'Explora y descarga tus libros digitales desde aplicaciones de lectura como KOReader. Quien tenga el enlace puede leer tu biblioteca, así que mantenlo privado. Solo muestra los libros de tu biblioteca activa, y cambiar de biblioteca cambia lo que muestra el feed.'),
       ('es', 'USERCONF_OPDS_ENABLE', 'Crear enlace del feed'),
       ('es', 'USERCONF_OPDS_REGENERATE', 'Nuevo enlace'),
       ('es', 'USERCONF_OPDS_REGENERATE_DESC', 'El enlace actual dejará de funcionar. Las aplicaciones que lo usen necesitarán el nuevo.'),
       ('es', 'USERCONF_OPDS_DISABLE', 'Desactivar'),
       ('es', 'USERCONF_OPDS_ACTIVE', 'El feed está activo. Por seguridad, el enlace solo se muestra al crearlo; crea uno nuevo si lo has perdido.'),
       ('es', 'USERCONF_OPDS_COPY', 'Copiar'),
       ('es', 'SNACKBAR_OPDS_COPIED', 'Enlace copiado'),
       ('es', 'SNACKBAR_OPDS_DISABLED', 'Feed OPDS desactivado'),
       ('it', 'USERCONF_OPDS', 'Feed OPDS'),
       ('it', 'USERCONF_OPDS_DESC', 'Sfoglia e scarica i tuoi libri digitali da app di lettura come KOReader. Chiunque abbia il link può leggere la tua libreria, quindi tienilo privato. Mostra solo i libri della tua biblioteca attiva, e cambiare biblioteca cambia ciò che mostra il feed.'),
       ('it', 'USERCONF_OPDS_ENABLE', 'Crea link del feed'),
       ('it', 'USERCONF_OPDS_REGENERATE', 'Nuovo link'),
       ('it', 'USERCONF_OPDS_REGENERATE_DESC', 'Il link attuale smetterà di funzionare. Le app che lo usano avranno bisogno del nuovo.'),
       ('it', 'USERCONF_OPDS_DISABLE', 'Disattiva'),
       ('it', 'USERCONF_OPDS_ACTIVE', 'Il feed è attivo. Per sicurezza il link viene mostrato solo alla creazione; creane uno nuovo se l''hai perso.'),
       ('it', 'USERCONF_OPDS_COPY', 'Copia'),
       ('it', 'SNACKBAR_OPDS_COPIED', 'Link copiato'),
       ('it', 'SNACKBAR_OPDS_DISABLED', 'Feed OPDS disattivato'),
       ('fr', 'USERCONF_OPDS', 'Flux OPDS'),
       ('fr', 'USERCONF_OPDS_DESC', 'Parcours et télécharge tes livres numériques depuis des applications de lecture comme KOReader. Toute personne ayant le lien peut lire ta bibliothèque, garde-le privé. Il n''affiche que les livres de ta bibliothèque active, et changer de bibliothèque change ce que montre le flux.'),
       ('fr', 'USERCONF_OPDS_ENABLE', 'Créer le lien du flux'),
       ('fr', 'USERCONF_OPDS_REGENERATE', 'Nouveau lien'),
       ('fr', 'USERCONF_OPDS_REGENERATE_DESC', 'Le lien actuel cessera de fonctionner. Les applications qui l''utilisent auront besoin du nouveau.'),
       ('fr', 'USERCONF_OPDS_DISABLE', 'Désactiver'),
       ('fr', 'USERCONF_OPDS_ACTIVE', 'Le flux est actif. Par sécurité, le lien n''est affiché qu''à sa création ; crée-en un nouveau si tu l''as perdu.'),
       ('fr', 'USERCONF_OPDS_COPY', 'Copier'),
       ('fr', 'SNACKBAR_OPDS_COPIED', 'Lien copié'),
       ('fr', 'SNACKBAR_OPDS_DISABLED', 'Flux OPDS désactivé'),
       ('de', 'USERCONF_OPDS', 'OPDS-Feed'),
       ('de', 'USERCONF_OPDS_DESC', 'Durchsuche und lade deine digitalen Bücher aus Reader-Apps wie KOReader. Jeder mit dem Link kann deine Bibliothek lesen, halte ihn also privat. Er zeigt nur Bücher deiner aktiven Bibliothek, und ein Bibliothekswechsel ändert, was der Feed zeigt.'),
       ('de', 'USERCONF_OPDS_ENABLE', 'Feed-Link erstellen'),
       ('de', 'USERCONF_OPDS_REGENERATE', 'Neuer Link'),
       ('de', 'USERCONF_OPDS_REGENERATE_DESC', 'Der aktuelle Link funktioniert nicht mehr. Apps, die ihn nutzen, brauchen den neuen.'),
       ('de', 'USERCONF_OPDS_DISABLE', 'Deaktivieren'),
       ('de', 'USERCONF_OPDS_ACTIVE', 'Der Feed ist aktiv. Aus Sicherheitsgründen wird der Link nur bei der Erstellung angezeigt; erstelle einen neuen, falls du ihn verloren hast.'),
       ('de', 'USERCONF_OPDS_COPY', 'Kopieren'),
       ('de', 'SNACKBAR_OPDS_COPIED', 'Link kopiert'),
       ('de', 'SNACKBAR_OPDS_DISABLED', 'OPDS-Feed deaktiviert');
