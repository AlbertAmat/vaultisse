import request from "supertest";
import {appService} from "../../src/AppService";
import {findOrCreateOidcUser, OidcUserError} from "../../src/services/OidcUserService";
import {OidcClaims} from "../../src/repositories/OidcRepository";
import {nextFakeIp, TEST_PASSWORD} from "../helpers/auth";
import {setupTestApp} from "../helpers/testApp";

const app = setupTestApp();

function freshClaims(overrides: Partial<OidcClaims> = {}): OidcClaims {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
        issuer: "https://auth.example.com/application/o/vaultisse/",
        sub: `sub_${suffix}`,
        email: `oidc_${suffix}@example.com`,
        emailVerified: true,
        name: "OIDC User",
        preferredUsername: `oidcuser_${suffix}`.slice(0, 40),
        ...overrides,
    };
}

async function registerLocal(email: string, userName: string) {
    const ip = nextFakeIp();
    const res = await request(app)
        .post("/register")
        .set("X-Forwarded-For", ip)
        .send({userName, email, name: "Local User", password: TEST_PASSWORD});
    expect(res.status).toBe(201);
}

describe("findOrCreateOidcUser", () => {
    const pool = () => appService.getDatabasePool();

    it("JIT-creates a new enabled account and reuses it on the same subject", async () => {
        const claims = freshClaims();
        const first = await findOrCreateOidcUser(pool(), claims);
        const second = await findOrCreateOidcUser(pool(), claims);

        expect(second.id).toBe(first.id);
        expect(second.token_version).toBe(first.token_version);

        const row = await pool().query(
            "SELECT disabled, email, oidc_issuer, oidc_sub FROM users WHERE id = $1",
            [first.id]
        );
        expect(row.rows[0]).toMatchObject({
            disabled: false,
            email: claims.email,
            oidc_issuer: claims.issuer,
            oidc_sub: claims.sub,
        });
    });

    it("links a verified-email local account instead of creating a second catalog", async () => {
        const claims = freshClaims();
        const userName = `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await registerLocal(claims.email, userName);

        const before = await pool().query("SELECT id FROM users WHERE email = $1", [claims.email]);
        const resolved = await findOrCreateOidcUser(pool(), claims);

        expect(resolved.id).toBe(before.rows[0].id);
        const after = await pool().query(
            "SELECT oidc_issuer, oidc_sub FROM users WHERE id = $1",
            [resolved.id]
        );
        expect(after.rows[0]).toMatchObject({
            oidc_issuer: claims.issuer,
            oidc_sub: claims.sub,
        });
    });

    it("does not link an existing account when the IdP email is unverified", async () => {
        const claims = freshClaims({emailVerified: false});
        const userName = `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await registerLocal(claims.email, userName);

        await expect(findOrCreateOidcUser(pool(), claims)).rejects.toBeInstanceOf(OidcUserError);

        const row = await pool().query(
            "SELECT oidc_issuer, oidc_sub FROM users WHERE email = $1",
            [claims.email]
        );
        expect(row.rows[0].oidc_issuer).toBeNull();
        expect(row.rows[0].oidc_sub).toBeNull();
    });

    it("JIT-creates when the email is new even if email_verified is false", async () => {
        const claims = freshClaims({emailVerified: false});
        const created = await findOrCreateOidcUser(pool(), claims);
        const row = await pool().query("SELECT email, disabled FROM users WHERE id = $1", [created.id]);
        expect(row.rows[0]).toMatchObject({email: claims.email, disabled: false});
    });

    it("rejects a missing email", async () => {
        await expect(findOrCreateOidcUser(pool(), freshClaims({email: "  "})))
            .rejects.toBeInstanceOf(OidcUserError);
    });

    it("rejects a missing subject", async () => {
        await expect(findOrCreateOidcUser(pool(), freshClaims({sub: "  "})))
            .rejects.toBeInstanceOf(OidcUserError);
    });

    it("rejects a disabled account (matched by subject)", async () => {
        const claims = freshClaims();
        const created = await findOrCreateOidcUser(pool(), claims);
        await pool().query("UPDATE users SET disabled = TRUE WHERE id = $1", [created.id]);

        await expect(findOrCreateOidcUser(pool(), claims)).rejects.toBeInstanceOf(OidcUserError);
    });

    it("rejects linking when the email already belongs to a different SSO subject", async () => {
        const first = freshClaims();
        await findOrCreateOidcUser(pool(), first);

        const second = freshClaims({
            email: first.email,
            emailVerified: true,
            sub: `${first.sub}-other`,
        });
        await expect(findOrCreateOidcUser(pool(), second)).rejects.toBeInstanceOf(OidcUserError);
    });
});
