/**
 * Encryption at rest for secret settings (SMTP password, OIDC client secret, API keys) stored in
 * `app_settings`. AES-256-GCM; the key is derived (HKDF-SHA256, with a purpose label so it is a
 * different key from the JWT signing key) from `SETTINGS_ENCRYPTION_KEY`, falling back to
 * `JWT_SECRET` when that isn't set. Changing the secret the key is derived from makes the stored
 * secrets undecryptable - they then have to be entered again in the portal.
 */
import crypto from "crypto";

const PREFIX = "enc:v1:";

/** Encrypts and decrypts setting values. */
export class SettingsCrypto {
    private readonly key: Buffer;

    /**
     * @param secret The secret the encryption key is derived from.
     */
    public constructor(secret: string) {
        this.key = Buffer.from(crypto.hkdfSync("sha256", secret, "vaultisse", "app-settings-v1", 32));
    }

    /**
     * @param value Stored value.
     * @returns Whether it is an encrypted payload.
     */
    public static isEncrypted(value: string): boolean {
        return value.startsWith(PREFIX);
    }

    /**
     * @param plain Value to protect.
     * @returns `enc:v1:<iv>:<tag>:<ciphertext>`, each part base64url.
     *
     * @example
     *   crypto.encrypt("my-smtp-password") // "enc:v1:<iv>:<tag>:<ciphertext>"  (AES-256-GCM; a different value every time)
     *   crypto.decrypt(that)               // "my-smtp-password"
     */
    public encrypt(plain: string): string {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
        const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
        return `${PREFIX}${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
    }

    /**
     * @param payload Value produced by {@link encrypt}.
     * @returns The original value.
     * @throws Error when the payload is malformed or the key is wrong.
     */
    public decrypt(payload: string): string {
        if (!SettingsCrypto.isEncrypted(payload)) {
            throw new Error("Not an encrypted setting value.");
        }
        const [iv, tag, ciphertext] = payload.slice(PREFIX.length).split(":");
        if (!iv || !tag || ciphertext === undefined) {
            throw new Error("Malformed encrypted setting value.");
        }
        const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
    }
}
