import {IsbnVerification} from "../../src/utils/IsbnVerification";

describe("validateIsbn10", () => {
    it("accepts a known-valid ISBN-10", () => {
        expect(IsbnVerification.validateIsbn10("0261102214")).toBe(true); // The Hobbit
    });

    it("accepts a valid ISBN-10 with an 'X' check digit", () => {
        expect(IsbnVerification.validateIsbn10("097522980X")).toBe(true);
    });

    it("rejects a corrupted digit", () => {
        expect(IsbnVerification.validateIsbn10("0261102215")).toBe(false);
    });
});

describe("validateIsbn13", () => {
    it("accepts a known-valid ISBN-13", () => {
        expect(IsbnVerification.validateIsbn13("9780261102217")).toBe(true); // The Hobbit
    });

    it("rejects a corrupted digit", () => {
        expect(IsbnVerification.validateIsbn13("9780261102218")).toBe(false);
    });
});

describe("normalizeAndValidateIsbn", () => {
    it("strips spaces and hyphens before validating", () => {
        expect(IsbnVerification.normalizeAndValidateIsbn("978-0-26-110221-7")).toBe("9780261102217");
        expect(IsbnVerification.normalizeAndValidateIsbn("0 26 110221 4")).toBe("0261102214");
    });

    it("uppercases a lowercase 'x' check digit", () => {
        expect(IsbnVerification.normalizeAndValidateIsbn("097522980x")).toBe("097522980X");
    });

    it("returns null for a malformed value", () => {
        expect(IsbnVerification.normalizeAndValidateIsbn("not-an-isbn")).toBeNull();
    });

    it("returns null for a well-formed but checksum-invalid ISBN", () => {
        expect(IsbnVerification.normalizeAndValidateIsbn("9780261102218")).toBeNull();
    });

    it("returns null for empty or missing input", () => {
        expect(IsbnVerification.normalizeAndValidateIsbn("")).toBeNull();
        // @ts-expect-error - exercising the `raw ?? ""` guard against non-string callers.
        expect(IsbnVerification.normalizeAndValidateIsbn(undefined)).toBeNull();
    });
});
