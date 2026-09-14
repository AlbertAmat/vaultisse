/**
 * Resolve an OIDC login to a Vaultisse `users` row: match issuer+sub,
 * else link a verified-email local account, else JIT-create a new one.
 * See docs/AUTHENTICATION.md.
 */
import crypto from "crypto";
import {Pool, PoolClient} from "pg";
import {appService} from "../AppService";
import * as OidcUserRepository from "../repositories/OidcUserRepository";
import {OidcAccountRow} from "../repositories/OidcUserRepository";
import {OidcClaims} from "../repositories/OidcRepository";
import {ResolvedAuthUser} from "../types/auth";

export class OidcUserError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "OidcUserError";
    }
}

function requireActive(row: OidcAccountRow): ResolvedAuthUser {
    if (row.disabled) {
        throw new OidcUserError("Account is disabled");
    }
    return {id: row.id, tokenVersion: row.tokenVersion};
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
        if (!(await OidcUserRepository.codeExists(db, code))) {
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
export async function findOrCreateOidcUser(db: Pool | PoolClient, claims: OidcClaims): Promise<ResolvedAuthUser> {
    const email = claims.email.trim();
    const sub = (claims.sub || "").trim();
    if (!sub) {
        throw new OidcUserError("OIDC account has no subject");
    }
    if (!email) {
        throw new OidcUserError("OIDC account has no email");
    }

    const bySub = await OidcUserRepository.findBySubject(db, claims.issuer, sub);
    if (bySub) {
        return requireActive(bySub);
    }

    const byEmail = await OidcUserRepository.findByEmail(db, email);
    if (byEmail) {
        if (byEmail.disabled) {
            throw new OidcUserError("Account is disabled");
        }
        if (byEmail.oidcSub && (byEmail.oidcIssuer !== claims.issuer || byEmail.oidcSub !== sub)) {
            throw new OidcUserError("Email is already linked to a different SSO account");
        }
        if (!claims.emailVerified) {
            throw new OidcUserError("Cannot link an unverified email to an existing account");
        }

        await OidcUserRepository.linkIdentity(db, byEmail.id, claims.issuer, sub);
        return {id: byEmail.id, tokenVersion: byEmail.tokenVersion};
    }

    const code = await allocateUniqueCode(db, slugCode(claims.preferredUsername, email));
    const passwordHash = await appService.hashPassword(crypto.randomBytes(32).toString("hex"));

    try {
        return await OidcUserRepository.create(db, {
            name: displayName(claims),
            code,
            email: email.slice(0, 100),
            passwordHash,
            issuer: claims.issuer,
            sub,
        });
    } catch (err: any) {
        if (err.code === "23505") {
            const raced = await OidcUserRepository.findBySubject(db, claims.issuer, sub);
            if (raced) {
                return requireActive(raced);
            }
            throw new OidcUserError("Unable to create an account for this SSO login");
        }
        throw err;
    }
}
