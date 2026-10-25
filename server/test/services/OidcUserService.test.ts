import request from "supertest";
import {appService} from "../../src/AppService";
import {OidcUserService, OidcUserError} from "../../src/services/OidcUserService";
import {OidcClaims} from "../../src/repositories/OidcRepository";
import {nextFakeIp, TEST_PASSWORD} from "../helpers/auth";
import {VaultRepository} from "../../src/repositories/VaultRepository";
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
        groups: [],
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
        const first = await new OidcUserService(pool()).findOrCreateOidcUser(claims);
        const second = await new OidcUserService(pool()).findOrCreateOidcUser(claims);

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
        const resolved = await new OidcUserService(pool()).findOrCreateOidcUser(claims);

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

        await expect(new OidcUserService(pool()).findOrCreateOidcUser(claims)).rejects.toBeInstanceOf(OidcUserError);

        const row = await pool().query(
            "SELECT oidc_issuer, oidc_sub FROM users WHERE email = $1",
            [claims.email]
        );
        expect(row.rows[0].oidc_issuer).toBeNull();
        expect(row.rows[0].oidc_sub).toBeNull();
    });

    it("JIT-creates when the email is new even if email_verified is false", async () => {
        const claims = freshClaims({emailVerified: false});
        const created = await new OidcUserService(pool()).findOrCreateOidcUser(claims);
        const row = await pool().query("SELECT email, disabled FROM users WHERE id = $1", [created.id]);
        expect(row.rows[0]).toMatchObject({email: claims.email, disabled: false});
    });

    it("rejects a missing email", async () => {
        await expect(new OidcUserService(pool()).findOrCreateOidcUser(freshClaims({email: "  "})))
            .rejects.toBeInstanceOf(OidcUserError);
    });

    it("rejects a missing subject", async () => {
        await expect(new OidcUserService(pool()).findOrCreateOidcUser(freshClaims({sub: "  "})))
            .rejects.toBeInstanceOf(OidcUserError);
    });

    it("rejects a disabled account (matched by subject)", async () => {
        const claims = freshClaims();
        const created = await new OidcUserService(pool()).findOrCreateOidcUser(claims);
        await pool().query("UPDATE users SET disabled = TRUE WHERE id = $1", [created.id]);

        await expect(new OidcUserService(pool()).findOrCreateOidcUser(claims)).rejects.toBeInstanceOf(OidcUserError);
    });

    it("rejects linking when the email already belongs to a different SSO subject", async () => {
        const first = freshClaims();
        await new OidcUserService(pool()).findOrCreateOidcUser(first);

        const second = freshClaims({
            email: first.email,
            emailVerified: true,
            sub: `${first.sub}-other`,
        });
        await expect(new OidcUserService(pool()).findOrCreateOidcUser(second)).rejects.toBeInstanceOf(OidcUserError);
    });
});

