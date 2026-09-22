import {Pool, PoolClient} from "pg";
import {v4 as uuidv4} from "uuid";
import {ReadingStatusEnum} from "../types/book/IReadingStatus";
import {SearchFilter} from "../types/search/SearchFilter";
import {SortType} from "../types/search/SortType";
import {
    BookCounters,
    BookDetail,
    BookEnrichmentRow,
    BookFileForDownload,
    BookFileMeta,
    BookSearchFilter,
    BookSearchResult,
    BookStockDetail,
    IsbnBookInput,
    UpdateBookFields,
} from "../types/book";

/** Data access for `books`, `book_stocks`, `book_authors` and `book_files`. See BookService for the business rules built on top of this. */
export class BookRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /* ---------- Search / counters ---------- */

    /**
     * Paginated/filterable/sortable book search, each row carrying its author list.
     * @param userId Owning user's id.
     * @param filter Search query, category/status filters, date range, sort and page.
     * @returns The total matching row count (across all pages) and this page's books.
     */
    public async search(userId: number, filter: BookSearchFilter): Promise<{total: number; books: BookSearchResult[]}> {
        const MAX_ROWS = 50;
        const skip = MAX_ROWS * filter.page;

        const params: any[] = [userId];
        const conditions: string[] = [`books.user_id = $1`];

        let sqlStatement = `
            SELECT books.id,
                   books.name,
                   books.image_url,
                   books.isbn,
                   books.category_id,
                   books.language_code,
                   books.reading_status,
                   COALESCE(
                           json_agg(
                                   json_build_object(
                                           'id', authors.id,
                                           'name', authors.name
                                   )
                           ) FILTER(WHERE authors.id IS NOT NULL),
                           '[]'
                   ) AS authors
            FROM books
                     LEFT JOIN book_authors ON books.id = book_authors.book_id
                     LEFT JOIN authors ON book_authors.author_id = authors.id
        `;

        if (filter.query) {
            // Parenthesized: without it, `AND` binds tighter than `OR` and this
            // clause escapes the `books.user_id = $1` condition above, leaking
            // every user's books whose ISBN happens to match (security audit #1).
            conditions.push(`(LOWER(books.name) ILIKE $${params.push(`%${filter.query.toLocaleLowerCase()}%`)} OR LOWER(books.isbn) ILIKE $${params.push(`%${filter.query.toLocaleLowerCase()}%`)})`);
        }

        if (filter.categoryId && filter.categoryId.length > 0) {
            conditions.push(`category_id = ANY($${params.length + 1})`);
            params.push(filter.categoryId);
        }

        for (const rawFilter of filter.filters) {
            switch (rawFilter) {
                case SearchFilter.NO_STOCK: {
                    conditions.push(`books.id NOT IN (SELECT book_id FROM book_stocks WHERE user_id = $${params.length + 1})`);
                    params.push(userId);
                    break;
                }
                case SearchFilter.HAS_STOCK: {
                    conditions.push(`books.id IN (SELECT book_id FROM book_stocks WHERE user_id = $${params.length + 1})`);
                    params.push(userId);
                    break;
                }
                case SearchFilter.ON_LOAN: {
                    conditions.push(`books.id IN (SELECT book_id FROM book_stocks WHERE user_id = $${params.length + 1} AND status = 2)`);
                    params.push(userId);
                    break;
                }
                case SearchFilter.RECENT: {
                    conditions.push(`books.date_created >= NOW() - INTERVAL '30 days'`);
                    break;
                }
                case SearchFilter.WANT_TO_READ: {
                    conditions.push(`books.reading_status = ${ReadingStatusEnum.WANT_TO_READ}`);
                    break;
                }
                case SearchFilter.CURRENTLY_READING: {
                    conditions.push(`books.reading_status = ${ReadingStatusEnum.CURRENTLY_READING}`);
                    break;
                }
            }
        }

        if (filter.dateFrom) {
            conditions.push(`books.date_created >= $${params.push(filter.dateFrom)}`);
        }
        if (filter.dateTo) {
            conditions.push(`books.date_created < $${params.push(filter.dateTo)}::date + INTERVAL '1 day'`);
        }

        if (conditions.length > 0) {
            sqlStatement += ` WHERE ${conditions.join(' AND ')}`;
        }

        let totalQuery = "SELECT COUNT(*) FROM books";
        if (conditions.length > 0) {
            totalQuery += ` WHERE ${conditions.join(' AND ')}`;
        }
        const totalResults = await this.db.query(totalQuery, params);

        const ORDER_BY_CLAUSES: Record<SortType, string> = {
            [SortType.NAME_ASC]: "books.name ASC",
            [SortType.NAME_DESC]: "books.name DESC",
            [SortType.DATE_NEWEST]: "books.date_created DESC",
            [SortType.DATE_OLDEST]: "books.date_created ASC"
        };

        sqlStatement += `
            GROUP BY
                books.id,
                books.name,
                books.image_url,
                books.isbn,
                books.category_id,
                books.language_code,
                books.reading_status,
                books.date_created
            ORDER BY ${ORDER_BY_CLAUSES[filter.sort as SortType]}
            LIMIT ${MAX_ROWS} OFFSET ${skip};
        `;

        const result = await this.db.query(sqlStatement, params);

        return {
            total: totalResults.rows[0] ? Number(totalResults.rows[0].count) : -1,
            books: result.rows,
        };
    }

    /**
     * KPI counters for the Books view (total, recent, on loan, no stock, want-to-read, currently-reading).
     * @param userId Owning user's id.
     * @returns Every counter.
     */
    public async getCounters(userId: number): Promise<BookCounters> {
        const [total, recent, onLoan, noStock, wantToRead, currentlyReading] = await Promise.all([
            this.db.query(`SELECT COUNT(*) FROM books WHERE user_id = $1`, [userId]),
            this.db.query(`SELECT COUNT(*) FROM books WHERE user_id = $1 AND date_created >= NOW() - INTERVAL '30 days'`, [userId]),
            this.db.query(`SELECT COUNT(*) FROM books WHERE user_id = $1 AND id IN (SELECT book_id FROM book_stocks WHERE user_id = $1 AND status = 2)`, [userId]),
            this.db.query(`SELECT COUNT(*) FROM books WHERE user_id = $1 AND id NOT IN (SELECT book_id FROM book_stocks WHERE user_id = $1)`, [userId]),
            this.db.query(`SELECT COUNT(*) FROM books WHERE user_id = $1 AND reading_status = $2`, [userId, ReadingStatusEnum.WANT_TO_READ]),
            this.db.query(`SELECT COUNT(*) FROM books WHERE user_id = $1 AND reading_status = $2`, [userId, ReadingStatusEnum.CURRENTLY_READING]),
        ]);

        return {
            total: Number(total.rows[0].count),
            recent: Number(recent.rows[0].count),
            onLoan: Number(onLoan.rows[0].count),
            noStock: Number(noStock.rows[0].count),
            wantToRead: Number(wantToRead.rows[0].count),
            currentlyReading: Number(currentlyReading.rows[0].count),
        };
    }

    /* ---------- Single book CRUD ---------- */

    /**
     * Full detail for one book: fields, files, stocks (with location/customer), and authors.
     * @param id Book id.
     * @param userId Owning user's id.
     * @returns The book detail, or null if it doesn't exist or belongs to someone else.
     */
    public async findDetailById(id: number, userId: number): Promise<BookDetail | null> {
        const result = await this.db.query(`
            SELECT books.id,
                   books.name,
                   books.description,
                   books.image_url,
                   books.isbn,
                   books.category_id,
                   books.language_code,
                   books.publisher,
                   books.published_date,
                   books.date_created,
                   books.date_updated,
                   books.pages,
                   books.format_id,
                   books.reading_status,
                   COALESCE(
                           json_agg(
                               DISTINCT jsonb_build_object(
                   'id', book_files.id,
                   'file_type', book_files.file_type,
                   'file_name', book_files.file_name,
                   'file_size', book_files.file_size,
                   'date_created', book_files.date_created
               )
           ) FILTER(WHERE book_files.id IS NOT NULL), '[]'
                   )                                                                    AS files,
                   COALESCE(
                           json_agg(
                               DISTINCT jsonb_build_object(
                   'id', book_stocks.id,
                   'code', book_stocks.code,
                   'status', book_stocks.status,
                   'location_id', locations.id,  -- Using correct column from locations table
                   'location_name', locations.name,
                   'customer_id', customers.id,
                   'customer_name', customers.name
               )
           ) FILTER(WHERE book_stocks.id IS NOT NULL), '[]'
                   )                                                                    AS stocks,
                   COALESCE(
                           json_agg(
                               DISTINCT jsonb_build_object(
                   'id', authors.id,
                   'name', authors.name
               )
           ) FILTER(WHERE authors.id IS NOT NULL), '[]') AS authors
            FROM books
                     -- Defense in depth (security audit #2): the outer WHERE
                     -- already scopes books to the caller, but scoping these
                     -- joins too means a stray cross-user book_stocks/locations
                     -- row can never surface here even if some other bug lets
                     -- one get created.
                     LEFT JOIN book_stocks ON books.id = book_stocks.book_id AND book_stocks.user_id = $2
                     LEFT JOIN locations ON book_stocks.location_id = locations.id AND locations.user_id = $2
                     LEFT JOIN customers ON book_stocks.customer_id = customers.id AND customers.user_id = $2
                     LEFT JOIN book_authors ON books.id = book_authors.book_id
                     LEFT JOIN authors ON book_authors.author_id = authors.id
                     LEFT JOIN book_files ON books.id = book_files.book_id AND book_files.user_id = $2
            WHERE books.id = $1
              AND books.user_id = $2
            GROUP BY books.id,
                     books.name,
                     books.description,
                     books.image_url,
                     books.isbn,
                     books.category_id,
                     books.language_code,
                     books.publisher,
                     books.published_date,
                     books.date_created,
                     books.date_updated,
                     books.pages,
                     books.format_id,
                     books.reading_status;
        `, [id, userId]);

        if (result.rows.length !== 1) {
            return null;
        }
        return result.rows[0];
    }

    /**
     * Checks whether a book exists and belongs to `userId`.
     * @param id Book id.
     * @param userId Owning user's id.
     * @returns Whether a matching book exists.
     */
    public async exists(id: number, userId: number): Promise<boolean> {
        const result = await this.db.query('SELECT id FROM books WHERE id = $1 AND user_id = $2', [id, userId]);
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Updates a book's editable fields.
     * @param id Book id.
     * @param userId Owning user's id.
     * @param fields New field values.
     */
    public async updateFields(id: number, userId: number, fields: UpdateBookFields): Promise<void> {
        await this.db.query(
            `UPDATE books
             SET name           = $1,
                 description    = $2,
                 image_url      = $3,
                 isbn           = $4,
                 category_id    = $5,
                 format_id      = $6,
                 publisher      = $7,
                 published_date = $8,
                 language_code  = $9,
                 pages          = $10,
                 reading_status = $11,
                 date_updated   = CURRENT_TIMESTAMP
             WHERE id = $12
               AND user_id = $13`,
            [
                fields.name,
                fields.description,
                fields.image_url,
                fields.isbn,
                fields.category_id,
                fields.format_id,
                fields.publisher,
                fields.published_date,
                fields.language_code,
                fields.pages,
                fields.reading_status ?? null,
                id,
                userId,
            ]
        );
    }

    /**
     * Lists the author ids currently linked to a book.
     * @param bookId Book id.
     * @returns Every linked author id.
     */
    public async getAuthorIds(bookId: number): Promise<number[]> {
        const result = await this.db.query('SELECT author_id FROM book_authors WHERE book_id = $1', [bookId]);
        return result.rows.map((row) => row.author_id);
    }

    /**
     * Removes one author link from a book.
     * @param bookId Book id.
     * @param authorId Author id to unlink.
     * @param userId Owning user's id.
     */
    public async removeAuthorLink(bookId: number, authorId: number, userId: number): Promise<void> {
        await this.db.query('DELETE FROM book_authors WHERE book_id = $1 AND author_id = $2 AND user_id = $3', [bookId, authorId, userId]);
    }

    /**
     * Adds one author link to a book.
     * @param bookId Book id.
     * @param authorId Author id to link.
     * @param userId Owning user's id.
     */
    public async addAuthorLink(bookId: number, authorId: number, userId: number): Promise<void> {
        await this.db.query('INSERT INTO book_authors (book_id, author_id, user_id) VALUES ($1, $2, $3)', [bookId, authorId, userId]);
    }

    /**
     * Deletes a book, scoped to `userId`.
     * @param id Book id.
     * @param userId Owning user's id.
     */
    public async remove(id: number, userId: number): Promise<void> {
        await this.db.query('DELETE FROM books WHERE id = $1 AND user_id = $2', [id, userId]);
    }

    /* ---------- Cover image ---------- */

    /**
     * Sets a book's cover image URL (uploaded file or looked-up cover).
     * @param id Book id.
     * @param userId Owning user's id.
     * @param imageUrl New image URL (or data: URI).
     * @returns Rows affected.
     */
    public async updateImageUrl(id: number, userId: number, imageUrl: string): Promise<number> {
        const result = await this.db.query(
            "UPDATE books SET image_url = $1 WHERE id = $2 AND user_id = $3",
            [imageUrl, id, userId]
        );
        return result.rowCount ?? 0;
    }

    /**
     * Looks up a book's stored ISBN.
     * @param id Book id.
     * @param userId Owning user's id.
     * @returns The stored ISBN (possibly null), or undefined if the book itself wasn't found.
     */
    public async getIsbn(id: number, userId: number): Promise<string | null | undefined> {
        const result = await this.db.query("SELECT isbn FROM books WHERE id = $1 AND user_id = $2", [id, userId]);
        if (result.rowCount !== 1) {
            return undefined; // book not found - distinct from `null` (found, but no isbn stored)
        }
        return result.rows[0].isbn;
    }

    /* ---------- Manual create ---------- */

    /**
     * Checks whether an ISBN is already used by one of `userId`'s books.
     * @param isbn ISBN to check.
     * @param userId Owning user's id.
     * @returns Whether a matching book exists.
     */
    public async isbnExists(isbn: string, userId: number): Promise<boolean> {
        const result = await this.db.query('SELECT id FROM books WHERE isbn = $1 AND user_id = $2', [isbn, userId]);
        return result.rowCount === 1;
    }

    /**
     * Inserts a minimal manually-created book.
     * @param userId Owning user's id.
     * @param book Name/description/image/isbn fields.
     * @returns The new row's id.
     */
    public async insert(userId: number, book: {name: string; description: string; imageUrl: string; isbn: string}): Promise<number> {
        const result = await this.db.query(
            "INSERT INTO books (name, description, image_url, isbn, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [book.name, book.description, book.imageUrl, book.isbn, userId]
        );
        return result.rows[0].id;
    }

    /**
     * The user's sole location id, or null if they have zero or more than one - used by the "auto-place a new book" rule.
     * @param userId Owning user's id.
     * @returns The sole location id, or null.
     */
    public async soleLocationId(userId: number): Promise<number | null> {
        const result = await this.db.query(`SELECT id FROM locations WHERE user_id = $1`, [userId]);
        if (result.rowCount !== 1) {
            return null;
        }
        return result.rows[0].id;
    }

    /**
     * Inserts a minimal, unbooked book stock at a location.
     * @param bookId Book id.
     * @param code New stock code.
     * @param locationId Location id.
     * @param userId Owning user's id.
     */
    public async insertStockMinimal(bookId: number, code: string, locationId: number, userId: number): Promise<void> {
        await this.db.query(
            "INSERT INTO book_stocks (book_id, code, location_id, user_id) VALUES ($1, $2, $3, $4)",
            [bookId, code, locationId, userId]
        );
    }

    /* ---------- Ebook file backups ---------- */

    /**
     * Inserts or replaces a book's ebook file of a given type.
     * @param bookId Book id.
     * @param userId Owning user's id.
     * @param fileType File format.
     * @param fileName Original file name.
     * @param fileSize File size in bytes.
     * @param fileData Raw file bytes.
     * @returns The stored file's metadata.
     */
    public async upsertFile(
        bookId: number,
        userId: number,
        fileType: "epub" | "pdf" | "mobi",
        fileName: string,
        fileSize: number,
        fileData: Buffer
    ): Promise<BookFileMeta> {
        const result = await this.db.query(
            `INSERT INTO book_files (book_id, user_id, file_type, file_name, file_size, file_data)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (book_id, file_type) DO UPDATE
                 SET file_name    = EXCLUDED.file_name,
                     file_size    = EXCLUDED.file_size,
                     file_data    = EXCLUDED.file_data,
                     date_created = CURRENT_TIMESTAMP
             RETURNING id, file_type, file_name, file_size, date_created`,
            [bookId, userId, fileType, fileName, fileSize, fileData]
        );
        return result.rows[0];
    }

    /**
     * Looks up one ebook file's bytes for download.
     * @param bookId Book id.
     * @param fileId File id.
     * @param userId Owning user's id.
     * @returns The file's bytes/name/type, or null if it doesn't exist or belongs to someone else.
     */
    public async findFileForDownload(bookId: number, fileId: number, userId: number): Promise<BookFileForDownload | null> {
        const result = await this.db.query(
            "SELECT file_data, file_name, file_type FROM book_files WHERE id = $1 AND book_id = $2 AND user_id = $3",
            [fileId, bookId, userId]
        );
        if (result.rowCount !== 1) {
            return null;
        }
        return result.rows[0];
    }

    /**
     * Deletes one ebook file.
     * @param bookId Book id.
     * @param fileId File id.
     * @param userId Owning user's id.
     * @returns Whether a matching file was found and deleted.
     */
    public async deleteFile(bookId: number, fileId: number, userId: number): Promise<boolean> {
        const result = await this.db.query(
            "DELETE FROM book_files WHERE id = $1 AND book_id = $2 AND user_id = $3",
            [fileId, bookId, userId]
        );
        return result.rowCount === 1;
    }

    /* ---------- ISBN auto-create find-or-create helpers ---------- */

    /**
     * Ensures a `languages` row exists for `code`, inserting a placeholder (code as its own name) if missing.
     * @param code Language code, or null/empty to no-op.
     */
    public async ensureLanguage(code: string | null): Promise<void> {
        if (!code) return;

        const result = await this.db.query('SELECT code FROM languages WHERE code = $1', [code]);
        if (result.rowCount === 0) {
            await this.db.query('INSERT INTO languages (code, name) VALUES ($1, $2)', [code, code]);
        }
    }

    /**
     * Finds a category by exact name, scoped to `userId`.
     * @param name Category name.
     * @param userId Owning user's id.
     * @returns The category id, or null if none matches.
     */
    public async findCategoryByName(name: string, userId: number): Promise<number | null> {
        const result = await this.db.query('SELECT id FROM categories WHERE name = $1 AND user_id = $2', [name, userId]);
        return result.rows[0]?.id ?? null;
    }

    /**
     * Inserts a new category owned by `userId`.
     * @param name Category name.
     * @param userId Owning user's id.
     * @returns The new row's id.
     */
    public async insertCategory(name: string, userId: number): Promise<number> {
        const result = await this.db.query('INSERT INTO categories (name, user_id) VALUES ($1, $2) RETURNING id', [name, userId]);
        return result.rows[0].id;
    }

    /**
     * Finds a book by exact ISBN, scoped to `userId`.
     * @param isbnCode ISBN to search for.
     * @param userId Owning user's id.
     * @returns The book id, or null if none matches.
     */
    public async findByIsbn(isbnCode: string, userId: number): Promise<number | null> {
        const result = await this.db.query('SELECT id FROM books WHERE isbn = $1 AND user_id = $2', [isbnCode, userId]);
        return result.rows[0]?.id ?? null;
    }

    /**
     * Inserts a full book row from looked-up ISBN metadata.
     * @param book Looked-up book fields.
     * @param userId Owning user's id.
     * @returns The new row's id.
     */
    public async insertFull(book: IsbnBookInput, userId: number): Promise<number> {
        const result = await this.db.query(
            `INSERT INTO books (
                name, description, image_url, isbn, category_id,
                publisher, published_date, language_code, pages, user_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING id`,
            [
                book.name,
                book.description,
                book.imageUrl,
                book.isbnCode,
                book.categoryId,
                book.publisher,
                book.formattedPublishedDate,
                book.languageCode,
                book.pages,
                userId,
            ]
        );
        return result.rows[0].id;
    }

    /**
     * Overlays freshly looked-up metadata onto an existing row, but only where the stored value is null/empty/pages=0. Never renames the book.
     * @param bookId Book id.
     * @param book Looked-up book fields to overlay.
     * @param userId Owning user's id.
     */
    public async fillEmptyFields(bookId: number, book: IsbnBookInput, userId: number): Promise<void> {
        await this.db.query(
            `UPDATE books SET
                description = COALESCE(NULLIF(BTRIM(description), ''), $1),
                image_url = COALESCE(image_url, $2),
                category_id = COALESCE(category_id, $3),
                publisher = COALESCE(publisher, $4),
                published_date = COALESCE(published_date, $5),
                language_code = COALESCE(language_code, $6),
                pages = CASE
                    WHEN pages IS NULL OR pages = 0 THEN COALESCE($7, pages)
                    ELSE pages
                END
            WHERE id = $8 AND user_id = $9`,
            [
                book.description ?? null,
                book.imageUrl ?? null,
                book.categoryId ?? null,
                book.publisher ?? null,
                book.formattedPublishedDate ?? null,
                book.languageCode ?? null,
                book.pages ?? null,
                bookId,
                userId,
            ]
        );
    }

    /**
     * Finds an author by exact name, scoped to `userId`.
     * @param name Author name.
     * @param userId Owning user's id.
     * @returns The author id, or null if none matches.
     */
    public async findAuthorByName(name: string, userId: number): Promise<number | null> {
        const result = await this.db.query('SELECT id FROM authors WHERE name = $1 AND user_id = $2', [name, userId]);
        return result.rows[0]?.id ?? null;
    }

    /**
     * Inserts a new author owned by `userId`.
     * @param name Author name.
     * @param userId Owning user's id.
     * @returns The new row's id.
     */
    public async insertAuthorRow(name: string, userId: number): Promise<number> {
        const result = await this.db.query('INSERT INTO authors (name, user_id) VALUES ($1,$2) RETURNING id', [name, userId]);
        return result.rows[0].id;
    }

    /**
     * Links an author to a book, no-op if the link already exists.
     * @param bookId Book id.
     * @param authorId Author id.
     * @param userId Owning user's id.
     */
    public async linkAuthorToBook(bookId: number, authorId: number, userId: number): Promise<void> {
        await this.db.query(
            `INSERT INTO book_authors (book_id, author_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [bookId, authorId, userId]
        );
    }

    /**
     * Checks whether a location exists and belongs to `userId`.
     * @param locationId Location id.
     * @param userId Owning user's id.
     * @returns Whether a matching location exists.
     */
    public async locationExistsForUser(locationId: string | number, userId: number): Promise<boolean> {
        const result = await this.db.query('SELECT id FROM locations WHERE id = $1 AND user_id = $2', [locationId, userId]);
        return result.rowCount === 1;
    }

    /**
     * Inserts an unbooked book stock at a specific location.
     * @param bookId Book id.
     * @param code New stock code.
     * @param locationId Location id.
     * @param userId Owning user's id.
     */
    public async insertStockAtLocation(bookId: number, code: string, locationId: string | number, userId: number): Promise<void> {
        await this.db.query(
            `INSERT INTO book_stocks (book_id, code, status, location_id, customer_id, user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
            [bookId, code, 0, locationId, null, userId]
        );
    }

    /* ---------- Stock lifecycle ---------- */

    /**
     * Generates a globally-unique book stock code, retrying on collision.
     * @returns A fresh, unused stock code.
     */
    public async generateStockCode(): Promise<string> {
        let code = "";
        let isUnique = false;

        while (!isUnique) {
            code = uuidv4().replace(/-/g, '').substring(0, 10);
            const {rowCount} = await this.db.query("SELECT 1 FROM book_stocks WHERE code = $1", [code]);
            if (rowCount === 0) {
                isUnique = true;
            }
        }

        return code;
    }

    /**
     * Inserts a new book stock with a given status/location/customer.
     * @param bookId Book id.
     * @param code New stock code.
     * @param status Initial stock status.
     * @param locationId Location id.
     * @param customerId Customer id, if pre-booked.
     * @param userId Owning user's id.
     * @returns The new row's id.
     */
    public async insertStockWithId(
        bookId: string | number,
        code: string,
        status: number,
        locationId: string | number,
        customerId: string | number | null | undefined,
        userId: number
    ): Promise<number> {
        const result = await this.db.query(
            "INSERT INTO book_stocks (book_id, code, status, location_id, customer_id, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
            [bookId, code, status, locationId, customerId, userId]
        );
        return result.rows[0].id;
    }

    /**
     * Full detail for one book stock (with location/customer names).
     * @param stockId Stock id.
     * @param userId Owning user's id.
     * @returns The stock detail, or null if it doesn't exist or belongs to someone else.
     */
    public async findStockDetail(stockId: string | number, userId: number): Promise<BookStockDetail | null> {
        const result = await this.db.query(
            `SELECT book_stocks.id,
                    book_stocks.code,
                    book_stocks.status,
                    book_stocks.location_id,
                    locations.name as location_name,
                    customers.id   as customer_id,
                    customers.name as customer_name
             FROM book_stocks
                      LEFT JOIN customers ON book_stocks.customer_id = customers.id AND customers.user_id = $2
                      LEFT JOIN locations ON book_stocks.location_id = locations.id AND locations.user_id = $2
             WHERE book_stocks.id = $1
               AND book_stocks.user_id = $2`,
            [stockId, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Deletes one book stock.
     * @param bookId Book id.
     * @param stockId Stock id.
     * @param userId Owning user's id.
     * @returns Whether a matching stock was found and deleted.
     */
    public async deleteStock(bookId: string | number, stockId: string | number, userId: number): Promise<boolean> {
        const result = await this.db.query(
            'DELETE FROM book_stocks WHERE book_id = $1 AND id = $2 AND user_id = $3',
            [bookId, stockId, userId]
        );
        return result.rowCount === 1;
    }

    /**
     * Looks up one book stock's current status.
     * @param stockId Stock id.
     * @param bookId Book id.
     * @param userId Owning user's id.
     * @returns The stock's status, or undefined if it doesn't exist.
     */
    public async getStockStatus(stockId: string | number, bookId: string | number, userId: number): Promise<number | undefined> {
        const result = await this.db.query(
            'SELECT status FROM book_stocks WHERE id = $1 AND book_id = $2 AND user_id = $3',
            [stockId, bookId, userId]
        );
        return result.rows[0]?.status;
    }

    /**
     * Updates a book stock's status/location/customer, and its `loaned_at` timestamp.
     *
     * $1::smallint - book_stocks.status is SMALLINT, but $1 is also compared
     * against the bare integer literal `2` below; without an explicit cast,
     * Postgres can't decide which type to infer for $1 and rejects the whole
     * statement (42P08 "inconsistent types deduced for parameter $1: integer
     * versus smallint").
     *
     * @param bookId Book id.
     * @param stockId Stock id.
     * @param userId Owning user's id.
     * @param status New status.
     * @param locationId New location id.
     * @param customerId New customer id, or null/undefined to clear it.
     * @returns Rows affected.
     */
    public async updateStock(
        bookId: string | number,
        stockId: string | number,
        userId: number,
        status: number,
        locationId: number,
        customerId: number | null | undefined
    ): Promise<number> {
        const result = await this.db.query(
            `UPDATE book_stocks
             SET status = $1::smallint,
                 location_id = $2,
                 customer_id = $3,
                 loaned_at = CASE
                                 WHEN $1 = 2 AND status != 2 THEN NOW()
                                 WHEN $1 != 2 THEN NULL
                                 ELSE loaned_at
                 END
             WHERE book_id = $4 AND id = $5 AND user_id = $6`,
            [status, locationId, customerId, bookId, stockId, userId]
        );
        return result.rowCount ?? 0;
    }

    /**
     * Looks up a book stock (and its book) by the stock's own code.
     * @param bookCode Stock code.
     * @param userId Owning user's id.
     * @returns The book/stock summary, or null if none matches.
     */
    public async findStockAndBookByCode(bookCode: string, userId: number): Promise<{
        book_id: number; name: string; image_url: string | null; isbn: string | null;
        stock_id: number; stock_code: string; status: number;
    } | null> {
        const result = await this.db.query(
            `SELECT b.id    AS book_id,
                    b.name,
                    b.image_url,
                    b.isbn,
                    bs.id   AS stock_id,
                    bs.code AS stock_code,
                    bs.status
             FROM book_stocks bs
                      INNER JOIN books b ON b.id = bs.book_id AND b.user_id = bs.user_id
             WHERE bs.code = $1
               AND bs.user_id = $2 LIMIT 1`,
            [bookCode, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Marks a book stock (by code) as returned.
     * @param bookStockCode Stock code.
     * @param userId Owning user's id.
     */
    public async returnStockByCode(bookStockCode: string, userId: number): Promise<void> {
        await this.db.query(
            'UPDATE book_stocks SET customer_id = $1, status = $2, loaned_at = NULL WHERE code = $3 AND user_id = $4',
            [null, 0, bookStockCode, userId]
        );
    }

    /* ---------- Import enrichment ---------- */

    /**
     * Looks up the subset of a book's fields ImportEnrichmentService can fill in from looked-up metadata.
     * @param id Book id.
     * @param userId Owning user's id.
     * @returns The book's enrichable fields, or null if it doesn't exist or belongs to someone else.
     */
    public async findRowForEnrichment(id: number, userId: number): Promise<BookEnrichmentRow | null> {
        const result = await this.db.query(
            `SELECT id, name, isbn, description, image_url, publisher, published_date,
                    language_code, pages, category_id
               FROM books
              WHERE id = $1 AND user_id = $2`,
            [id, userId]
        );
        return result.rows[0] ?? null;
    }

    /**
     * Lists a book's linked author names, for the Wikipedia-lookup fallback's author-overlap check.
     * @param bookId Book id.
     * @param userId Owning user's id.
     * @returns Every linked author's name.
     */
    public async getAuthorNames(bookId: number, userId: number): Promise<string[]> {
        const result = await this.db.query(
            `SELECT a.name
               FROM book_authors ba
               JOIN authors a ON a.id = ba.author_id
              WHERE ba.book_id = $1 AND ba.user_id = $2
              ORDER BY a.name`,
            [bookId, userId]
        );
        return result.rows.map((row: {name: string}) => row.name);
    }
}
