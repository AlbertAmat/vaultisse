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
