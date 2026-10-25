-- Upgrade to v1.3.7 - schema changes made on 2026-10-25.
-- Brings an already-installed database in line with the v1.3.7 databaseSchema.sql.
-- (New installs should use databaseSchema.sql directly and skip this file.)

-- ============================================================
-- Per-vault SSO group mapping, auto-join and Restricted role (issue #29)
-- ============================================================

-- Which SSO groups give access to a vault, and with which role.
CREATE TABLE vault_sso_groups
(
    vault_id   INT          NOT NULL REFERENCES vault (id) ON DELETE CASCADE,
    group_name VARCHAR(200) NOT NULL,
    role       SMALLINT     NOT NULL REFERENCES vault_roles (code),
    PRIMARY KEY (vault_id, group_name)
);

-- vault_users.role_source = 1 now means "added by the vault's SSO group
-- mapping" (was: role follows SSO groups). Rows set in 1.3.6 keep working as
-- plain manual members, so reset them.
UPDATE vault_users SET role_source = 0 WHERE role_source = 1;

-- Members who lost their SSO groups but still have books on loan.
INSERT INTO vault_roles (code, name, rank, can_borrow, can_edit_catalog, can_manage_members, can_manage_settings)
VALUES (4, 'restricted', -1, FALSE, FALSE, FALSE, FALSE);

INSERT INTO app_labels (language, code, text)
VALUES
       ('en', 'VAULT_SSO_GROUPS', 'Add by SSO group'),
       ('en', 'VAULT_SSO_GROUPS_DESC', 'Members of the SSO groups listed here join this vault automatically at login with the mapped role (the highest one if they match several), and are removed when they leave those groups. A member who still has books on loan becomes Restricted instead. Members added by hand are never removed. With no groups listed, access stays manual.'),
       ('en', 'VAULT_SSO_GROUP_NAME', 'SSO group'),
       ('en', 'VAULT_SSO_GROUP_ADD', 'Add group'),
       ('en', 'VAULT_MANAGED_BY_SSO', 'Managed by SSO'),
       ('ca', 'VAULT_SSO_GROUPS', 'Afegeix per grup SSO'),
       ('ca', 'VAULT_SSO_GROUPS_DESC', 'Els membres dels grups SSO d''aquesta llista s''uneixen automàticament a la biblioteca en iniciar sessió amb el rol assignat (el més alt si coincideixen amb diversos) i s''eliminen quan deixen aquests grups. Un membre que encara té llibres en préstec passa a ser Restringit. Els membres afegits manualment mai s''eliminen. Sense grups, l''accés continua sent manual.'),
       ('ca', 'VAULT_SSO_GROUP_NAME', 'Grup SSO'),
       ('ca', 'VAULT_SSO_GROUP_ADD', 'Afegeix grup'),
       ('ca', 'VAULT_MANAGED_BY_SSO', 'Gestionat per SSO'),
       ('es', 'VAULT_SSO_GROUPS', 'Añadir por grupo SSO'),
       ('es', 'VAULT_SSO_GROUPS_DESC', 'Los miembros de los grupos SSO de esta lista se unen automáticamente a la biblioteca al iniciar sesión con el rol asignado (el más alto si coinciden con varios) y se eliminan al dejar esos grupos. Un miembro que aún tiene libros prestados pasa a ser Restringido. Los miembros añadidos a mano nunca se eliminan. Sin grupos, el acceso sigue siendo manual.'),
       ('es', 'VAULT_SSO_GROUP_NAME', 'Grupo SSO'),
       ('es', 'VAULT_SSO_GROUP_ADD', 'Añadir grupo'),
       ('es', 'VAULT_MANAGED_BY_SSO', 'Gestionado por SSO'),
       ('it', 'VAULT_SSO_GROUPS', 'Aggiungi per gruppo SSO'),
       ('it', 'VAULT_SSO_GROUPS_DESC', 'I membri dei gruppi SSO elencati entrano automaticamente in questa biblioteca all''accesso con il ruolo associato (il più alto se corrispondono a più gruppi) e vengono rimossi quando lasciano quei gruppi. Un membro con libri ancora in prestito diventa Limitato. I membri aggiunti a mano non vengono mai rimossi. Senza gruppi, l''accesso resta manuale.'),
       ('it', 'VAULT_SSO_GROUP_NAME', 'Gruppo SSO'),
       ('it', 'VAULT_SSO_GROUP_ADD', 'Aggiungi gruppo'),
       ('it', 'VAULT_MANAGED_BY_SSO', 'Gestito da SSO'),
       ('fr', 'VAULT_SSO_GROUPS', 'Ajout par groupe SSO'),
       ('fr', 'VAULT_SSO_GROUPS_DESC', 'Les membres des groupes SSO listés rejoignent automatiquement cette bibliothèque à la connexion avec le rôle associé (le plus élevé s''ils correspondent à plusieurs) et sont retirés quand ils quittent ces groupes. Un membre qui a encore des livres en prêt devient Restreint. Les membres ajoutés manuellement ne sont jamais retirés. Sans groupe, l''accès reste manuel.'),
       ('fr', 'VAULT_SSO_GROUP_NAME', 'Groupe SSO'),
       ('fr', 'VAULT_SSO_GROUP_ADD', 'Ajouter un groupe'),
       ('fr', 'VAULT_MANAGED_BY_SSO', 'Géré par SSO'),
       ('de', 'VAULT_SSO_GROUPS', 'Hinzufügen per SSO-Gruppe'),
       ('de', 'VAULT_SSO_GROUPS_DESC', 'Mitglieder der hier aufgeführten SSO-Gruppen treten dieser Bibliothek bei der Anmeldung mit der zugeordneten Rolle bei (der höchsten, wenn mehrere passen) und werden entfernt, wenn sie die Gruppen verlassen. Wer noch Bücher ausgeliehen hat, wird stattdessen Eingeschränkt. Manuell hinzugefügte Mitglieder werden nie entfernt. Ohne Gruppen bleibt der Zugriff manuell.'),
       ('de', 'VAULT_SSO_GROUP_NAME', 'SSO-Gruppe'),
       ('de', 'VAULT_SSO_GROUP_ADD', 'Gruppe hinzufügen'),
       ('de', 'VAULT_MANAGED_BY_SSO', 'Von SSO verwaltet');
