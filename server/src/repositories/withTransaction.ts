import {Pool, PoolClient} from "pg";

/**
 * Runs `fn` inside a BEGIN/COMMIT transaction on a single checked-out
 * client, rolling back on any thrown error. Pass the returned `client` to
 * repository functions instead of the pool so every call in `fn` shares the
 * same transaction - same `Pool | PoolClient` convention every repository
 * function already accepts.
 *
 * Extracted from the hand-rolled BEGIN/UPDATE/UPDATE/COMMIT that
 * LocationRoute.ts's "set default location" endpoint used before this
 * existed - see LocationRepository.setDefault for that call site.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}