describe("syncGroupRoles", () => {
    const pool = () => appService.getDatabasePool();

    /** A vault with an admin, a loans setting and the given group -> role mapping. */
    async function setupVault(mapping: Record<string, number>, loans = true) {
        const vaults = new VaultRepository(pool());
        const vaultId = await vaults.createVault("Shared", null);
        const admin = await new OidcUserService(pool()).findOrCreateOidcUser(freshClaims());
        await vaults.addMember(vaultId, admin.id, 1, 1); // keeps the vault's required admin
        if (loans) {
            await pool().query("UPDATE vault SET loans_enabled = TRUE WHERE id = $1", [vaultId]);
        }
        await vaults.replaceSsoGroups(vaultId, Object.entries(mapping).map(([group_name, role]) => ({group_name, role})));
        return vaultId;
    }

    /** Puts `userId` on loan of a copy from the vault. */
    async function lendBook(vaultId: number, userId: number) {
        const book = await pool().query("INSERT INTO books (name, vault_id) VALUES ('Loan test', $1) RETURNING id", [vaultId]);
        await pool().query(
            "INSERT INTO book_stocks (vault_id, book_id, code, status, member_user_id) VALUES ($1, $2, $3, 2, $4)",
            [vaultId, book.rows[0].id, Math.random().toString(36).slice(2, 12).padEnd(10, "0"), userId]
        );
    }

    afterEach(() => jest.restoreAllMocks());

    it("adds the user with the highest matching role, and removes them when the groups no longer match", async () => {
        const service = new OidcUserService(pool());
        const vaults = new VaultRepository(pool());
        const user = await service.findOrCreateOidcUser(freshClaims());
        const vaultId = await setupVault({"example-users": 2, "example-managers": 0, "example-admins": 1});

        await service.syncGroupRoles(user.id, ["example-users", "example-managers", "unmapped"]);
        expect(await vaults.getMembership(vaultId, user.id)).toMatchObject({role: 0, status: 1});

        await service.syncGroupRoles(user.id, ["example-users", "example-admins"]);
        expect(await vaults.getMembership(vaultId, user.id)).toMatchObject({role: 1, status: 1});

        await service.syncGroupRoles(user.id, ["unmapped"]);
        expect(await vaults.getMembership(vaultId, user.id)).toBeNull();
    });

    it("makes a member with outstanding loans Restricted instead of removing them, and restores them on return", async () => {
        const service = new OidcUserService(pool());
        const vaults = new VaultRepository(pool());
        const user = await service.findOrCreateOidcUser(freshClaims());
        const vaultId = await setupVault({"example-users": 0});

        await service.syncGroupRoles(user.id, ["example-users"]);
        await lendBook(vaultId, user.id);
        await service.syncGroupRoles(user.id, []);
        expect(await vaults.getMembership(vaultId, user.id)).toMatchObject({role: 4, status: 1, can_borrow: false});

        await service.syncGroupRoles(user.id, ["example-users"]);
        expect(await vaults.getMembership(vaultId, user.id)).toMatchObject({role: 0, status: 1});
    });

    it("never removes or changes members added by hand", async () => {
        const service = new OidcUserService(pool());
        const vaults = new VaultRepository(pool());
        const user = await service.findOrCreateOidcUser(freshClaims());
        const vaultId = await setupVault({"example-admins": 1});
        await vaults.addMember(vaultId, user.id, 3, 1);

        await service.syncGroupRoles(user.id, ["example-admins"]);
        expect(await vaults.getMembership(vaultId, user.id)).toMatchObject({role: 3, status: 1});
        await service.syncGroupRoles(user.id, []);
        expect(await vaults.getMembership(vaultId, user.id)).toMatchObject({role: 3, status: 1});
    });

    it("a manual role change takes an SSO member off SSO management", async () => {
        const service = new OidcUserService(pool());
        const vaults = new VaultRepository(pool());
        const user = await service.findOrCreateOidcUser(freshClaims());
        const vaultId = await setupVault({"example-users": 0});

        await service.syncGroupRoles(user.id, ["example-users"]);
        await vaults.updateMember(vaultId, user.id, {role: 3});
        await service.syncGroupRoles(user.id, []);
        expect(await vaults.getMembership(vaultId, user.id)).toMatchObject({role: 3, status: 1});
    });

    it("leaves vaults without a mapping alone", async () => {
        const service = new OidcUserService(pool());
        const vaults = new VaultRepository(pool());
        const user = await service.findOrCreateOidcUser(freshClaims());
        const vaultId = await setupVault({});
        await vaults.addMember(vaultId, user.id, 0, 1);
        await vaults.upsertSsoMember(vaultId, user.id, 0); // no-op: hand-added accepted member

        await service.syncGroupRoles(user.id, []);
        expect(await vaults.getMembership(vaultId, user.id)).toMatchObject({role: 0, status: 1});
    });

    it("does nothing when the IdP sent no groups claim", async () => {
        const service = new OidcUserService(pool());
        const vaults = new VaultRepository(pool());
        const user = await service.findOrCreateOidcUser(freshClaims());
        const vaultId = await setupVault({"example-users": 0});

        await service.syncGroupRoles(user.id, ["example-users"]);
        await service.syncGroupRoles(user.id, null);
        expect(await vaults.getMembership(vaultId, user.id)).toMatchObject({role: 0, status: 1});
    });

    it("skips the borrower role in a vault without loans", async () => {
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        const service = new OidcUserService(pool());
        const user = await service.findOrCreateOidcUser(freshClaims());
        const vaultId = await setupVault({"example-users": 2}, false);

        await service.syncGroupRoles(user.id, ["example-users"]);
        expect(await new VaultRepository(pool()).getMembership(vaultId, user.id)).toBeNull();
    });

    it("skips the personal vault when OIDC_PERSONAL_VAULT is off", async () => {
        jest.spyOn(appService, "getOidcConfig").mockReturnValue({
            issuer: "i", clientId: "c", clientSecret: "s", redirectUri: "r", scopes: "openid", buttonLabel: "SSO",
            groupsClaim: "groups", personalVault: false,
        });
        const user = await new OidcUserService(pool()).findOrCreateOidcUser(freshClaims());
        expect(await new VaultRepository(pool()).getVaults(user.id)).toEqual([]);
    });
});
