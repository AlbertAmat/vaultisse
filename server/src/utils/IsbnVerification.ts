/**
 * Server-side mirror of client/src/utils/IsbnVerification.ts. Used to reject
 * a malformed `isbn` route param before it's interpolated into an outbound
 * URL to Google Books / Open Library (see BooksRoute.ts) - closes a
 * CWE-88 argument-injection gap where a crafted path segment could inject
 * extra query parameters into that outbound request.
 */

/** ISBN-10/13 checksum validation and normalization. A static-only utility class - stateless, no DB access, same treatment as BookMetadataRepository.ts. */
export class IsbnVerification {
    /** Static-only utility class, never instantiated. */
    private constructor() {
    }

    /**
     * ISBN-10 checksum validation: weighted sum of the first 9 digits (weights
     * 10 down to 2) plus the check digit (10 if 'X') must be divisible by 11.
     * @param isbn Exactly 10 characters, digits with an optional trailing 'X'.
     * @returns Whether the checksum is valid.
     */
    public static validateIsbn10(isbn: string): boolean {
        let sum = 0;
        for (let i = 0; i < 9; i++) {
            sum += (10 - i) * parseInt(isbn[i], 10);
        }
        const checksum = isbn[9].toUpperCase();
        sum += checksum === 'X' ? 10 : parseInt(checksum, 10);
        return sum % 11 === 0;
    }

    /**
     * ISBN-13 checksum validation: alternating weights of 1 and 3 over the
     * first 12 digits must produce a check digit (13th) matching `(10 - sum%10) % 10`.
     * @param isbn Exactly 13 digit characters.
     * @returns Whether the checksum is valid.
     */
    public static validateIsbn13(isbn: string): boolean {
        let sum = 0;
        for (let i = 0; i < 12; i++) {
            const digit = parseInt(isbn[i], 10);
            sum += (i % 2 === 0 ? 1 : 3) * digit;
        }
        const checksum = (10 - (sum % 10)) % 10;
        return checksum === parseInt(isbn[12], 10);
    }

    /**
     * Strips any characters that aren't valid inside an ISBN (digits and, in an
     * ISBN-10 check digit, a trailing 'X') and validates the checksum. Returns
     * `null` for anything that isn't a well-formed ISBN-10/13, instead of
     * throwing, so callers can respond with a normal 400/404 rather than a 500.
     * @param raw Raw, possibly-formatted ISBN input.
     * @returns The normalized ISBN, or null if it's not well-formed.
     */
    public static normalizeAndValidateIsbn(raw: string): string | null {
        const isbn = (raw ?? "").trim().replace(/[\s-]/g, "").toUpperCase();

        if (/^\d{9}[\dX]$/.test(isbn) && IsbnVerification.validateIsbn10(isbn)) {
            return isbn;
        }

        if (/^\d{13}$/.test(isbn) && IsbnVerification.validateIsbn13(isbn)) {
            return isbn;
        }

        return null;
    }
}
