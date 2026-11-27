import {readAdminConfig} from "../../src/admin/AdminConfig";
import {SettingsCrypto} from "../../src/admin/services/SettingsCrypto";
import {validateAdminPassword} from "../../src/admin/services/AdminAuthService";
import {SETTINGS_CATALOG} from "../../src/admin/services/settingsCatalog";
import {TrafficMonitor} from "../../src/admin/services/TrafficMonitor";

describe("readAdminConfig", () => {
    it("is off by default and only on for exactly ADMIN_ENABLED=true", () => {
        expect(readAdminConfig({}).enabled).toBe(false);
        expect(readAdminConfig({ADMIN_ENABLED: "false"}).enabled).toBe(false);
        expect(readAdminConfig({ADMIN_ENABLED: "yes"}).enabled).toBe(false);
        expect(readAdminConfig({ADMIN_ENABLED: "TRUE"}).enabled).toBe(true);
    });

    it("defaults to port 3001, trims the public URL and parses the IP allowlist", () => {
        const config = readAdminConfig({ADMIN_ENABLED: "true", API_PORT: "3000", ADMIN_URL: " https://adm.example.com/ ", ADMIN_ALLOWED_IPS: "10.0.0.1, 10.0.0.2,"});
        expect(config).toEqual({enabled: true, port: 3001, url: "https://adm.example.com", allowedIps: ["10.0.0.1", "10.0.0.2"]});
    });

    it("refuses to share the API's port or use an invalid one", () => {
        expect(() => readAdminConfig({ADMIN_ENABLED: "true", API_PORT: "3000", ADMIN_PORT: "3000"})).toThrow(/differ from API_PORT/);
        expect(() => readAdminConfig({ADMIN_ENABLED: "true", ADMIN_PORT: "99999"})).toThrow(/valid port/);
        // Only checked when the portal is on.
        expect(() => readAdminConfig({API_PORT: "3000", ADMIN_PORT: "3000"})).not.toThrow();
    });
});

describe("SettingsCrypto", () => {
    it("round-trips a value and never produces the same ciphertext twice", () => {
        const crypto = new SettingsCrypto("a-secret");
        const a = crypto.encrypt("smtp-password");
        const b = crypto.encrypt("smtp-password");
        expect(a).not.toBe(b);
        expect(a).not.toContain("smtp-password");
        expect(SettingsCrypto.isEncrypted(a)).toBe(true);
        expect(crypto.decrypt(a)).toBe("smtp-password");
        expect(crypto.decrypt(crypto.encrypt(""))).toBe("");
    });

    it("can't be read with another secret, and detects tampering", () => {
        const payload = new SettingsCrypto("a-secret").encrypt("value");
        expect(() => new SettingsCrypto("another-secret").decrypt(payload)).toThrow();
        const [prefix, iv, tag, data] = [payload.slice(0, 7), ...payload.slice(7).split(":")];
        const flipped = `${prefix}${iv}:${tag}:${Buffer.from("x" + Buffer.from(data, "base64url").toString("latin1").slice(1), "latin1").toString("base64url")}`;
        expect(() => new SettingsCrypto("a-secret").decrypt(flipped)).toThrow();
        expect(() => new SettingsCrypto("a-secret").decrypt("not encrypted")).toThrow();
    });
});

describe("validateAdminPassword", () => {
    it("asks for more than a regular user password", () => {
        expect(() => validateAdminPassword("Short1!")).toThrow(/12 characters/);
        expect(() => validateAdminPassword("alllowercase1234!")).toThrow(/uppercase/);
        expect(() => validateAdminPassword("NoSpecialChar1234")).toThrow(/special/);
        expect(() => validateAdminPassword("A-Long-Enough-Passw0rd")).not.toThrow();
    });
});

describe("settings catalog", () => {
    it("has unique keys, and every select has options", () => {
        const keys = SETTINGS_CATALOG.map((setting) => setting.key);
        expect(new Set(keys).size).toBe(keys.length);
        SETTINGS_CATALOG.filter((setting) => setting.type === "select").forEach((setting) => expect(setting.options?.length).toBeGreaterThan(0));
    });

    it("never offers the settings that must stay env-only", () => {
        const keys = SETTINGS_CATALOG.map((setting) => setting.key);
        for (const bootstrap of ["JWT_SECRET", "DB_PASSWORD", "DB_HOST", "API_PORT", "ADMIN_ENABLED", "ADMIN_PORT", "TRUST_PROXY", "SETTINGS_ENCRYPTION_KEY", "ALLOW_DEV_AUTH", "DEMO_MODE"]) {
            expect(keys).not.toContain(bootstrap);
        }
    });

    it("marks every credential as a secret", () => {
        for (const key of ["SMTP_PASSWORD", "OIDC_CLIENT_SECRET", "GOOGLE_BOOKS_API_KEY", "LIBRARYTHING_API_KEY"]) {
            expect(SETTINGS_CATALOG.find((setting) => setting.key === key)?.type).toBe("secret");
        }
    });
});

describe("TrafficMonitor", () => {
    it("counts responses per minute and ranks the busiest addresses", () => {
        const monitor = new TrafficMonitor();
        const finish = (ip: string, status: number) => {
            let listener: () => void = () => undefined;
            monitor.middleware({ip} as never, {statusCode: status, on: (_event: string, fn: () => void) => { listener = fn; }} as never, () => undefined);
            listener();
        };
        finish("1.1.1.1", 200);
        finish("1.1.1.1", 404);
        finish("2.2.2.2", 500);
        finish("1.1.1.1", 429);

        const series = monitor.series();
        expect(series).toHaveLength(60);
        const last = series[series.length - 1];
        expect(last).toMatchObject({total: 4, clientErrors: 1, serverErrors: 1, rateLimited: 1});
        expect(monitor.topIps(5)).toEqual([{ipAddress: "1.1.1.1", requests: 3}, {ipAddress: "2.2.2.2", requests: 1}]);
    });
});
