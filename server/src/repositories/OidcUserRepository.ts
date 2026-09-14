/**
 * Data access for resolving an OIDC login to a `users` row - see
 * OidcUserService.ts for the matching/linking/JIT-creation business rules
 * built on top of these.
 */
import {Pool, PoolClient} from "pg";
import {ResolvedAuthUser} from "../types/auth";

export interface OidcAccountRow {
    id: number;
    tokenVersion: number;
    disabled: boolean;
    oidcIssuer: string | null;
    oidcSub: string | null;
}

export interface NewOidcUserFields {
    name: string;
    code: string;
    email: string;
    passwordHash: string;
    issuer: string;
    sub: string;
}

export async function findBySubject(db: Pool | PoolClient, issuer: string, sub: string): Promise<OidcAccountRow | null> {
    const result = await db.query(
        `SELECT id, token_version AS "tokenVersion", disabled, oidc_issuer AS "oidcIssuer", oidc_sub AS "oidcSub"
           FROM users
          WHERE oidc_issuer = $1 AND oidc_sub = $2`,
        [issuer, sub]
    );
    return result.rowCount === 1 ? result.rows[0] : null;
}

export async function findByEmail(db: Pool | PoolClient, email: string): Promise<OidcAccountRow | null> {
    const result = await db.query(
        `SELECT id, token_version AS "tokenVersion", disabled, oidc_issuer AS "oidcIssuer", oidc_sub AS "oidcSub"
           FROM users
          WHERE LOWER(email) = LOWER($1)`,
        [email]
    );
    return (result.rowCount ?? 0) > 0 ? result.rows[0] : null;
}

export async function linkIdentity(db: Pool | PoolClient, userId: number, issuer: string, sub: string): Promise<void> {
    await db.query(`UPDATE users SET oidc_issuer = $1, oidc_sub = $2 WHERE id = $3`, [issuer, sub, userId]);
}

export async function codeExists(db: Pool | PoolClient, code: string): Promise<boolean> {
    const result = await db.query(`SELECT 1 FROM users WHERE code = $1`, [code]);
    return (result.rowCount ?? 0) > 0;
}

/** Throws the raw pg error (code 23505 on a racing duplicate code/oidc identity) - OidcUserService handles the retry. */
export async function create(db: Pool | PoolClient, fields: NewOidcUserFields): Promise<ResolvedAuthUser> {
    const result = await db.query(
        `INSERT INTO users (name, code, email, password, disabled, oidc_issuer, oidc_sub)
         VALUES ($1, $2, $3, $4, FALSE, $5, $6)
         RETURNING id, token_version AS "tokenVersion"`,
        [fields.name, fields.code, fields.email, fields.passwordHash, fields.issuer, fields.sub]
    );
    return result.rows[0];
}
