import {Pool, PoolClient} from "pg";
import {BookRepository} from "./BookRepository";

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

/** Data access for the CSV-import flow: duplicate checks, find-or-create category/location/author helpers, and the row insert. See ImportService for the orchestration built on top of this. */
export class ImportRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * A book with this ISBN already exists for this vault (`books_isbn_vault_unique`).
     * @param isbn ISBN to check.
     * @param vaultId Vault id.
     * @returns Whether a matching book exists.
     */
    public async existsByIsbn(isbn: string, vaultId: number): Promise<boolean> {
        const result = await this.db.query("SELECT 1 FROM books WHERE isbn = $1 AND vault_id = $2", [isbn, vaultId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Without an ISBN there's no unique key to rely on, so fall back to an
     * exact (case-insensitive) title match among the vault's other ISBN-less
     * books - good enough to make re-uploading the same export a no-op without
     * risking a false-positive skip against an unrelated book that happens to
     * share a title.
     *
     * @param name Book title.
     * @param vaultId Vault id.
     * @returns Whether a matching ISBN-less book exists.
     */
    public async existsByName(name: string, vaultId: number): Promise<boolean> {
        const result = await this.db.query(
            "SELECT 1 FROM books WHERE LOWER(name) = LOWER($1) AND isbn IS NULL AND vault_id = $2",
            [name, vaultId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * `formats` is a small, fixed, global (not vault-scoped) table - matched, never created, from an import.
     * @param formatName Format name to look up, or null to no-op.
     * @returns The format id, or null.
     */
    public async findFormatId(formatName: string | null): Promise<number | null> {
        if (!formatName) {
            return null;
        }
        const result = await this.db.query("SELECT id FROM formats WHERE LOWER(name) = LOWER($1)", [formatName]);
        return (result.rowCount ?? 0) > 0 ? result.rows[0].id : null;
    }

    /**
     * Find-or-create a category by name for this vault. `null` if `name` is falsy - imported without a category rather than guessing one.
     * @param name Category name, or null.
     * @param vaultId Vault id.
     * @returns The category id, or null.
     */
    public async ensureCategory(name: string | null, vaultId: number): Promise<number | null> {
        if (!name) {
            return null;
        }
        const repo = new BookRepository(this.db);
        const existing = await repo.findCategoryByName(name, vaultId);
        if (existing !== null) {
            return existing;
        }
        return repo.insertCategory(name, vaultId);
    }

    /**
     * Find-or-create a location by name for this vault.
     * @param name Location name.
     * @param vaultId Vault id.
     * @returns The location id.
     */
    private async ensureLocation(name: string, vaultId: number): Promise<number> {
        const existing = await this.db.query("SELECT id FROM locations WHERE name = $1 AND vault_id = $2", [name, vaultId]);
        if ((existing.rowCount ?? 0) > 0) {
            return existing.rows[0].id;
        }
        const insert = await this.db.query("INSERT INTO locations (name, vault_id) VALUES ($1, $2) RETURNING id", [name, vaultId]);
        return insert.rows[0].id;
    }

    /**
     * Create one "available" (status 0) stock for `bookId` at a location found-or-created by `locationName` - one call per entry in `IImportedBook.locations`.
     * @param bookId Book id.
     * @param locationName Location name to find-or-create.
     * @param vaultId Vault id.
     */
    public async addStockAtLocation(bookId: number, locationName: string, vaultId: number): Promise<void> {
        const locationId = await this.ensureLocation(locationName, vaultId);
        const code = await new BookRepository(this.db).generateStockCode();
        await this.db.query(
            "INSERT INTO book_stocks (book_id, code, status, location_id, vault_id) VALUES ($1, $2, $3, $4, $5)",
            [bookId, code, 0, locationId, vaultId]
        );
    }

    /**
     * Find-or-create each author by name (truncated to fit `authors.name`) for this vault, then link them all to `bookId` in `book_authors`.
     * @param bookId Book id.
     * @param authors Author names.
     * @param vaultId Vault id.
     */
    public async ensureAuthors(bookId: number, authors: string[], vaultId: number): Promise<void> {
        const repo = new BookRepository(this.db);
        for (const name of authors) {
            const truncated = name.length > 100 ? name.substring(0, 100) : name;
            const existingId = await repo.findAuthorByName(truncated, vaultId);
            const authorId = existingId ?? await repo.insertAuthorRow(truncated, vaultId);
            await repo.linkAuthorToBook(bookId, authorId, vaultId);
        }
    }

    /**
     * Inserts one imported book row.
     * @param vaultId Vault id.
     * @param fields Imported book fields.
     * @returns The new row's id.
     */
    public async insertBook(vaultId: number, fields: InsertImportedBookFields): Promise<number> {
        const result = await this.db.query(
            `INSERT INTO books (name, description, image_url, isbn, category_id, format_id, publisher, published_date, language_code, pages, reading_status, vault_id)
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
                vaultId,
            ]
        );
        return result.rows[0].id;
    }
}
