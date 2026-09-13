/**
 * Resolve an OIDC login to a Vaultisse `users` row: match issuer+sub,
 * else link a verified-email local account, else JIT-create a new one.
 * See docs/AUTHENTICATION.md.
 */
import crypto from "crypto";
import {Pool, PoolClient} from "pg";
import {appService} from "../AppService";
import {OidcClaims} from "./Oidc";

export class OidcUserError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OidcUserError";
    }
}

export interface OidcResolvedUser {
    id: number;
    token_version: number;
}

interface UserRow {
    id: number;
    token_version: number;
    disabled: boolean;
    oidc_issuer: string | null;
    oidc_sub: string | null;
}

function requireActive(row: UserRow): OidcResolvedUser {
    if (row.disabled) {
        throw new OidcUserError("Account is disabled");
    }
    return {id: row.id, token_version: row.token_version};
}

function slugCode(preferredUsername: string | undefined, email: string): string {
    const raw = (preferredUsername || email.split("@")[0] || "user")
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "")
        .slice(0, 40);
    return raw || "user";
}

async function allocateUniqueCode(db: Pool | PoolClient, base: string): Promise<string> {
    for (let i = 0; i < 8; i++) {
        const suffix = i === 0 ? "" : `_${crypto.randomBytes(3).toString("hex")}`;
        const code = `${base.slice(0, 50 - suffix.length)}${suffix}`;
        const existing = await db.query("SELECT 1 FROM users WHERE code = $1", [code]);
        if (existing.rowCount === 0) {
            return code;
        }
    }
    throw new OidcUserError("Could not allocate a unique username");
}

function displayName(claims: OidcClaims): string {
    const name = (claims.name || claims.preferredUsername || claims.email.split("@")[0] || "User").trim();
    return name.slice(0, 100);
}

/**
 * Find, link, or create the Vaultisse account for this IdP subject.
 * Requires a non-empty email. Linking only happens when email_verified
 * is true, so an IdP that lets anyone claim an address cannot take over
 * an existing local account.
 */
export async function findOrCreateOidcUser(db: Pool | PoolClient, claims: OidcClaims): Promise<OidcResolvedUser> {
    const email = claims.email.trim();
    if (!email) {
        throw new OidcUserError("OIDC account has no email");
    }

    const bySub = await db.query(
        `SELECT id, token_version, disabled, oidc_issuer, oidc_sub
           FROM users
          WHERE oidc_issuer = $1 AND oidc_sub = $2`,
        [claims.issuer, claims.sub]
    );
    if (bySub.rowCount === 1) {
        return requireActive(bySub.rows[0]);
    }

    const byEmail = await db.query(
        `SELECT id, token_version, disabled, oidc_issuer, oidc_sub
           FROM users
          WHERE LOWER(email) = LOWER($1)`,
        [email]
    );

    if ((byEmail.rowCount ?? 0) > 0) {
        const row: UserRow = byEmail.rows[0];
        if (row.disabled) {
            throw new OidcUserError("Account is disabled");
        }
        if (row.oidc_sub && (row.oidc_issuer !== claims.issuer || row.oidc_sub !== claims.sub)) {
            throw new OidcUserError("Email is already linked to a different SSO account");
        }
        if (!claims.emailVerified) {
            throw new OidcUserError("Cannot link an unverified email to an existing account");
        }

        await db.query(
            `UPDATE users SET oidc_issuer = $1, oidc_sub = $2 WHERE id = $3`,
            [claims.issuer, claims.sub, row.id]
        );
        return {id: row.id, token_version: row.token_version};
    }

    const code = await allocateUniqueCode(db, slugCode(claims.preferredUsername, email));
    const passwordHash = await appService.hashPassword(crypto.randomBytes(32).toString("hex"));

    try {
        const inserted = await db.query(
            `INSERT INTO users (name, code, email, password, disabled, oidc_issuer, oidc_sub)
             VALUES ($1, $2, $3, $4, FALSE, $5, $6)
             RETURNING id, token_version`,
            [displayName(claims), code, email.slice(0, 100), passwordHash, claims.issuer, claims.sub]
        );
        return {id: inserted.rows[0].id, token_version: inserted.rows[0].token_version};
    } catch (err: any) {
        if (err.code === "23505") {
            const raced = await db.query(
                `SELECT id, token_version, disabled, oidc_issuer, oidc_sub
                   FROM users
                  WHERE oidc_issuer = $1 AND oidc_sub = $2`,
                [claims.issuer, claims.sub]
            );
            if (raced.rowCount === 1) {
                return requireActive(raced.rows[0]);
            }
            throw new OidcUserError("Unable to create an account for this SSO login");
        }
        throw err;
    }
}
