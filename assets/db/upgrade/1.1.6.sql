-- Upgrade to v1.1.6 - schema changes made on 2026-09-12.
-- Brings an already-installed database in line with the v1.1.6 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)

-- Labels for the new "Import" dialog on the search view (bulk CSV import
-- from a Vaultisse-template or Goodreads export, via POST /import/library -
-- see ImportRoute.ts, already server-side; this just wires up the client UI).
INSERT INTO app_labels (language, code, text)
VALUES ('en', 'IMPORT', 'Import'),
       ('en', 'IMPORT_LIBRARY_DESC', 'Bulk-add books to your library from a CSV file. Choose where the file is coming from, then upload it — each row becomes a new book, and any book you already have (matched by ISBN, or by title when there''s no ISBN) is skipped automatically.'),
       ('en', 'IMPORT_SELECT_ORIGIN', 'Import from'),
       ('en', 'IMPORT_ORIGIN_VAULTISSE', 'Vaultisse'),
       ('en', 'IMPORT_ORIGIN_VAULTISSE_DESC', 'A CSV following Vaultisse''s own template'),
       ('en', 'IMPORT_ORIGIN_GOODREADS', 'Goodreads'),
       ('en', 'IMPORT_ORIGIN_GOODREADS_DESC', 'Your library exported from Goodreads'),
       ('en', 'IMPORT_DROPZONE_TITLE', 'Click or drag and drop a CSV file'),
       ('en', 'IMPORT_MAX_SIZE', 'Maximum file size: {maxSizeMb} MB'),
       ('en', 'IMPORT_FILE_TOO_LARGE', 'This file is too large — the maximum allowed size is {maxSizeMb} MB'),
       ('en', 'IMPORT_ONLY_CSV_ALLOWED', 'Only CSV files are allowed'),
       ('en', 'IMPORT_DOWNLOAD_TEMPLATE', 'Download template'),
       ('en', 'SNACKBAR_IMPORT_SUCCESS', 'Total imported books: {count}'),

       ('ca', 'IMPORT', 'Importa'),
       ('ca', 'IMPORT_LIBRARY_DESC', 'Afegeix llibres a la teva biblioteca en bloc des d''un fitxer CSV. Tria d''on prové el fitxer i puja''l: cada fila es converteix en un llibre nou, i qualsevol llibre que ja tinguis (per ISBN, o pel títol si no n''hi ha) s''omet automàticament.'),
       ('ca', 'IMPORT_SELECT_ORIGIN', 'Importa des de'),
       ('ca', 'IMPORT_ORIGIN_VAULTISSE', 'Vaultisse'),
       ('ca', 'IMPORT_ORIGIN_VAULTISSE_DESC', 'Un CSV amb la plantilla pròpia de Vaultisse'),
       ('ca', 'IMPORT_ORIGIN_GOODREADS', 'Goodreads'),
       ('ca', 'IMPORT_ORIGIN_GOODREADS_DESC', 'La teva biblioteca exportada des de Goodreads'),
       ('ca', 'IMPORT_DROPZONE_TITLE', 'Fes clic o arrossega i deixa anar un fitxer CSV'),
       ('ca', 'IMPORT_MAX_SIZE', 'Mida màxima del fitxer: {maxSizeMb} MB'),
       ('ca', 'IMPORT_FILE_TOO_LARGE', 'Aquest fitxer és massa gran — la mida màxima permesa és {maxSizeMb} MB'),
       ('ca', 'IMPORT_ONLY_CSV_ALLOWED', 'Només es permeten fitxers CSV'),
       ('ca', 'IMPORT_DOWNLOAD_TEMPLATE', 'Descarrega la plantilla'),
       ('ca', 'SNACKBAR_IMPORT_SUCCESS', 'Total de llibres importats: {count}'),

       ('es', 'IMPORT', 'Importar'),
       ('es', 'IMPORT_LIBRARY_DESC', 'Agrega libros a tu biblioteca en bloque desde un archivo CSV. Elige de dónde proviene el archivo y súbelo: cada fila se convierte en un libro nuevo, y cualquier libro que ya tengas (por ISBN, o por título si no hay ISBN) se omite automáticamente.'),
       ('es', 'IMPORT_SELECT_ORIGIN', 'Importar desde'),
       ('es', 'IMPORT_ORIGIN_VAULTISSE', 'Vaultisse'),
       ('es', 'IMPORT_ORIGIN_VAULTISSE_DESC', 'Un CSV con la plantilla propia de Vaultisse'),
       ('es', 'IMPORT_ORIGIN_GOODREADS', 'Goodreads'),
       ('es', 'IMPORT_ORIGIN_GOODREADS_DESC', 'Tu biblioteca exportada desde Goodreads'),
       ('es', 'IMPORT_DROPZONE_TITLE', 'Haz clic o arrastra y suelta un archivo CSV'),
       ('es', 'IMPORT_MAX_SIZE', 'Tamaño máximo del archivo: {maxSizeMb} MB'),
       ('es', 'IMPORT_FILE_TOO_LARGE', 'Este archivo es demasiado grande — el tamaño máximo permitido es {maxSizeMb} MB'),
       ('es', 'IMPORT_ONLY_CSV_ALLOWED', 'Solo se permiten archivos CSV'),
       ('es', 'IMPORT_DOWNLOAD_TEMPLATE', 'Descargar plantilla'),
       ('es', 'SNACKBAR_IMPORT_SUCCESS', 'Total de libros importados: {count}'),

       ('it', 'IMPORT', 'Importa'),
       ('it', 'IMPORT_LIBRARY_DESC', 'Aggiungi libri alla tua biblioteca in blocco da un file CSV. Scegli da dove proviene il file e caricalo: ogni riga diventa un nuovo libro, e qualsiasi libro che hai già (per ISBN, o per titolo se manca l''ISBN) viene saltato automaticamente.'),
       ('it', 'IMPORT_SELECT_ORIGIN', 'Importa da'),
       ('it', 'IMPORT_ORIGIN_VAULTISSE', 'Vaultisse'),
       ('it', 'IMPORT_ORIGIN_VAULTISSE_DESC', 'Un CSV con il modello proprio di Vaultisse'),
       ('it', 'IMPORT_ORIGIN_GOODREADS', 'Goodreads'),
       ('it', 'IMPORT_ORIGIN_GOODREADS_DESC', 'La tua biblioteca esportata da Goodreads'),
       ('it', 'IMPORT_DROPZONE_TITLE', 'Fai clic o trascina e rilascia un file CSV'),
       ('it', 'IMPORT_MAX_SIZE', 'Dimensione massima del file: {maxSizeMb} MB'),
       ('it', 'IMPORT_FILE_TOO_LARGE', 'Questo file è troppo grande — la dimensione massima consentita è {maxSizeMb} MB'),
       ('it', 'IMPORT_ONLY_CSV_ALLOWED', 'Sono ammessi solo file CSV'),
       ('it', 'IMPORT_DOWNLOAD_TEMPLATE', 'Scarica il modello'),
       ('it', 'SNACKBAR_IMPORT_SUCCESS', 'Totale libri importati: {count}');
