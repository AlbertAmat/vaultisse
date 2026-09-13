-- Upgrade to v1.1.7 - schema changes made on 2026-09-13.
-- Brings an already-installed database in line with the v1.1.7 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)

-- Default location (issue #24): lets a user mark one location as the
-- default, pre-filled when adding a new book stock.
ALTER TABLE locations
    ADD COLUMN "default" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX locations_one_default_per_user ON locations (user_id) WHERE "default";

INSERT INTO app_labels (language, code, text)
VALUES ('en', 'SNACKBAR_LOCATION_SET_DEFAULT', 'Location set as default successfully'),
       ('en', 'DEFAULT', 'Default'),
       ('en', 'SET_AS_DEFAULT_LOCATION', 'Set as default location'),

       ('ca', 'SNACKBAR_LOCATION_SET_DEFAULT', 'L’ubicació s’ha establert com a predeterminada'),
       ('ca', 'DEFAULT', 'Predeterminada'),
       ('ca', 'SET_AS_DEFAULT_LOCATION', 'Estableix com a ubicació predeterminada'),

       ('es', 'SNACKBAR_LOCATION_SET_DEFAULT', 'La ubicación se ha establecido como predeterminada'),
       ('es', 'DEFAULT', 'Predeterminada'),
       ('es', 'SET_AS_DEFAULT_LOCATION', 'Establecer como ubicación predeterminada'),

       ('it', 'SNACKBAR_LOCATION_SET_DEFAULT', 'La posizione è stata impostata come predefinita'),
       ('it', 'DEFAULT', 'Predefinita'),
       ('it', 'SET_AS_DEFAULT_LOCATION', 'Imposta come posizione predefinita');

-- "Find cover" button (issue #23): looks up a cover online for a book
-- already in the library, using its stored ISBN.
INSERT INTO app_labels (language, code, text)
VALUES ('en', 'FIND_COVER', 'Find cover'),
       ('en', 'SNACKBAR_BOOK_COVER_NOT_FOUND', 'No cover found for this book'),

       ('ca', 'FIND_COVER', 'Cerca coberta'),
       ('ca', 'SNACKBAR_BOOK_COVER_NOT_FOUND', 'No s’ha trobat cap coberta per a aquest llibre'),

       ('es', 'FIND_COVER', 'Buscar portada'),
       ('es', 'SNACKBAR_BOOK_COVER_NOT_FOUND', 'No se ha encontrado ninguna portada para este libro'),

       ('it', 'FIND_COVER', 'Cerca copertina'),
       ('it', 'SNACKBAR_BOOK_COVER_NOT_FOUND', 'Nessuna copertina trovata per questo libro');

-- Barcode scanner camera errors (issue #21): the scanner used to fail
-- completely silently (e.g. no HTTPS, camera permission denied), leaving
-- users staring at a blank dialog with no way to tell what went wrong.
INSERT INTO app_labels (language, code, text)
VALUES ('en', 'BARCODE_SCANNER_INSECURE_CONNECTION', 'Camera access requires a secure connection (HTTPS). Ask your administrator to enable HTTPS for this site.'),
       ('en', 'BARCODE_SCANNER_CAMERA_ERROR', 'Couldn''t access the camera. Check that camera permission is allowed for this site and try again.'),

       ('ca', 'BARCODE_SCANNER_INSECURE_CONNECTION', 'L’accés a la càmera requereix una connexió segura (HTTPS). Demana a l’administrador que habiliti HTTPS per a aquest lloc.'),
       ('ca', 'BARCODE_SCANNER_CAMERA_ERROR', 'No s’ha pogut accedir a la càmera. Comprova que el permís de càmera estigui habilitat per a aquest lloc i torna-ho a provar.'),

       ('es', 'BARCODE_SCANNER_INSECURE_CONNECTION', 'El acceso a la cámara requiere una conexión segura (HTTPS). Pide al administrador que habilite HTTPS para este sitio.'),
       ('es', 'BARCODE_SCANNER_CAMERA_ERROR', 'No se ha podido acceder a la cámara. Comprueba que el permiso de cámara esté habilitado para este sitio e inténtalo de nuevo.'),

       ('it', 'BARCODE_SCANNER_INSECURE_CONNECTION', 'L''accesso alla fotocamera richiede una connessione sicura (HTTPS). Chiedi all''amministratore di abilitare HTTPS per questo sito.'),
       ('it', 'BARCODE_SCANNER_CAMERA_ERROR', 'Impossibile accedere alla fotocamera. Verifica che il permesso della fotocamera sia abilitato per questo sito e riprova.');
