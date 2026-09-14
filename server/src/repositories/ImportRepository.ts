import {Pool, PoolClient} from "pg";
import {BookRepository} from "./BookRepository";

/** A book with this ISBN already exists for this user (`books_isbn_user_unique`). */
export async function existsByIsbn(db: Pool | PoolClient, isbn: string, userId: number): Promise<boolean> {
    const result = await db.query("SELECT 1 FROM books WHERE isbn = $1 AND user_id = $2", [isbn, userId]);
    return (result.rowCount ?? 0) > 0;
}

/**
 * Without an ISBN there's no unique key to rely on, so fall back to an
 * exact (case-insensitive) title match among the user's other ISBN-less
 * books - good enough to make re-uploading the same export a no-op without
 * risking a false-positive skip against an unrelated book that happens to
 * share a title.
 */
export async function existsByName(db: Pool | PoolClient, name: string, userId: number): Promise<boolean> {
    const result = await db.query(
        "SELECT 1 FROM books WHERE LOWER(name) = LOWER($1) AND isbn IS NULL AND user_id = $2",
        [name, userId]
    );
    return (result.rowCount ?? 0) > 0;
}

/** `formats` is a small, fixed, global (not user-scoped) table - matched, never created, from an import. */
export async function findFormatId(db: Pool | PoolClient, formatName: string | null): Promise<number | null> {
    if (!formatName) {
        return null;
    }
    const result = await db.query("SELECT id FROM formats WHERE LOWER(name) = LOWER($1)", [formatName]);
    return (result.rowCount ?? 0) > 0 ? result.rows[0].id : null;
}

/** Find-or-create a category by name for this user. `null` if `name` is falsy - imported without a category rather than guessing one. */
export async function ensureCategory(db: Pool | PoolClient, name: string | null, userId: number): Promise<number | null> {
    if (!name) {
        return null;
    }
    const repo = new BookRepository(db);
    const existing = await repo.findCategoryByName(name, userId);
    if (existing !== null) {
        return existing;
    }
    return repo.insertCategory(name, userId);
}

/** Find-or-create a location by name for this user. */
async function ensureLocation(db: Pool | PoolClient, name: string, userId: number): Promise<number> {
    const existing = await db.query("SELECT id FROM locations WHERE name = $1 AND user_id = $2", [name, userId]);
    if ((existing.rowCount ?? 0) > 0) {
        return existing.rows[0].id;
    }
    const insert = await db.query("INSERT INTO locations (name, user_id) VALUES ($1, $2) RETURNING id", [name, userId]);
    return insert.rows[0].id;
}

/** Create one "available" (status 0) stock for `bookId` at a location found-or-created by `locationName` - one call per entry in `IImportedBook.locations`. */
export async function addStockAtLocation(db: Pool | PoolClient, bookId: number, locationName: string, userId: number): Promise<void> {
    const locationId = await ensureLocation(db, locationName, userId);
    const code = await new BookRepository(db).generateStockCode();
    await db.query(
        "INSERT INTO book_stocks (book_id, code, status, location_id, user_id) VALUES ($1, $2, $3, $4, $5)",
        [bookId, code, 0, locationId, userId]
    );
}

/** Find-or-create each author by name (truncated to fit `authors.name`) for this user, then link them all to `bookId` in `book_authors`. */
export async function ensureAuthors(db: Pool | PoolClient, bookId: number, authors: string[], userId: number): Promise<void> {
    const repo = new BookRepository(db);
    for (const name of authors) {
        const truncated = name.length > 100 ? name.substring(0, 100) : name;
        const existingId = await repo.findAuthorByName(truncated, userId);
        const authorId = existingId ?? await repo.insertAuthorRow(truncated, userId);
        await repo.linkAuthorToBook(bookId, authorId, userId);
    }
}

export interface InsertImportedBookFields {
    name: string;
    description: string | null;
    imageUrl: string | null;
    isbn: string | null;
    categoryId: number | null;
    formatId: number | null;
    publisher: string | null;
    publishedDate: string | null;
    languageCode: string | null;
    pages: number | null;
    readingStatus: number | null;
}

export async function insertBook(db: Pool | PoolClient, userId: number, fields: InsertImportedBookFields): Promise<number> {
    const result = await db.query(
        `INSERT INTO books (name, description, image_url, isbn, category_id, format_id, publisher, published_date, language_code, pages, reading_status, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
            fields.name,
            fields.description,
            fields.imageUrl,
            fields.isbn,
            fields.categoryId,
            fields.formatId,
            fields.publisher,
            fields.publishedDate,
            fields.languageCode,
            fields.pages,
            fields.readingStatus,
            userId,
        ]
    );
    return result.rows[0].id;
}
