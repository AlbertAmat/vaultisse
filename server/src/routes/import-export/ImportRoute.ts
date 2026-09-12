/**
 * =============================================================================
 * ImportRoute
 * =============================================================================
 * Mounted at `/api/rest/import` (see server/src/routes/Routes.ts). Bulk-loads
 * books into the caller's catalog from a file exported by some other
 * service, instead of adding them one by one through `BooksRoute.ts`.
 *
 * Deliberately split out of `UserRoute.ts`/`BooksRoute.ts` into its own
 * folder (`routes/import-export/`) since "import" and "export" are one
 * feature with room to grow (more origins now, an export endpoint later),
 * not a couple of one-off endpoints belonging to an existing router.
 *
 * Every origin's file format is reduced to `IImportedBook[]` by its own
 * parser (see `parsers/`) before this file ever touches the database -
 * adding an origin means adding a parser and a line in `PARSERS` below, the
 * route logic itself doesn't change.
 */
import {Router, Request, Response, NextFunction, ErrorRequestHandler, RequestHandler} from 'express';
import multer from "multer";
import axios from "axios";
import {appService} from "../../AppService";
import {requireAuth} from "../../middlewares/AuthMiddleware";
import {handleUploadError} from "../../middlewares/UploadErrorMiddleware";
import {IImportedBook} from "./parsers/IImportedBook";
import {parseGoodreadsCsv} from "./parsers/GoodreadsCsvParser";
import {isAllowedImageUrl, generateBookStockCode} from "../BooksRoute";
import {parseVaultisseCsv, VAULTISSE_CSV_TEMPLATE} from "./parsers/VaultisseCsvParser";

const router = Router();

/**
 * Max size for a CSV import file - configurable via MAX_IMPORT_FILE_SIZE_MB,
 * see `AppService.getMaxImportFileSizeMb()` (also what `GET /app/policy`
 * reports, so the client can show/validate the real limit instead of
 * hardcoding a copy of it that can silently drift out of sync - see
 * `BookFile.vue`'s MAX_FILE_SIZE).
 *
 * Built lazily, on the first request, rather than at module load: this file
 * is required (via `Routes.ts`) from inside `AppService`'s own constructor
 * chain, before `export const appService = new AppService()` at the bottom
 * of `AppService.ts` has run - calling `appService.getMaxImportFileSizeMb()`
 * at the top level here would hit it while still `undefined`. By request
 * time the whole module graph (and `appService`) is long since ready.
 */
let uploadCsvMiddleware: RequestHandler | null = null;

function uploadCsv(req: Request, res: Response, next: NextFunction) {
    if (!uploadCsvMiddleware) {
        uploadCsvMiddleware = multer({
            storage: multer.memoryStorage(),
            limits: {fileSize: appService.getMaxImportFileSizeMb() * 1024 * 1024},
            fileFilter: (fileFilterReq: Request, file: Express.Multer.File, cb: (error: any, acceptFile: boolean) => void) => {
                if (!file.originalname.toLowerCase().endsWith(".csv")) {
                    return cb(new Error("Only CSV files are allowed"), false);
                }
                cb(null, true);
            }
        }).single("file");
    }
    uploadCsvMiddleware(req, res, next);
}

/** Same lazy-evaluation reasoning as `uploadCsv` above - read the limit at request time, not module load time. */
const handleImportUploadError: ErrorRequestHandler = (err, req, res, next) =>
    handleUploadError(appService.getMaxImportFileSizeMb(), "json")(err, req, res, next);

/**
 * Registry of supported `origin` values. Each parser turns a raw file's text
 * into the shared `IImportedBook[]` shape - add an entry here (and a parser
 * in `parsers/`) to support another source, e.g. a Vaultisse-to-Vaultisse
 * export once `POST /export/library` exists.
 */
const PARSERS: Record<string, (fileText: string) => IImportedBook[]> = {
    goodreads: parseGoodreadsCsv,
    vaultisse: parseVaultisseCsv,
};

/**
 * Downloadable starting-point CSVs for origins with no export of their own
 * to convert (see `GET /import/template/:origin` below) - someone building
 * their library by hand fills this in rather than guessing at column names.
 * An origin like "goodreads" has nothing here since it's exported directly
 * from Goodreads, never hand-authored.
 */
