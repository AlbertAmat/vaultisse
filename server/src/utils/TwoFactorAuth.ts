/**
 * TOTP (RFC 6238) helpers for two-factor authentication: secret/QR
 * generation, code verification, and one-time backup codes. Wraps `otplib`
 * and `qrcode` - pure functions only, no DB/session access (see
 * AuthService.ts and UserService.ts for how these are wired into login and
 * account settings). Nothing here talks to Google or any external service
 * despite the "Google Authenticator" branding on the client apps that scan
 * the QR code - TOTP is an open standard any authenticator app implements
 * the same way.
 */
// otplib v13 dropped the old `authenticator` singleton (generateSecret/keyuri/check)
// for a functional API - generateSecret/generateURI/verify, verify being async
// since it goes through a pluggable (default: pure-JS Noble) crypto backend.
import {generateSecret as generateOtpSecret, generateURI, verify as verifyOtp} from "otplib";
import QRCode from "qrcode";
import crypto from "crypto";

const ISSUER = "Vaultisse";

/** TOTP secret/QR generation, code verification, and one-time backup codes. A static-only utility class - stateless, no DB access, same treatment as BookMetadataRepository.ts. */
export class TwoFactorAuth {
    /** Static-only utility class, never instantiated. */
    private constructor() {
    }

    /**
     * Generates a new random base32 TOTP secret.
     * @returns The new secret.
     */
    public static generateTotpSecret(): string {
        return generateOtpSecret();
    }

    /**
     * Builds the `otpauth://` URI an authenticator app scans/imports to add the account.
     * @param accountName Account label shown in the authenticator app.
     * @param secret TOTP secret.
     * @returns The `otpauth://` URI.
     */
    public static buildOtpAuthUrl(accountName: string, secret: string): string {
        return generateURI({issuer: ISSUER, label: accountName, secret});
    }

    /**
     * Renders an `otpauth://` URI as a scannable QR code (PNG `data:` URL).
     * @param otpauthUrl The `otpauth://` URI to encode.
     * @returns The QR code as a PNG data URL.
     */
    public static generateQrCodeDataUrl(otpauthUrl: string): Promise<string> {
        return QRCode.toDataURL(otpauthUrl);
    }

    /**
     * Verifies a 6-digit TOTP code against the stored secret (otplib tolerates ±1 time step for clock drift).
     * @param secret Stored TOTP secret.
     * @param code User-entered code.
     * @returns Whether the code is valid.
     */
    public static async verifyTotpCode(secret: string, code: string): Promise<boolean> {
        if (!/^\d{6}$/.test(code)) {
            return false;
        }

        try {
            const result = await verifyOtp({secret, token: code});
            return result.valid;
        } catch {
            return false;
        }
    }

    /**
     * Generates `count` random, human-typeable one-time backup codes
     * (e.g. "A1B2C3D4-E5F6G7H8"), for signing in if the authenticator app is
     * lost. Callers are responsible for hashing before storage and returning
     * the plaintext to the user exactly once.
     *
     * @param count How many codes to generate.
     * @returns The freshly-generated backup codes.
     */
    public static generateBackupCodes(count: number = 10): string[] {
        const codes: string[] = [];
        for (let i = 0; i < count; i++) {
            const part1 = crypto.randomBytes(4).toString("hex").toUpperCase();
            const part2 = crypto.randomBytes(4).toString("hex").toUpperCase();
            codes.push(`${part1}-${part2}`);
        }
        return codes;
    }

    /**
     * Normalizes user-entered backup code input (trim + uppercase) before hashing/comparison.
     * @param raw Raw user-entered backup code.
     * @returns The normalized code.
     */
    public static normalizeBackupCode(raw: string): string {
        return (raw ?? "").trim().toUpperCase();
    }
}
