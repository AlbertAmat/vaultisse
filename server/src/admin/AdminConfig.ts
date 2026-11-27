/**
 * Bootstrap configuration of the optional admin portal. These come from env vars only, on purpose:
 * they decide whether the portal exists at all and where it listens, so they can't live in the
 * database the portal itself edits.
 *
 *  - `ADMIN_ENABLED=true` turns the portal on (default off). When off, no admin port is opened, no
 *    admin route exists, database-stored settings are ignored and plans/quotas are not enforced: the
 *    server behaves exactly as it did before the portal existed, configured by env vars alone.
 *  - `ADMIN_PORT` is the port of the separate admin listener (default 3001).
 *  - `ADMIN_URL` is the public origin the admin web app is served from (e.g. https://adm.vaultisse.com).
 *    Browser requests from any other origin are rejected. Leave empty only for same-origin/localhost use.
 *  - `ADMIN_ALLOWED_IPS` optionally restricts the admin listener to these client IPs (comma separated).
 */
export interface AdminConfig {
    enabled: boolean;
    port: number;
    /** Origin without trailing slash, or null when not set. */
    url: string | null;
    /** Empty = no IP restriction. */
    allowedIps: string[];
}

/**
 * Reads the admin portal bootstrap settings.
 * @param env Environment variables.
 * @returns The resolved configuration.
 * @throws Error when the admin port collides with the API port or is not a valid port.
 */
export function readAdminConfig(env: NodeJS.ProcessEnv): AdminConfig {
    const enabled = (env.ADMIN_ENABLED ?? "").trim().toLowerCase() === "true";
    const rawPort = (env.ADMIN_PORT ?? "").trim();
    const port = rawPort === "" ? 3001 : Number(rawPort);
    const url = (env.ADMIN_URL ?? "").trim().replace(/\/+$/, "") || null;
    const allowedIps = (env.ADMIN_ALLOWED_IPS ?? "")
        .split(",")
        .map((ip) => ip.trim())
        .filter((ip) => ip.length > 0);

    if (enabled) {
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error("ADMIN_PORT must be a valid port number.");
        }
        // Port 0 means "any free port" (used by the tests), which can't collide.
        if (port !== 0 && port === Number(env.API_PORT)) {
            throw new Error("ADMIN_PORT must differ from API_PORT: the admin portal listens on its own port.");
        }
    }

    return {enabled, port, url, allowedIps};
}