const TEMPLATES: Record<string, string> = {
    vaultisse: VAULTISSE_CSV_TEMPLATE,
};

interface IImportError {
    row: number;
    title?: string;
    reason: string;
}

// Capped so a file with thousands of bad rows doesn't blow up the response body.
const MAX_REPORTED_ERRORS = 50;

/**
 * GET /import/template/:origin
 * -------------------------------
 * Download a blank starting-point CSV for an origin with no export of its
 * own (currently just "vaultisse") - the header row this same origin's
 * parser expects, plus one filled-in example row to copy and replace.
 *
 * Auth: required. Path param `origin` {string}, e.g. "vaultisse".
 *
 * Example request: GET /api/rest/import/template/vaultisse
 *
 * Response (200): `text/csv`, `Content-Disposition: attachment`.
 * Response (404): {"error": "No template available for this origin"} -
 * e.g. "goodreads", which is exported directly from Goodreads, not hand-filled.
 */
router.get('/template/:origin', requireAuth, (req: Request, res: Response) => {
    const origin = String(req.params.origin ?? "").trim().toLowerCase();
    const template = TEMPLATES[origin];

    if (!template) {
        return res.status(404).json({error: "No template available for this origin"});
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="import-template-${origin}.csv"`);
    res.status(200).send(template);
});

/**
 * POST /import/library
 * -----------------------
 * Bulk-import books from another service's library export, or from a CSV
 * hand-filled from `GET /import/template/vaultisse`.
 *
 * Auth: required. Body: multipart/form-data
 *  - file   {file}   required - a CSV file, max size per `AppService.getMaxImportFileSizeMb()` (default 10MB).
 *  - origin {string} required - one of `Object.keys(PARSERS)`, e.g. "goodreads" or "vaultisse".
 *
 * Each row is inserted independently (its own transaction) - a bad row is
 * skipped and reported rather than failing the whole file. A row whose ISBN
 * (or, lacking one, title) already exists for this user is skipped as a
 * likely duplicate, so re-uploading the same export twice is harmless. If the
 * parser reports a `readingStatus` (Goodreads' "Exclusive Shelf", or the
 * Vaultisse template's "Reading Status" column), it's stored as `books.reading_status`
 * so the imported book lands directly on the matching Library nav filter. If
 * the parser reports `locations` (Goodreads' custom shelves - any shelf that
 * isn't the one "Exclusive Shelf" - e.g. a book on "office" - see
 * `GoodreadsCsvParser.ts`), one "available" stock is created per name at a
 * location found-or-created by that name, same as `categoryName`.
 *
 * Example request (curl):
 *   curl -X POST /api/rest/import/library -F "origin=goodreads" -F "file=@goodreads_library_export.csv"
 *
 * Example response (200):
 *  { "imported": 41, "skipped": 3, "failed": 1,
 *    "errors": [{"row": 12, "title": "Some Book", "reason": "..."}] }
 *
 * Responses: 400 {"error": "No CSV file provided"} |
 *            400 {"error": "Missing import origin"} |
 *            400 {"error": "Unsupported import origin: <origin>"} |
 *            400 {"error": "Invalid CSV file: <message>"}.
 */
router.post('/library', requireAuth, uploadCsv, handleImportUploadError, async (req: Request, res: Response) => {
    if (!req.file) {
        return res.status(400).json({error: "No CSV file provided"});
    }

    const origin = String(req.body.origin ?? "").trim().toLowerCase();
    if (!origin) {
        return res.status(400).json({error: "Missing import origin"});
    }

    const parseFile = PARSERS[origin];
    if (!parseFile) {
        return res.status(400).json({error: `Unsupported import origin: ${origin}`});
    }

    let books: IImportedBook[];
    try {
        books = parseFile(req.file.buffer.toString("utf-8"));
    } catch (err: any) {
        appService.getLogger().debug(`Failed to parse ${origin} import file: ${err.message}`);
        return res.status(400).json({error: `Invalid CSV file: ${err.message}`});
    }

    const userId = appService.getSessionUser(req);
    const pool = appService.getDatabasePool();
    const client = await pool.connect();

    let imported = 0;
    let skipped = 0;
    const errors: IImportError[] = [];

    try {
        for (const book of books) {
            if (!book.name) {
                errors.push({row: book.row, reason: "Missing title"});
                continue;
            }

            try {
                await client.query("BEGIN");

                const isDuplicate = book.isbn
                    ? await __existsByIsbn(client, book.isbn, userId)
                    : await __existsByName(client, book.name, userId);

                if (isDuplicate) {
                    await client.query("ROLLBACK");
                    skipped++;
                    continue;
                }

                const formatId = await __findFormatId(client, book.formatName);
                const categoryId = await __ensureCategory(client, book.categoryName ?? null, userId);
                await __ensureLanguage(client, book.languageCode ?? null);

                // A CSV-supplied cover (Vaultisse origin only, checked against the
                // same allowlist as every other write to books.image_url) wins;
                // otherwise, if there's an ISBN, best-effort fetch one from Open
                // Library's free covers API, the same source `BooksRoute.ts`'s ISBN
                // auto-create flow falls back to (see `fetchOpenLibraryCover` there).
                const explicitImageUrl = book.imageUrl && isAllowedImageUrl(book.imageUrl) ? book.imageUrl : null;
                const imageUrl = explicitImageUrl ?? (book.isbn ? await __fetchOpenLibraryCover(book.isbn) : null);

                const insertBook = await client.query(
                    `INSERT INTO books (name, description, image_url, isbn, category_id, format_id, publisher, published_date, language_code, pages, reading_status, user_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                     RETURNING id`,
                    [
                        truncate(book.name, 255),
                        book.description ?? null,
                        imageUrl,
                        book.isbn,
                        categoryId,
                        formatId,
                        truncate(book.publisher, 100),
                        book.publishedDate,
                        book.languageCode ?? null,
                        book.pages,
                        book.readingStatus ?? null,
                        userId
                    ]
                );
                const bookId = insertBook.rows[0].id;

                await __ensureAuthors(client, bookId, book.authors, userId);

                for (const locationName of book.locations ?? []) {
                    await __addStockAtLocation(client, bookId, locationName, userId);
                }

                await client.query("COMMIT");
                imported++;
            } catch (err: any) {
                await client.query("ROLLBACK");
                errors.push({row: book.row, title: book.name, reason: err.message ?? "Unknown error"});
            }
        }

        res.status(200).json({
            imported,
            skipped,
            failed: errors.length,
            errors: errors.slice(0, MAX_REPORTED_ERRORS)
        });
    } finally {
        client.release();
    }
});

/** Truncates a string to fit a VARCHAR(maxLen) column instead of letting Postgres reject the whole insert. */
function truncate(value: string | null, maxLen: number): string | null {
    if (value === null) return null;
    return value.length > maxLen ? value.substring(0, maxLen) : value;
}

/** A book with this ISBN already exists for this user (`books_isbn_user_unique`). */
async function __existsByIsbn(client: any, isbn: string, userId: number): Promise<boolean> {
    const result = await client.query(
        "SELECT 1 FROM books WHERE isbn = $1 AND user_id = $2",
        [isbn, userId]
    );
    return result.rowCount > 0;
}

/**
 * Without an ISBN there's no unique key to rely on, so fall back to an
 * exact (case-insensitive) title match among the user's other ISBN-less
 * books - good enough to make re-uploading the same export a no-op without
 * risking a false-positive skip against an unrelated book that happens to
 * share a title.
 */
async function __existsByName(client: any, name: string, userId: number): Promise<boolean> {
    const result = await client.query(
        "SELECT 1 FROM books WHERE LOWER(name) = LOWER($1) AND isbn IS NULL AND user_id = $2",
        [name, userId]
    );
    return result.rowCount > 0;
}

/**
 * Best-effort cover lookup by ISBN via Open Library's free covers API - no
 * API key needed, unlike Google Books. Mirrors `fetchOpenLibraryCover` in
 * `BooksRoute.ts`; kept as its own small copy here rather than importing
 * from that file, same reasoning as `__ensureAuthors` etc. below. `null` on
 * any failure (no cover, timeout, non-image response) rather than throwing -
 * a missing cover shouldn't fail the whole row.
 */
async function __fetchOpenLibraryCover(isbn: string): Promise<string | null> {
    try {
        const url = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg`;

        const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 3000,
        });

        const contentType = String(res.headers["content-type"] ?? "");
        return res.status === 200 && contentType.startsWith("image/") ? url : null;
    } catch {
        return null;
    }
}

