/**
 * Resolve an OIDC login to a Vaultisse `users` row: match issuer+sub,
 * else link a verified-email local account, else JIT-create a new one.
 * See docs/AUTHENTICATION.md.
 */
import crypto from "crypto";
import {Pool} from "pg";
import {appService} from "../AppService";
import {OidcUserRepository, OidcAccountRow} from "../repositories/OidcUserRepository";
import {OidcClaims} from "../repositories/OidcRepository";
import {ResolvedAuthUser} from "../types/auth";

export class OidcUserError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "OidcUserError";
    }
}

/** Business rules for resolving an OIDC login to a Vaultisse account: match, link, or just-in-time create. Calls OidcUserRepository. */
export class OidcUserService {
    /**
     * @param pool Database connection pool, forwarded to a fresh OidcUserRepository on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Guards an already-matched account against being disabled.
     * @param row Matched account row.
     * @returns The resolved auth user.
     * @throws OidcUserError if the account is disabled.
     */
    private requireActive(row: OidcAccountRow): ResolvedAuthUser {
        if (row.disabled) {
            throw new OidcUserError("Account is disabled");
        }
        return {id: row.id, tokenVersion: row.tokenVersion};
    }

    /**
     * Derives a starting login-code candidate from the IdP's preferred username, falling back to the email's local part.
     * @param preferredUsername IdP-reported preferred username, if any.
     * @param email Email address from the IdP claims.
     * @returns A sanitized, length-capped candidate code.
     */
    private slugCode(preferredUsername: string | undefined, email: string): string {
        const raw = (preferredUsername || email.split("@")[0] || "user")
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "")
            .slice(0, 40);
        return raw || "user";
    }

    /**
     * Finds a login code that isn't already taken, appending a random suffix on collision.
     * @param base Starting candidate code.
     * @returns A unique code.
     * @throws OidcUserError if no unique code could be allocated after several attempts.
     */
    private async allocateUniqueCode(base: string): Promise<string> {
        const repo = new OidcUserRepository(this.pool);
        for (let i = 0; i < 8; i++) {
            const suffix = i === 0 ? "" : `_${crypto.randomBytes(3).toString("hex")}`;
            const code = `${base.slice(0, 50 - suffix.length)}${suffix}`;
            if (!(await repo.codeExists(code))) {
                return code;
            }
        }
        throw new OidcUserError("Could not allocate a unique username");
    }

    /**
     * Derives a display name from the IdP claims.
     * @param claims Normalized IdP claims.
     * @returns The length-capped display name.
     */
    private displayName(claims: OidcClaims): string {
        const name = (claims.name || claims.preferredUsername || claims.email.split("@")[0] || "User").trim();
        return name.slice(0, 100);
    }

    /**
     * Find, link, or create the Vaultisse account for this IdP subject.
     * Requires a non-empty email. Linking only happens when email_verified
     * is true, so an IdP that lets anyone claim an address cannot take over
     * an existing local account.
     *
     * @param claims Normalized IdP claims.
     * @returns The resolved (existing, linked, or newly-created) auth user.
     */
    public async findOrCreateOidcUser(claims: OidcClaims): Promise<ResolvedAuthUser> {
        const email = claims.email.trim();
        const sub = (claims.sub || "").trim();
        if (!sub) {
            throw new OidcUserError("OIDC account has no subject");
        }
        if (!email) {
            throw new OidcUserError("OIDC account has no email");
        }

        const repo = new OidcUserRepository(this.pool);

        const bySub = await repo.findBySubject(claims.issuer, sub);
        if (bySub) {
            return this.requireActive(bySub);
        }

        const byEmail = await repo.findByEmail(email);
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

            await repo.linkIdentity(byEmail.id, claims.issuer, sub);
            return {id: byEmail.id, tokenVersion: byEmail.tokenVersion};
        }

        const code = await this.allocateUniqueCode(this.slugCode(claims.preferredUsername, email));
        const passwordHash = await appService.hashPassword(crypto.randomBytes(32).toString("hex"));

        try {
            return await repo.create({
                name: this.displayName(claims),
                code,
                email: email.slice(0, 100),
                passwordHash,
                issuer: claims.issuer,
                sub,
            });
        } catch (err: any) {
            if (err.code === "23505") {
                const raced = await repo.findBySubject(claims.issuer, sub);
                if (raced) {
                    return this.requireActive(raced);
                }
                throw new OidcUserError("Unable to create an account for this SSO login");
            }
            throw err;
        }
    }
}
