/**
 * =============================================================================
 * Schema migration runner
 * =============================================================================
 * Applies every not-yet-applied file under `assets/db/upgrade/` (see that
 * directory's own README.md for the on-disk naming convention) to the
 * database, in version order, tracking what's applied in the
 * `schema_migrations` table. Run automatically on every server start (see
 * AppService.init()), so upgrading the app now upgrades the schema with it -
 * no manual `psql -f` step (see GitHub issue #26).
 *
 * Files that predate this runner were already applied by hand, one file at a
 * time, to unknown-version installs - there was never anything recording
 * which ones. `LEGACY_CHECKS` below covers exactly those files: a cheap,
 * read-only "does this file's change already exist?" probe used only the
 * first time a given install sees a given legacy file, so the very first
 * automated run correctly fast-forwards an install stuck at any old version
 * (1.0.0, 1.1.4, whatever) without re-running changes it already has.
 *
 * A fresh install is a different problem: `assets/db/databaseSchema.sql`
 * already contains every migration's change, but `schema_migrations` starts
 * empty, so this runner would otherwise try (and fail) to re-apply every
 * file from `1.0.0` on. That file solves it directly - it seeds
 * `schema_migrations` with every upgrade filename that exists as of that
 * schema snapshot, right after creating the table - so a migration shipped
 * after this runner exists (and folded into databaseSchema.sql, as it
 * should be) needs no entry here: `schema_migrations` already has its row on
 * a fresh install, and a real upgrading install genuinely missing it just
 * applies it normally, like any other not-yet-seen file.
 */
import * as fs from "fs";
import * as path from "path";
import {Pool} from "pg";
import {Logger} from "../utils/Logger";

/**
 * Default location of the upgrade files relative to this compiled module.
 * This file lives at `server/src/migrate/index.ts` -> `server/dist/migrate/index.js`,
 * so three levels up reaches the repo root in both dev (ts-node, from `server/src/migrate/`)
 * and the runtime image (`/app/dist/server/dist/migrate/`, with `assets/db/`
 * copied in as a sibling of `server/` and `client/` - see the Dockerfile).
 */
const DEFAULT_UPGRADE_DIR = path.join(__dirname, "..", "..", "..", "assets", "db", "upgrade");

/**
 * One "does this legacy file's change already exist?" probe per upgrade file
 * that shipped before this runner existed. Keyed by the file's path relative
 * to `assets/db/upgrade/` (e.g. `"1.1.7.sql"`, `"1.0.0/1.sql"`), exactly as
 * `discoverMigrationFiles()` returns it.
 */
const LEGACY_CHECKS: Record<string, (pool: Pool) => Promise<boolean>> = {
    "1.0.0/1.sql": (pool) => columnExists(pool, "customers", "group_id"),
    "1.0.0/2.sql": (pool) => tableExists(pool, "user_backup_codes"),
    "1.0.0/3.sql": (pool) => labelExists(pool, "en", "LOANS"),
    "1.0.2.sql": (pool) => labelTextEquals(
        pool, "en", "USERCONF_DELETE_USER_DESC",
        "Are you sure you want to delete your Vaultisse account? This will permanently remove your account and all associated content."
    ),
    "1.1.0/1.sql": (pool) => tableExists(pool, "activity_log"),
    "1.1.0/2.sql": (pool) => constraintExists(pool, "book_files_book_id_file_type_key"),
    "1.1.0/3.sql": (pool) => tableExists(pool, "user_terms_of_service_acknowledgements"),
    "1.1.2.sql": (pool) => labelExists(pool, "en", "UNCATEGORIZED"),
    "1.1.5.sql": (pool) => columnExists(pool, "books", "reading_status"),
    "1.1.6.sql": (pool) => labelExists(pool, "en", "IMPORT"),
    "1.1.7.sql": (pool) => columnExists(pool, "locations", "default"),
};

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
    const {rows} = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, column]
    );
    return rows.length > 0;
}