/** `formats` is a small, fixed, global (not user-scoped) table - matched, never created, from an import. */
async function __findFormatId(client: any, formatName: string | null): Promise<number | null> {
    if (!formatName) return null;

    const result = await client.query(
        "SELECT id FROM formats WHERE LOWER(name) = LOWER($1)",
        [formatName]
    );
    return result.rowCount > 0 ? result.rows[0].id : null;
}

/** Find-or-create a category by name for this user. `null` if `name` is falsy - imported without a category rather than guessing one. */
async function __ensureCategory(client: any, name: string | null, userId: number): Promise<number | null> {
    if (!name) return null;

    const truncated = truncate(name, 100) as string;

    const existing = await client.query(
        "SELECT id FROM categories WHERE name = $1 AND user_id = $2",
        [truncated, userId]
    );
    if (existing.rowCount > 0) return existing.rows[0].id;

    const insert = await client.query(
        "INSERT INTO categories (name, user_id) VALUES ($1, $2) RETURNING id",
        [truncated, userId]
    );
    return insert.rows[0].id;
}

/** Find-or-create a location by name for this user - same pattern as `__ensureCategory`, just never `null` since a location name only ever reaches here from `book.locations` (already filtered to real names). */
async function __ensureLocation(client: any, name: string, userId: number): Promise<number> {
    const truncated = truncate(name, 100) as string;

    const existing = await client.query(
        "SELECT id FROM locations WHERE name = $1 AND user_id = $2",
        [truncated, userId]
    );
    if (existing.rowCount > 0) return existing.rows[0].id;

    const insert = await client.query(
        "INSERT INTO locations (name, user_id) VALUES ($1, $2) RETURNING id",
        [truncated, userId]
    );
    return insert.rows[0].id;
}

