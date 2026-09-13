/**
 * Server-side OIDC authorization-code + PKCE (confidential client).
 * Used by AuthRoute's /auth/oidc/* handlers. The client secret never
 * leaves this process; the browser only sees a redirect to the IdP and
 * a short-lived `oidc_pending` cookie (SameSite=lax so it comes back
 * on the top-level callback navigation).
 */
import {Issuer, generators, Client} from "openid-client";
import jwt from "jsonwebtoken";
import {appService} from "../AppService";
import {OIDC_PENDING_MAX_AGE_MS} from "./SessionCookie";

export {OIDC_PENDING_COOKIE} from "./SessionCookie";

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

let cachedClient: Client | null = null;
let cachedIssuer: string | null = null;

/** Drops the discovery cache - used by tests after flipping env/config. */
export function resetOidcClientCache(): void {
    cachedClient = null;
    cachedIssuer = null;
}

async function getClient(): Promise<Client> {
    const config = appService.getOidcConfig();
    if (!config) {
        throw new Error("OIDC is not configured");
    }

    if (cachedClient && cachedIssuer === config.issuer) {
        return cachedClient;
    }

    const issuer = await Issuer.discover(config.issuer);
    cachedClient = new issuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: [config.redirectUri],
        response_types: ["code"],
    });
    cachedIssuer = config.issuer;
    return cachedClient;
}

function signPending(payload: OidcPendingPayload): string {
    return jwt.sign(payload, appService.getJwtSecret(), {
        expiresIn: Math.floor(OIDC_PENDING_MAX_AGE_MS / 1000),
        audience: OIDC_PENDING_AUDIENCE,
        issuer: "vaultisse.com",
    });
}

function verifyPending(token: string | undefined): OidcPendingPayload | null {
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
 */
export async function beginOidcAuthorization(): Promise<{url: string; pendingToken: string}> {
    const config = appService.getOidcConfig();
    if (!config) {
        throw new Error("OIDC is not configured");
    }

    const client = await getClient();
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

    return {url, pendingToken: signPending({state, nonce, codeVerifier})};
}

function isEmailVerified(value: unknown): boolean {
    return value === true || value === "true";
}

function claimsFromIdTokenAndUserinfo(
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
        emailVerified: isEmailVerified(idToken.email_verified) || isEmailVerified(userinfo?.email_verified),
        name: (idToken.name || userinfo?.name || "").trim() || undefined,
        preferredUsername: (idToken.preferred_username || userinfo?.preferred_username || "").trim() || undefined,
    };
}

/**
 * Validates the callback query against the pending cookie, exchanges the
 * code, and returns the IdP claims (ID token, falling back to userinfo
 * for email/name when the ID token omitted them).
 */
export async function completeOidcAuthorization(
    query: {code?: string; state?: string; error?: string; error_description?: string},
    pendingToken: string | undefined
): Promise<OidcClaims> {
    if (query.error) {
        throw new Error(query.error_description || query.error);
    }

    const pending = verifyPending(pendingToken);
    if (!pending || !query.code || !query.state || pending.state !== query.state) {
        throw new Error("Invalid or expired SSO login");
    }

    const config = appService.getOidcConfig();
    if (!config) {
        throw new Error("OIDC is not configured");
    }

    const client = await getClient();
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

    return claimsFromIdTokenAndUserinfo(idToken, userinfo);
}
