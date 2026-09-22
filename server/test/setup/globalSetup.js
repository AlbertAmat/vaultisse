/**
 * Runs once before the whole test run (Jest `globalSetup`, a separate
 * process from any test file): drops and recreates the dedicated test
 * database from scratch, then loads the real schema (including its seed
 * data - languages, formats, i18n labels) from `assets/db/databaseSchema.sql`,
 * the same file a fresh production deploy runs.
 *
 * A full drop+recreate per run (rather than truncating tables) keeps this
 * immune to schema drift between runs and matches how a fresh install
 * actually gets its database - if this ever stops working, so would a new
 * deployment.
 */
const {Client} = require("pg");
const {getTestDbConfig} = require("./testDbConfig");
const {runMigrations} = require("../../src/migrate");
const pg = require("pg");
const {Logger} = require("../../src/utils/Logger");
const {AppService} = require("../../src/AppService");

module.exports = async function globalSetup() {
    const config = getTestDbConfig();

    const admin = new Client({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: "postgres",
    });
    await admin.connect();

    // In case a previous run's server process didn't shut down cleanly and
    // left connections open - DROP DATABASE fails while any exist.
    await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [config.database]
    );
    await admin.query(`DROP DATABASE IF EXISTS "${config.database}"`);
    await admin.query(`CREATE DATABASE "${config.database}"`);
    await admin.end();

    // Run the same migrations as what users use, removes the reliance on databaseSchema.sql
    // To run the migrations we need a pool and a logger
    let connectionString = AppService.getConnectionString();
    if (!connectionString) {
        throw new Error("Either use: 'DB_HOST'/'DB_NAME' for socket connection, or use 'DB_HOST'/'DB_PORT'/'DB_NAME'/'DB_USER'/'DB_PASSWORD' for TCP connection.");
    }
    const m_databasePool = new pg.Pool({
        connectionString,
        max: 20, // max connections
        idleTimeoutMillis: 30000, // idle timeout
        connectionTimeoutMillis: 2000, // connection timeout
    });
    const m_logger = new Logger(String(process.env.LOGGER_PATH));

    await runMigrations(m_databasePool, m_logger)
    await m_databasePool.end();
};