/** Create one "available" (status 0) stock for `bookId` at a location found-or-created by `locationName` - one call per entry in `IImportedBook.locations`. */
async function __addStockAtLocation(client: any, bookId: number, locationName: string, userId: number): Promise<void> {
    const locationId = await __ensureLocation(client, locationName, userId);
    const code = await generateBookStockCode();

    await client.query(
        "INSERT INTO book_stocks (book_id, code, status, location_id, user_id) VALUES ($1, $2, $3, $4, $5)",
        [bookId, code, 0, locationId, userId]
    );
}

/** Insert a `languages` row for `code` if one doesn't exist yet (name defaults to the code itself, e.g. "en"). No-op if `code` is null. */
async function __ensureLanguage(client: any, code: string | null): Promise<void> {
    if (!code) return;

    const existing = await client.query("SELECT code FROM languages WHERE code = $1", [code]);
    if (existing.rowCount === 0) {
        await client.query("INSERT INTO languages (code, name) VALUES ($1, $2)", [code, code]);
    }
}

/** Find-or-create each author by name for this user, then link them all to `bookId` in `book_authors`. */
async function __ensureAuthors(client: any, bookId: number, authors: string[], userId: number) {
    for (const name of authors) {
        const truncated = name.length > 100 ? name.substring(0, 100) : name;

        const existing = await client.query(
            "SELECT id FROM authors WHERE name = $1 AND user_id = $2",
            [truncated, userId]
        );

        const authorId = existing.rowCount > 0
            ? existing.rows[0].id
            : (await client.query(
                "INSERT INTO authors (name, user_id) VALUES ($1, $2) RETURNING id",
                [truncated, userId]
            )).rows[0].id;

        await client.query(
            "INSERT INTO book_authors (book_id, author_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            [bookId, authorId, userId]
        );
    }
}

export default router;
