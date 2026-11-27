/**
 * Checks an API key against its provider by making one small real request with it, so the admin
 * finds out right away whether a key works instead of when a user adds a book.
 */
import axios from "axios";

export interface ApiKeyTestResult {
    ok: boolean;
    message: string;
}

/** A book that both services know, with a cover. */
const SAMPLE_ISBN = "9780547928227";
/** Smaller than this, LibraryThing's answer is its "no cover" placeholder (same threshold the app uses). */
const PLACEHOLDER_MAX_BYTES = 1500;
const TIMEOUT_MS = 8000;

/** Provider checks for the keys that can be tested. */
export class ApiKeyTester {
    /** Static-only utility class, never instantiated. */
    private constructor() {
    }

    /**
     * @param key Setting key, e.g. `GOOGLE_BOOKS_API_KEY`.
     * @returns Whether the key can be tested.
     */
    public static supports(key: string): boolean {
        return key === "GOOGLE_BOOKS_API_KEY" || key === "LIBRARYTHING_API_KEY";
    }

    /**
     * @param key Setting key of the API key.
     * @param value The key to try.
     * @returns Whether it works, and a message the admin can act on.
     */
    public static async test(key: string, value: string): Promise<ApiKeyTestResult> {
        try {
            return key === "GOOGLE_BOOKS_API_KEY" ? await ApiKeyTester.google(value) : await ApiKeyTester.libraryThing(value);
        } catch (error) {
            const code = (error as {code?: string}).code;
            if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
                return {ok: false, message: "The service didn't answer in time. Try again."};
            }
            return {ok: false, message: `Couldn't reach the service from this server (${error instanceof Error ? error.message : String(error)}). Check the server's internet access.`};
        }
    }

    private static async google(value: string): Promise<ApiKeyTestResult> {
        const res = await axios.get("https://www.googleapis.com/books/v1/volumes", {
            params: {q: `isbn:${SAMPLE_ISBN}`, maxResults: 1, key: value},
            timeout: TIMEOUT_MS,
            validateStatus: () => true,
        });
        if (res.status === 200) {
            return {ok: true, message: "Google Books accepted the key and returned a result."};
        }
        const reason = res.data?.error?.message ? String(res.data.error.message).replace(/\s+/g, " ").slice(0, 200) : `HTTP ${res.status}`;
        if (res.status === 429) {
            return {ok: false, message: `The key is valid but its quota is used up: ${reason}`};
        }
        if (res.status === 400 || res.status === 403) {
            return {ok: false, message: `Google rejected the key: ${reason}`};
        }
        return {ok: false, message: `Google Books answered with an error: ${reason}`};
    }

    private static async libraryThing(value: string): Promise<ApiKeyTestResult> {
        const res = await axios.get(`https://covers.librarything.com/devkey/${encodeURIComponent(value)}/large/isbn/${SAMPLE_ISBN}`, {
            responseType: "arraybuffer",
            timeout: TIMEOUT_MS,
            validateStatus: () => true,
        });
        const type = String(res.headers["content-type"] ?? "");
        const size = Buffer.byteLength(res.data ?? "");
        if (res.status === 200 && type.startsWith("image/") && size > PLACEHOLDER_MAX_BYTES) {
            return {ok: true, message: "LibraryThing accepted the key and returned a cover."};
        }
        if (res.status === 200 && type.startsWith("image/")) {
            return {ok: false, message: "LibraryThing answered with only its placeholder image. The key is probably not valid (it returns the same image for unknown keys). Check it at librarything.com/services/keys.php."};
        }
        if (res.status === 401 || res.status === 403) {
            return {ok: false, message: "LibraryThing rejected the key."};
        }
        return {ok: false, message: `LibraryThing answered with HTTP ${res.status}.`};
    }
}
