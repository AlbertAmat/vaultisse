/**
 * Facts about the installation for the admin portal's System page: the database (where it is, how big,
 * how healthy), the migrations that were run and when, the installed version, and the runtime.
 */
import os from "os";
import {Pool} from "pg";

export type DatabaseHealth = "ok" | "warning" | "down";

export interface DatabaseInfo {
    status: DatabaseHealth;
    /** Why the status isn't "ok". */
    problems: string[];
    /** From the environment: how this server was told to connect. */
    connection: {mode: "tcp" | "socket"; host: string | null; port: number | null; name: string | null; user: string | null};
    /** From the database itself: what it reports about where the connection ended up. */
    server: {address: string | null; port: number | null; version: string | null; startedAt: string | null; uptimeSeconds: number | null} | null;
    latencyMs: number | null;
    sizeBytes: number | null;
    connections: {current: number; max: number; poolTotal: number; poolIdle: number; poolWaiting: number} | null;
    largestTables: {name: string; bytes: number; rows: number}[];
}

export interface MigrationEntry {
    filename: string;
    appliedAt: string;
}

/** Connections above this share of `max_connections` are flagged. */
export const CONNECTIONS_WARNING_RATIO = 0.85;

/** Reads system facts. */
export class SystemInfoService {
    /**
     * @param pool Database pool.
     * @param dbSizeLimitMb Reads the configured size alert (ADMIN_NOTIFY_DB_SIZE_MB), or null for none.
     */
    public constructor(private readonly pool: Pool, private readonly dbSizeLimitMb: () => number | null) {
    }

    /** @returns How this server was told to reach its database (never the password). */
    public static connectionFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseInfo["connection"] {
        const complete = !!(env.DB_USER && env.DB_PASSWORD && env.DB_HOST && env.DB_PORT && env.DB_NAME);
        return {
            mode: complete ? "tcp" : "socket",
            host: env.DB_HOST || null,
            port: complete ? Number(env.DB_PORT) || null : null,
            name: env.DB_NAME || null,
            user: complete ? env.DB_USER ?? null : null,
        };
    }

    /** @returns The database's status, size and connection details. Never throws: an unreachable database is a result. */
    public async database(): Promise<DatabaseInfo> {
        const connection = SystemInfoService.connectionFromEnv();
        const base: DatabaseInfo = {status: "down", problems: [], connection, server: null, latencyMs: null, sizeBytes: null, connections: null, largestTables: []};
        const started = Date.now();
        try {
            const facts = (await this.pool.query(`
                SELECT version()                                          AS version,
                       pg_database_size(current_database())::bigint       AS size,
                       pg_postmaster_start_time()                         AS started,
                       inet_server_addr()::text                           AS address,
                       inet_server_port()                                 AS port,
                       current_setting('max_connections')::int            AS max_connections,
                       (SELECT COUNT(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections
            `)).rows[0];
            base.latencyMs = Date.now() - started;
            base.sizeBytes = Number(facts.size);
            base.server = {
                address: facts.address ? String(facts.address).replace(/\/\d+$/, "") : null,
                port: facts.port ?? null,
                version: String(facts.version).split(" on ")[0],
                startedAt: facts.started ? new Date(facts.started).toISOString() : null,
                uptimeSeconds: facts.started ? Math.floor((Date.now() - new Date(facts.started).getTime()) / 1000) : null,
            };
            base.connections = {
                current: facts.connections, max: facts.max_connections,
                poolTotal: this.pool.totalCount, poolIdle: this.pool.idleCount, poolWaiting: this.pool.waitingCount,
            };
            const tables = await this.pool.query(`
                SELECT relname AS name, pg_total_relation_size(relid)::bigint AS bytes, n_live_tup::bigint AS rows
                  FROM pg_stat_user_tables
                 ORDER BY bytes DESC LIMIT 12`);
            base.largestTables = tables.rows.map((row: {name: string; bytes: string; rows: string}) => ({name: row.name, bytes: Number(row.bytes), rows: Number(row.rows)}));

            base.status = "ok";
            if (facts.connections >= facts.max_connections * CONNECTIONS_WARNING_RATIO) {
                base.problems.push(`${facts.connections} of ${facts.max_connections} database connections are in use.`);
            }
            if (this.pool.waitingCount > 0) {
                base.problems.push(`${this.pool.waitingCount} requests are waiting for a free connection.`);
            }
            if (base.latencyMs > 500) {
                base.problems.push(`The database answers slowly (${base.latencyMs} ms).`);
            }
            const limit = this.dbSizeLimitMb();
            if (limit !== null && base.sizeBytes > limit * 1024 * 1024) {
                base.problems.push(`The database is larger than the ${limit} MB limit set for alerts.`);
            }
            if (base.problems.length > 0) {
                base.status = "warning";
            }
        } catch (error) {
            base.problems.push(`The database can't be reached: ${error instanceof Error ? error.message : String(error)}`);
        }
        return base;
    }

    /** @returns Every migration that was applied, newest first, with when. */
    public async migrations(): Promise<MigrationEntry[]> {
        const result = await this.pool.query(`SELECT filename, applied_at AS "appliedAt" FROM schema_migrations ORDER BY applied_at DESC, filename DESC`);
        return result.rows.map((row: {filename: string; appliedAt: Date}) => ({filename: row.filename, appliedAt: new Date(row.appliedAt).toISOString()}));
    }

    /**
     * @param since Start of the window.
     * @returns Migrations applied since then (e.g. during this start).
     */
    public async migrationsSince(since: Date): Promise<string[]> {
        const result = await this.pool.query("SELECT filename FROM schema_migrations WHERE applied_at >= $1 ORDER BY applied_at, filename", [since]);
        return result.rows.map((row: {filename: string}) => row.filename);
    }

    /** @returns Facts about the process and machine. */
    public runtime(): {node: string; platform: string; arch: string; hostname: string; uptimeSeconds: number; memoryMb: number; environment: string; inDocker: boolean} {
        return {
            node: process.version,
            platform: `${os.type()} ${os.release()}`,
            arch: os.arch(),
            hostname: os.hostname(),
            uptimeSeconds: Math.floor(process.uptime()),
            memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            environment: process.env.NODE_ENV || "development",
            inDocker: require("fs").existsSync("/.dockerenv"),
        };
    }
}
