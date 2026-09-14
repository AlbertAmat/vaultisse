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

/** Data access for resolving an OIDC login to a `users` row. */
export class OidcUserRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Looks up a user already linked to this exact IdP subject.
     * @param issuer IdP issuer URL.
     * @param sub IdP subject identifier.
     * @returns The matching account, or null.
     */
    public async findBySubject(issuer: string, sub: string): Promise<OidcAccountRow | null> {
        const result = await this.db.query(
            `SELECT id, token_version AS "tokenVersion", disabled, oidc_issuer AS "oidcIssuer", oidc_sub AS "oidcSub"
               FROM users
              WHERE oidc_issuer = $1 AND oidc_sub = $2`,
            [issuer, sub]
        );
        return result.rowCount === 1 ? result.rows[0] : null;
    }

    /**
     * Looks up a user by email (case-insensitive), for account-linking.
     * @param email Email address from the IdP claims.
     * @returns The matching account, or null.
     */
    public async findByEmail(email: string): Promise<OidcAccountRow | null> {
        const result = await this.db.query(
            `SELECT id, token_version AS "tokenVersion", disabled, oidc_issuer AS "oidcIssuer", oidc_sub AS "oidcSub"
               FROM users
              WHERE LOWER(email) = LOWER($1)`,
            [email]
        );
        return (result.rowCount ?? 0) > 0 ? result.rows[0] : null;
    }

    /**
     * Links an existing local account to an IdP identity.
     * @param userId Account id to link.
     * @param issuer IdP issuer URL.
     * @param sub IdP subject identifier.
     */
    public async linkIdentity(userId: number, issuer: string, sub: string): Promise<void> {
        await this.db.query(`UPDATE users SET oidc_issuer = $1, oidc_sub = $2 WHERE id = $3`, [issuer, sub, userId]);
    }

    /**
     * Checks whether a login code is already taken.
     * @param code Candidate login code.
     * @returns Whether it's already in use.
     */
    public async codeExists(code: string): Promise<boolean> {
        const result = await this.db.query(`SELECT 1 FROM users WHERE code = $1`, [code]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Just-in-time creates a new account for an IdP identity.
     * @param fields New account fields.
     * @returns The new account's id and token_version.
     * @throws The raw pg error (code 23505 on a racing duplicate code/oidc identity) - OidcUserService handles the retry.
     */
    public async create(fields: NewOidcUserFields): Promise<ResolvedAuthUser> {
        const result = await this.db.query(
            `INSERT INTO users (name, code, email, password, disabled, oidc_issuer, oidc_sub)
             VALUES ($1, $2, $3, $4, FALSE, $5, $6)
             RETURNING id, token_version AS "tokenVersion"`,
            [fields.name, fields.code, fields.email, fields.passwordHash, fields.issuer, fields.sub]
        );
        return result.rows[0];
    }
}