async function tableExists(pool: Pool, table: string): Promise<boolean> {
    const {rows} = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
        [table]
    );
    return rows.length > 0;
}

async function constraintExists(pool: Pool, constraintName: string): Promise<boolean> {
    const {rows} = await pool.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1`,
        [constraintName]
    );
    return rows.length > 0;
}

async function labelExists(pool: Pool, language: string, code: string): Promise<boolean> {
    const {rows} = await pool.query(
        `SELECT 1 FROM app_labels WHERE language = $1 AND code = $2`,
        [language, code]
    );
    return rows.length > 0;
}

async function labelTextEquals(pool: Pool, language: string, code: string, text: string): Promise<boolean> {
    const {rows} = await pool.query(
        `SELECT 1 FROM app_labels WHERE language = $1 AND code = $2 AND text = $3`,
        [language, code, text]
    );
    return rows.length > 0;
}

/** One version's worth of upgrade files, in the order they must be applied. */
interface VersionEntry {
    version: string;
    files: string[];
}

/** Compares two `X.Y.Z`-style version strings; negative/zero/positive like `Array.sort`'s comparator. */
function compareVersions(a: string, b: string): number {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);
    const length = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < length; i++) {
        const diff = (partsA[i] || 0) - (partsB[i] || 0);
        if (diff !== 0) {
            return diff;
        }
    }

    return 0;
}

/**
 * Walks `upgradeDir` (see `assets/db/upgrade/README.md`) and returns every
 * `.sql` file's path relative to it, in the order they must be applied:
 * version order, then (within a version's own folder) numeric order.
 */
function discoverMigrationFiles(upgradeDir: string): string[] {
    const entries = fs.readdirSync(upgradeDir, {withFileTypes: true});
    const versionEntries: VersionEntry[] = [];

    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".sql")) {
            versionEntries.push({version: entry.name.replace(/\.sql$/, ""), files: [entry.name]});
        } else if (entry.isDirectory()) {
            const files = fs.readdirSync(path.join(upgradeDir, entry.name))
                .filter((name) => name.endsWith(".sql"))
                .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
                .map((name) => path.join(entry.name, name));
            versionEntries.push({version: entry.name, files});
        }
    }

    versionEntries.sort((a, b) => compareVersions(a.version, b.version));

    return versionEntries.flatMap((entry) => entry.files);
}

/**
 * Applies every not-yet-applied file under `upgradeDir` to the database, in
 * order, recording each in `schema_migrations`. Safe to call on every server
 * start: a database already at the latest schema does nothing.
 *
 * @param upgradeDir Defaults to `assets/db/upgrade/` at the repo root.
 */
export async function runMigrations(pool: Pool, logger: Logger, upgradeDir: string = DEFAULT_UPGRADE_DIR): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations
        (
            filename    VARCHAR(255) PRIMARY KEY,
            applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const files = discoverMigrationFiles(upgradeDir);

    for (const file of files) {
        const {rows} = await pool.query(
            `SELECT 1 FROM schema_migrations WHERE filename = $1`,
            [file]
        );
        if (rows.length > 0) {
            continue;
        }

        const legacyCheck = LEGACY_CHECKS[file];
        if (legacyCheck && await legacyCheck(pool)) {
            await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
            console.log(`[migrate] ${file}: already present, recorded`);
            logger.info(`[migrate] ${file}: already present, recorded`);
            continue;
        }

        const sql = fs.readFileSync(path.join(upgradeDir, file), "utf-8");
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
            await client.query("COMMIT");
            console.log(`[migrate] ${file}: applied`);
            logger.info(`[migrate] ${file}: applied`);
        } catch (e) {
            await client.query("ROLLBACK");
            const message = e instanceof Error ? e.message : String(e);
            logger.error(`[migrate] ${file}: failed - ${message}`);
            throw new Error(`Migration "${file}" failed: ${message}`);
        } finally {
            client.release();
        }
    }
}
