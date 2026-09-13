/**
 * Post-import metadata fill. CSV import must return before nginx's
 * proxy_read_timeout; this walks the new rows afterwards and fills empty
 * cover / description / publisher / date / language / pages / category
 * from Open Library (and Google / Wikipedia when those helpers would).
 */
import {Pool} from "pg";
import {
    fetchBookMetadata,
    normalizeLanguageCode,
    resolveBookCover,
} from "./BookMetadata";

const ENRICH_CONCURRENCY = 3;

interface BookRow {
    id: number;
    name: string;
    isbn: string | null;
    description: string | null;
    image_url: string | null;
    publisher: string | null;
    published_date: Date | string | null;
    language_code: string | null;
    pages: number | null;
    category_id: number | null;
}

export function scheduleImportedBookEnrichment(
    pool: Pool,
    userId: number,
    bookIds: number[],
    googleApiKey?: string
): void {
    if (bookIds.length === 0) {
        return;
    }
    setImmediate(() => {
        enrichImportedBooks(pool, userId, bookIds, googleApiKey).catch((err) => {
            console.error("Import enrichment failed:", err);
        });
    });
}

export async function enrichImportedBooks(
    pool: Pool,
    userId: number,
    bookIds: number[],
    googleApiKey?: string
): Promise<void> {
    for (let i = 0; i < bookIds.length; i += ENRICH_CONCURRENCY) {
        const batch = bookIds.slice(i, i + ENRICH_CONCURRENCY);
        await Promise.all(batch.map((id) => enrichOneBook(pool, userId, id, googleApiKey)));
    }
}

async function enrichOneBook(
    pool: Pool,
    userId: number,
    bookId: number,
    googleApiKey?: string
): Promise<void> {
    const result = await pool.query(
        `SELECT id, name, isbn, description, image_url, publisher, published_date,
                language_code, pages, category_id
           FROM books
          WHERE id = $1 AND user_id = $2`,
        [bookId, userId]
    );
    if (result.rowCount !== 1) {
        return;
    }

    const book: BookRow = result.rows[0];
    if (!needsEnrichment(book)) {
        return;
    }

    const authors = await loadAuthorNames(pool, bookId, userId);
    let description: string | null = null;
    let imageUrl: string | null = null;
    let publisher: string | null = null;
    let publishedDate: string | null = null;
    let language: string | null = null;
    let pages: number | null = null;
    let categoryName: string | null = null;

    if (book.isbn) {
        const meta = await fetchBookMetadata(book.isbn, googleApiKey);
        if (meta) {
            description = meta.description ?? null;
            imageUrl = meta.imageLinks?.thumbnail ?? null;
            publisher = meta.publisher ?? null;
            publishedDate = formatPublishedDate(meta.publishedDate);
            language = normalizeLanguageCode(meta.language);
            pages = meta.pageCount && meta.pageCount > 0 ? meta.pageCount : null;
            categoryName = meta.categories?.[0] ?? null;
        }
    }

    if (!imageUrl && !book.image_url) {
        imageUrl = await resolveBookCover({
            isbn: book.isbn,
            title: book.name,
            authors,
        });
    }

    if (language) {
        await ensureLanguage(pool, language);
    }
    const categoryId = book.category_id ?? await ensureCategory(pool, categoryName, userId);

    await pool.query(
        `UPDATE books SET
            description = COALESCE(NULLIF(BTRIM(description), ''), $1),
            image_url = COALESCE(image_url, $2),
            category_id = COALESCE(category_id, $3),
            publisher = COALESCE(publisher, $4),
            published_date = COALESCE(published_date, $5::date),
            language_code = COALESCE(language_code, $6),
            pages = CASE
                WHEN pages IS NULL OR pages = 0 THEN COALESCE($7, pages)
                ELSE pages
            END
         WHERE id = $8 AND user_id = $9`,
        [
            description,
            imageUrl,
            categoryId,
            publisher ? publisher.slice(0, 100) : null,
            publishedDate,
            language,
            pages,
            bookId,
            userId,
        ]
    );
}

function needsEnrichment(book: BookRow): boolean {
    return !book.image_url
        || !book.description
        || !book.publisher
        || !book.published_date
        || !book.language_code
        || !book.pages
        || !book.category_id;
}

async function loadAuthorNames(pool: Pool, bookId: number, userId: number): Promise<string[]> {
    const result = await pool.query(
        `SELECT a.name
           FROM book_authors ba
           JOIN authors a ON a.id = ba.author_id
          WHERE ba.book_id = $1 AND ba.user_id = $2
          ORDER BY a.name`,
        [bookId, userId]
    );
    return result.rows.map((row: {name: string}) => row.name);
}

async function ensureLanguage(pool: Pool, code: string): Promise<void> {
    const existing = await pool.query("SELECT 1 FROM languages WHERE code = $1", [code]);
    if ((existing.rowCount ?? 0) === 0) {
        await pool.query("INSERT INTO languages (code, name) VALUES ($1, $2)", [code, code]);
    }
}

async function ensureCategory(pool: Pool, name: string | null, userId: number): Promise<number | null> {
    if (!name) {
        return null;
    }
    const truncated = name.slice(0, 100);
    const existing = await pool.query(
        "SELECT id FROM categories WHERE name = $1 AND user_id = $2",
        [truncated, userId]
    );
    if ((existing.rowCount ?? 0) > 0) {
        return existing.rows[0].id;
    }
    const inserted = await pool.query(
        "INSERT INTO categories (name, user_id) VALUES ($1, $2) RETURNING id",
        [truncated, userId]
    );
    return inserted.rows[0].id;
}

function formatPublishedDate(date: string | undefined): string | null {
    if (!date) {
        return null;
    }
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toISOString().split("T")[0];
}
