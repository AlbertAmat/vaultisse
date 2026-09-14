/**
 * Server-side OIDC authorization-code + PKCE (confidential client) - the
 * external-IdP-facing "repository" for the Auth resource (see
 * AuthService.ts), same "data access behind an interface" classification
 * as BookMetadataRepository.ts. The client secret never leaves this
 * process; the browser only sees a redirect to the IdP and a short-lived
 * `oidc_pending` cookie (SameSite=lax so it comes back on the top-level
 * callback navigation).
 */
import {Issuer, generators, Client} from "openid-client";
import jwt from "jsonwebtoken";
import {appService} from "../AppService";
import {SessionCookie} from "../utils/SessionCookie";

const OIDC_PENDING_AUDIENCE = "vaultisse-oidc-pending";

export interface OidcClaims {
    issuer: string;
    sub: string;
    email: string;
    emailVerified: boolean;
    name?: string;
    preferredUsername?: string;
}

interface OidcPendingPayload {
    state: string;
    nonce: string;
    codeVerifier: string;
}

/** OIDC authorization-code + PKCE flow against the configured IdP. A static-only utility class - stateless across requests other than the discovered-client cache below (a process-wide singleton, not per-caller state), same treatment as BookMetadataRepository.ts. */
export class OidcRepository {
    private static cachedClient: Client | null = null;
    private static cachedIssuer: string | null = null;

    /** Static-only utility class, never instantiated. */
    private constructor() {
    }

    /** Drops the discovery cache - used by tests after flipping env/config. */
    public static resetOidcClientCache(): void {
        OidcRepository.cachedClient = null;
        OidcRepository.cachedIssuer = null;
    }

    /**
     * Discovers (or reuses the cached) OIDC client for the configured issuer.
     * @returns The discovered client.
     */
    private static async getClient(): Promise<Client> {
        const config = appService.getOidcConfig();
        if (!config) {
            throw new Error("OIDC is not configured");
        }

        if (OidcRepository.cachedClient && OidcRepository.cachedIssuer === config.issuer) {
            return OidcRepository.cachedClient;
        }

        const issuer = await Issuer.discover(config.issuer);
        OidcRepository.cachedClient = new issuer.Client({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uris: [config.redirectUri],
            response_types: ["code"],
        });
        OidcRepository.cachedIssuer = config.issuer;
        return OidcRepository.cachedClient;
    }

    /**
     * Signs the pending-authorization payload into a short-lived JWT for the `oidc_pending` cookie.
     * @param payload State/nonce/codeVerifier to carry across the redirect.
     * @returns The signed token.
     */
    private static signPending(payload: OidcPendingPayload): string {
        return jwt.sign(payload, appService.getJwtSecret(), {
            expiresIn: Math.floor(SessionCookie.OIDC_PENDING_MAX_AGE_MS / 1000),
            audience: OIDC_PENDING_AUDIENCE,
            issuer: "vaultisse.com",
        });
    }

    /**
     * Verifies and decodes a pending-authorization cookie value.
     * @param token Raw `oidc_pending` cookie value, if any.
     * @returns The decoded payload, or null if missing/invalid/expired.
     */
    private static verifyPending(token: string | undefined): OidcPendingPayload | null {
        if (!token) {
            return null;
        }

        try {
            return jwt.verify(token, appService.getJwtSecret(), {
                algorithms: ["HS256"],
                audience: OIDC_PENDING_AUDIENCE,
                issuer: "vaultisse.com",
            }) as OidcPendingPayload;
        } catch {
            return null;
        }
    }

    /**
     * Builds the IdP authorize URL and a signed cookie value carrying the
     * matching PKCE verifier / state / nonce.
     * @returns The IdP authorize URL and the signed pending-cookie value.
     */
    public static async beginOidcAuthorization(): Promise<{url: string; pendingToken: string}> {
        const config = appService.getOidcConfig();
        if (!config) {
            throw new Error("OIDC is not configured");
        }

        const client = await OidcRepository.getClient();
        const state = generators.state();
        const nonce = generators.nonce();
        const codeVerifier = generators.codeVerifier();
        const codeChallenge = generators.codeChallenge(codeVerifier);

        // prompt=login: Authentik's implicit-consent flow otherwise reuses the
        // existing IdP session, so every "Sign in with SSO" lands on the same
        // Vaultisse user until someone logs out of Authentik itself.
        const url = client.authorizationUrl({
            scope: config.scopes,
            redirect_uri: config.redirectUri,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            state,
            nonce,
            prompt: "login",
        });

        return {url, pendingToken: OidcRepository.signPending({state, nonce, codeVerifier})};
    }

    /**
     * Checks whether a raw claim value represents "verified".
     * @param value Raw `email_verified` claim value.
     * @returns Whether it's truthy in either boolean or string form.
     */
    private static isEmailVerified(value: unknown): boolean {
        return value === true || value === "true";
    }

    /**
     * Builds normalized claims from the ID token, falling back to userinfo for fields the ID token omitted.
     * @param idToken Decoded ID token claims.
     * @param userinfo Userinfo endpoint response, if it was fetched.
     * @returns The normalized claims.
     */
    private static claimsFromIdTokenAndUserinfo(
        idToken: {sub: string; iss: string; email?: string; email_verified?: boolean | string; name?: string; preferred_username?: string},
        userinfo: {email?: string; email_verified?: boolean; name?: string; preferred_username?: string} | null
    ): OidcClaims {
        const sub = (idToken.sub || "").trim();
        if (!sub) {
            throw new Error("OIDC token has no subject");
        }

        const email = (idToken.email || userinfo?.email || "").trim();
        if (!email) {
            throw new Error("OIDC account has no email");
        }

        return {
            issuer: idToken.iss,
            sub,
            email,
            emailVerified: OidcRepository.isEmailVerified(idToken.email_verified) || OidcRepository.isEmailVerified(userinfo?.email_verified),
            name: (idToken.name || userinfo?.name || "").trim() || undefined,
            preferredUsername: (idToken.preferred_username || userinfo?.preferred_username || "").trim() || undefined,
        };
    }

    /**
     * Validates the callback query against the pending cookie, exchanges the
     * code, and returns the IdP claims (ID token, falling back to userinfo
     * for email/name when the ID token omitted them).
     *
     * @param query Callback query params (code/state, or an IdP-reported error).
     * @param pendingToken Raw `oidc_pending` cookie value.
     * @returns The normalized IdP claims.
     */
    public static async completeOidcAuthorization(
        query: {code?: string; state?: string; error?: string; error_description?: string},
        pendingToken: string | undefined
    ): Promise<OidcClaims> {
        if (query.error) {
            throw new Error(query.error_description || query.error);
        }

        const pending = OidcRepository.verifyPending(pendingToken);
        if (!pending || !query.code || !query.state || pending.state !== query.state) {
            throw new Error("Invalid or expired SSO login");
        }

        const config = appService.getOidcConfig();
        if (!config) {
            throw new Error("OIDC is not configured");
        }

        const client = await OidcRepository.getClient();
        const tokenSet = await client.callback(
            config.redirectUri,
            {code: query.code, state: query.state},
            {code_verifier: pending.codeVerifier, state: pending.state, nonce: pending.nonce}
        );

        const idToken = tokenSet.claims();
        let userinfo: {email?: string; email_verified?: boolean; name?: string; preferred_username?: string} | null = null;
        if (!idToken.email && tokenSet.access_token) {
            try {
                userinfo = await client.userinfo(tokenSet.access_token);
            } catch {
                userinfo = null;
            }
        }

        return OidcRepository.claimsFromIdTokenAndUserinfo(idToken, userinfo);
    }
}
