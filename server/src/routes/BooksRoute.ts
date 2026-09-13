/**
 * =============================================================================
 * BooksRoute
 * =============================================================================
 * Mounted at `/api/rest/book` (see server/src/routes/Routes.ts).
 *
 * Owns everything related to a user's book catalog:
 *  - searching/listing/reading/updating/deleting `books`
 *  - creating books either manually or automatically from an ISBN lookup
 *    (Google Books API, with an Open Library fallback for metadata + cover)
 *  - managing physical copies of a book ("book stocks": add/update/remove,
 *    and bulk "return" of loaned/sold copies)
 *
 * Every route in this file (except the small pure helper functions at the
 * bottom) requires a valid session - see `requireAuth` in
 * server/src/middlewares/AuthMiddleware.ts. All queries are additionally
 * scoped by `user_id` so one user can never read/modify another user's data.
 */
import {Router, Request, Response} from 'express';
import {appService} from "../AppService";
import axios from "axios";
import {v4 as uuidv4} from 'uuid';
import {requireAuth} from "../middlewares/AuthMiddleware";
import multer from "multer";
import {IBookAddMd} from "../types/book/IBookAddMd";
import {IBookFile} from "../types/book/IBookFile";
import {Pool, PoolClient} from "pg";
import {SearchFilter} from "../types/search/SearchFilter";
import {SortType} from "../types/search/SortType";
import {normalizeAndValidateIsbn} from "../utils/IsbnVerification";
import {isValidEpub, isValidMobi, isValidPdf} from "../utils/FileSignature";
import {recordLoan, recordReturn} from "../utils/LoanHistory";
import {handleUploadError} from "../middlewares/UploadErrorMiddleware";
import {ReadingStatusEnum} from "../types/book/IReadingStatus";
// @ts-ignore
const router: Router = Router();

// Multer setup - store in memory
const storage = multer.memoryStorage();
const maxCoverImageSizeMb = 4;
const upload = multer({
    storage,
    limits: {fileSize: maxCoverImageSizeMb * 1024 * 1024},
    fileFilter: (req: Request, file: Express.Multer.File, cb: (error: any, acceptFile: boolean) => void) => {
        // @ts-ignore
        if (file.mimetype !== "image/png" && file.mimetype !== "image/jpeg") {
            return cb(new Error("Only PNG or JPG images are allowed"), false);
        }
        cb(null, true);
    }
});

// Max size for the ebook-file backups, configurable via MAX_EBOOK_FILE_SIZE_MB
// so deployers can raise (or lower) the limit without a code change.
// Defaults to 10MB when unset or not a valid positive number.
const parsedMaxEbookFileSizeMb = Number(process.env.MAX_EBOOK_FILE_SIZE_MB);
const maxEbookFileSizeMb = Number.isFinite(parsedMaxEbookFileSizeMb) && parsedMaxEbookFileSizeMb > 0
    ? parsedMaxEbookFileSizeMb
    : 10;

// Multer setup for the book ebook-file backups (epub/pdf/Kindle) - also stored
// in memory, validated by extension since browsers report inconsistent
// mimetypes for .epub/.mobi/.azw3.
const fileUpload = multer({
    storage,
    limits: {fileSize: maxEbookFileSizeMb * 1024 * 1024},
    fileFilter: (req: Request, file: Express.Multer.File, cb: (error: any, acceptFile: boolean) => void) => {
        const name = file.originalname.toLowerCase();
        if (!name.endsWith(".epub") && !name.endsWith(".pdf") && !name.endsWith(".mobi") && !name.endsWith(".azw3")) {
            return cb(new Error("Only EPUB, PDF or Kindle files are allowed"), false);
        }
        cb(null, true);
    }
});

/**
 * GET /book/search
 * -----------------
 * Paginated, filterable search over the current user's books.
 *
 * Auth: required (session cookie).
 *
 * Query params (all optional):
 *  - query        {string} Case-insensitive match against book name OR isbn.
 *  - category_id  {number | number[] | "1,2,3"} Restrict to one or more category ids.
 *  - page         {number} Zero-based page index. 50 results per page.
 *  - filters      {string} Comma-separated list of `SearchFilter` values,
 *                 e.g. "NO_STOCK", "HAS_STOCK", "ON_LOAN" or "RECENT"
 *                 (see types/search/SearchFilter.ts).
 *  - date_from    {string} Restrict to books added on/after this date (YYYY-MM-DD).
 *  - date_to      {string} Restrict to books added on/before this date (YYYY-MM-DD).
 *  - sort         {string} A `SortType` value - "NAME_ASC" (default), "NAME_DESC",
 *                 "DATE_NEWEST" or "DATE_OLDEST" (see types/search/SortType.ts).
 *
 * Example request:
 *  GET /api/rest/book/search?query=hobbit&category_id=3&page=0&filters=HAS_STOCK&sort=DATE_NEWEST
 *
 * Example response (200):
 *  {
 *    "total": 1,
 *    "limit": 50,
 *    "books": [
 *      {
 *        "id": 12,
 *        "name": "The Hobbit",
 *        "image_url": "https://books.google.com/...",
 *        "isbn": "9780261102217",
 *        "category_id": 3,
 *        "language_code": "en",
 *        "authors": [{ "id": 4, "name": "J.R.R. Tolkien" }]
 *      }
 *    ]
 *  }
 */
// @ts-ignore
router.get('/search', requireAuth, async (req: Request, res: Response) => {
    // Params
    const query = req.query.query ? String(req.query.query) : undefined;
    // Array of categories
    const category_id = req.query.category_id;
    const page = Math.max(0, Number(req.query.page)) || 0;
    const filters: SearchFilter[] = req.query.filters ? String(req.query.filters).split(",") as SearchFilter[] : [];
    const dateFrom = req.query.date_from ? String(req.query.date_from) : undefined;
    const dateTo = req.query.date_to ? String(req.query.date_to) : undefined;
    const sort = Object.values(SortType).includes(req.query.sort as SortType)
        ? req.query.sort as SortType
        : SortType.NAME_ASC;

    const userId = appService.getSessionUser(req);

    const pool = appService.getDatabasePool();
    const client = await pool.connect();
    try {
        const MAX_ROWS = 50;
        const skip = MAX_ROWS * page;

        const params: any[] = [userId];
        const conditions: String[] = [
            `books.user_id = $1`
        ];

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


        if (query) {
            conditions.push(`LOWER(books.name) ILIKE $${params.push(`%${query.toLocaleLowerCase()}%`)} OR LOWER(books.isbn) ILIKE $${params.push(`%${query.toLocaleLowerCase()}%`)}`);
        }

        if (category_id) {
            const ids = Array.isArray(category_id)
                ? category_id.map(Number)
                : String(category_id).split(',').map(Number);

            conditions.push(`category_id = ANY($${params.length + 1})`);
            params.push(ids);
        }

        if (filters.length > 0) {
            filters.forEach((filter) => {
                switch (filter) {
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
            })
        }

        if (dateFrom) {
            conditions.push(`books.date_created >= $${params.push(dateFrom)}`);
        }

        if (dateTo) {
            conditions.push(`books.date_created < $${params.push(dateTo)}::date + INTERVAL '1 day'`);
        }

        if (conditions.length > 0) {
            sqlStatement += ` WHERE ${conditions.join(' AND ')}`;
        }

        /**
         * Total results
         */
        let totalQuery = "SELECT COUNT(*) FROM books";
        if (conditions.length > 0) {
            totalQuery += ` WHERE ${conditions.join(' AND ')}`;
        }
        appService.getLogger().debug(`execute total results query: ${totalQuery}`);
        const totalResults = await client.query(totalQuery, params);

        /**
         * Results
         */
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
            ORDER BY ${ORDER_BY_CLAUSES[sort]}
            LIMIT ${MAX_ROWS} OFFSET ${skip};
        `;

        // Use a prepared statement to fetch items by name
        appService.getLogger().debug(`executing query: ${sqlStatement}`);
        const result = await client.query(sqlStatement, params);

        // Return the result (found rows)
        res.status(200).json({
            total: totalResults.rows[0] ? Number(totalResults.rows[0].count) : -1,
            limit: MAX_ROWS,
            books: result.rows
        });
    } catch (err: any) {
        console.error('Error executing query', err.stack);
        res.status(500).send('Internal Server Error');
    } finally {
        client.release();
    }
});

/**
 * GET /book/counters
 * --------------------
 * Lightweight counters for the current user's library, powering the
 * "Library" section of the left nav (see `AppMenu.vue`) and its quick
 * filters - cheap enough to fetch on every page load, unlike a full search.
 *
 * Auth: required.
 *
 * Example response (200):
 *  { "total": 42, "recent": 3, "onLoan": 5, "noStock": 10, "wantToRead": 8, "currentlyReading": 2 }
 */
// @ts-ignore
router.get('/counters', requireAuth, async (req: Request, res: Response) => {
    const userId = appService.getSessionUser(req);
    const pool = appService.getDatabasePool();

    try {
        const [total, recent, onLoan, noStock, wantToRead, currentlyReading] = await Promise.all([
            pool.query(`SELECT COUNT(*) FROM books WHERE user_id = $1`, [userId]),
            pool.query(`SELECT COUNT(*) FROM books WHERE user_id = $1 AND date_created >= NOW() - INTERVAL '30 days'`, [userId]),
            pool.query(`SELECT COUNT(*) FROM books WHERE user_id = $1 AND id IN (SELECT book_id FROM book_stocks WHERE user_id = $1 AND status = 2)`, [userId]),
            pool.query(`SELECT COUNT(*) FROM books WHERE user_id = $1 AND id NOT IN (SELECT book_id FROM book_stocks WHERE user_id = $1)`, [userId]),
            pool.query(`SELECT COUNT(*) FROM books WHERE user_id = $1 AND reading_status = ${ReadingStatusEnum.WANT_TO_READ}`, [userId]),
            pool.query(`SELECT COUNT(*) FROM books WHERE user_id = $1 AND reading_status = ${ReadingStatusEnum.CURRENTLY_READING}`, [userId]),
        ]);

        res.status(200).json({
            total: Number(total.rows[0].count),
            recent: Number(recent.rows[0].count),
            onLoan: Number(onLoan.rows[0].count),
            noStock: Number(noStock.rows[0].count),
            wantToRead: Number(wantToRead.rows[0].count),
            currentlyReading: Number(currentlyReading.rows[0].count),
        });
    } catch (err: any) {
        console.error('Error executing query', err.stack);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * GET /book/:id
 * -------------
 * Fetch full detail for a single book, including its physical stocks
 * (with resolved location/customer names), its authors, and its backed-up
 * ebook files.
 *
 * Auth: required. Path param `id` {number} - book id.
 *
 * Example request:  GET /api/rest/book/12
 *
 * Example response (200):
 *  {
 *    "id": 12,
 *    "name": "The Hobbit",
 *    "description": "...",
 *    "image_url": "https://...",
 *    "isbn": "9780261102217",
 *    "category_id": 3,
 *    "language_code": "en",
 *    "publisher": "HarperCollins",
 *    "published_date": "1937-09-21",
 *    "pages": 310,
 *    "format_id": 1,
 *    "reading_status": null,
 *    "stocks": [
 *      { "id": 1, "code": "a1b2c3d4e5", "status": 0, "location_id": 2,
 *        "location_name": "Main shelf", "customer_id": null, "customer_name": null }
 *    ],
 *    "authors": [{ "id": 4, "name": "J.R.R. Tolkien" }],
 *    "files": [
 *      { "id": 3, "file_type": "epub", "file_name": "hobbit.epub", "file_size": 512000, "date_created": "..." }
 *    ]
 *  }
 *
 * Response (404): "Book not found" - when no book with that id belongs to the caller.
 */
// @ts-ignore
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    appService.getLogger().debug(`Get book, id: ${id}`);
    const pool = appService.getDatabasePool();
    const client = await pool.connect();
    const userId = appService.getSessionUser(req);
    try {
        const result = await client.query(`
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
                     LEFT JOIN book_stocks ON books.id = book_stocks.book_id
                     LEFT JOIN locations ON book_stocks.location_id = locations.id
                     LEFT JOIN customers ON book_stocks.customer_id = customers.id AND customers.user_id = $2
                     LEFT JOIN book_authors ON books.id = book_authors.book_id
                     LEFT JOIN authors ON book_authors.author_id = authors.id
                     LEFT JOIN book_files ON books.id = book_files.book_id
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
            res.status(404).send("Book not found");
        } else {
            res.status(200).json(result.rows[0]);
        }
    } catch (err: any) {
        console.error('Error executing query', err.stack);
        res.status(500).send('Internal Server Error');
    } finally {
        client.release();
    }
});

/**
 * PUT /book/:id
 * -------------
 * Update a book's metadata and reconcile its author list.
 *
 * Auth: required. Path param `id` {number} - book id.
 *
 * Body (JSON):
 *  {
 *    "name": "The Hobbit",
 *    "description": "A hobbit's unexpected journey.",
 *    "image_url": "data:image/png;base64,..." | "https://books.google.com/...",
 *    "isbn": "9780261102217",
 *    "category_id": 3,
 *    "language_code": "en",
 *    "authors": [4, 7],            // full desired list of author ids; diffed against
 *                                  // existing book_authors rows (added/removed accordingly)
 *    "publisher": "HarperCollins",
 *    "published_date": "1937-09-21",
 *    "pages": 310,
 *    "format_id": 1,
 *    "reading_status": 1          // 0 = want to read, 1 = currently reading, 2 = read; null/omitted = untracked
 *  }
 *
 * Notes:
 *  - `image_url` is validated by `isAllowedImageUrl()` - only our own
 *    data: URIs or the whitelisted Google Books / Open Library hosts are accepted.
 *  - `reading_status` must be null or one of 0/1/2 (400 otherwise).
 *  - The whole update (books row + book_authors diff) runs in one transaction.
 *
 * Responses: 200 {"message": "Book updated successfully"} |
 *            400 {"error": "Invalid image URL"} |
 *            404 {"error": "Book not found"} | 500 on failure (rolls back).
 */
// @ts-ignore
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    appService.getLogger().debug(`Update book, id: ${id}`);
    const userId = appService.getSessionUser(req);

    // Body params
    const {
        name,
        image_url,
        isbn,
        category_id,
        language_code,
        authors,
        description,
        publisher,
        published_date,
        pages,
        format_id,
        reading_status
    } = req.body;

    if (image_url && !isAllowedImageUrl(image_url)) {
        return res.status(400).send({error: "Invalid image URL"});
    }

    if (reading_status != null && ![ReadingStatusEnum.WANT_TO_READ, ReadingStatusEnum.CURRENTLY_READING, ReadingStatusEnum.READ].includes(reading_status)) {
        return res.status(400).send({error: "Invalid reading status"});
    }

    // Database connection
    const pool = appService.getDatabasePool();
    const client = await pool.connect();

    try {
        // Validate the existence of the book
        const bookCheck = await client.query('SELECT id FROM books WHERE id = $1 AND user_id = $2', [id, userId]);
        if (bookCheck.rowCount === 0) {
            return res.status(404).send({error: "Book not found"});
        }

        // Start transaction
        await client.query('BEGIN');

        // Update the books table
        const updateQuery = `
            UPDATE books
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
              AND user_id = $13
        `;
        const updateValues = [
            name,
            description,
            image_url,
            isbn,
            category_id,
            format_id,
            publisher,
            published_date,
            language_code,
            pages,
            reading_status ?? null,
            id,
            userId
        ];
        await client.query(updateQuery, updateValues);

        // Handle authors relationship in the book_authors table
        if (authors && Array.isArray(authors)) {
            // Fetch existing authors associated with the book
            const existingAuthorsResult = await client.query(
                'SELECT author_id FROM book_authors WHERE book_id = $1',
                [id]
            );
            const existingAuthors = existingAuthorsResult.rows.map(row => row.author_id);

            // Determine authors to remove (present in the database but not in the new list)
            const authorsToRemove = existingAuthors.filter(authorId => !authors.includes(authorId));

            // Determine authors to add (present in the new list but not in the database)
            const authorsToAdd = authors.filter(authorId => !existingAuthors.includes(authorId));

            // Remove authors no longer associated with the book
            for (const authorId of authorsToRemove) {
                await client.query(
                    'DELETE FROM book_authors WHERE book_id = $1 AND author_id = $2 AND user_id = $3',
                    [id, authorId, userId]
                );
            }

            // Add new authors to the book
            for (const authorId of authorsToAdd) {
                // Ensure the author exists in the authors table
                const authorCheck = await client.query('SELECT id FROM authors WHERE id = $1 AND user_id = $2', [authorId, userId]);
                if (authorCheck.rowCount !== 0) {
                    // Associate the author with the book
                    await client.query(
                        'INSERT INTO book_authors (book_id, author_id, user_id) VALUES ($1, $2, $3)',
                        [id, authorId, userId]
                    );
                } else {
                    console.warn(`Author with ID ${authorId} not found, skipping association.`);
                }
            }
        }

        // Commit transaction
        await client.query('COMMIT');
        res.send({message: "Book updated successfully"});
    } catch (e) {
        // Rollback transaction in case of error
        await client.query('ROLLBACK');
        console.error("Error while updating book", e);
        res.status(500).send('Internal Server Error');
    } finally {
        client.release();
    }
});

/**
 * DELETE /book/:id
 * ----------------
 * Permanently delete a book (and, via DB foreign keys, its stocks/author links).
 *
 * Auth: required. Path param `id` {number} - book id.
 *
 * Example request: DELETE /api/rest/book/12
 *
 * Responses: 200 {"message": "Book deleted successfully"} |
 *            404 {"error": "Book not found"} | 500 on failure.
 */
// @ts-ignore
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    appService.getLogger().debug(`Delete book, id: ${id}`);

    // Database connection
    const pool = appService.getDatabasePool();
    const client = await pool.connect();
    const userId = appService.getSessionUser(req);

    try {
        // Validate the existence of the book
        const bookCheck = await client.query('SELECT id FROM books WHERE id = $1 AND user_id = $2', [id, userId]);
        if (bookCheck.rowCount === 0) {
            return res.status(404).send({error: "Book not found"});
        }

        await client.query('DELETE FROM books WHERE id = $1 AND user_id = $2', [id, userId]);

        res.send({message: "Book deleted successfully"});
    } catch (e) {
        console.error("Error while deleting book", e);
        res.status(500).send('Internal Server Error');
    } finally {
        client.release();
    }
});


/**
 * POST /book/:id/image
 * ---------------------
 * Replace a book's cover image with an uploaded file.
 *
 * Auth: required. Path param `id` {number} - book id.
 * Body: multipart/form-data with a single field `image` (PNG or JPEG, max 4MB -
 * enforced by the `multer` config above). The file is stored inline as a
 * base64 data: URI in `books.image_url` (no external file storage/CDN).
 *
 * Example request (curl):
 *   curl -X POST /api/rest/book/12/image -F "image=@cover.jpg"
 *
 * Response (200): number of rows updated (0 or 1), e.g. `1`.
 */
router.post('/:id/image', requireAuth, upload.single("image"), handleUploadError(maxCoverImageSizeMb), async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    let imageUrl = "";

    if (req.file) {
        const base64 = req.file.buffer.toString("base64");
        imageUrl = `data:${req.file.mimetype};base64,${base64}`;
    }

    const pool = appService.getDatabasePool();
    const userId = appService.getSessionUser(req);

    try {
        const updatedBook = await pool.query(
            "UPDATE books SET image_url = $1 WHERE id = $2 AND user_id = $3",
            [imageUrl, id, userId]
        );

        res.status(200).json(updatedBook.rowCount);
    } catch (error) {
        // Rollback on error
        console.error("Transaction error:", error);
        res.status(500).send("Error adding book");
    }
});

/**
 * POST /book/:id/cover/find
 * -------------------------
 * Look up a cover for a book that already exists in the library, using its
 * stored ISBN (Google Books, falling back to Open Library then LibraryThing -
 * same lookup order as `POST /book/isbn/:isbn`), and save it as the book's cover.
 *
 * Auth: required. Path param `id` {number} - book id.
 *
 * Response (200): the new cover image URL, e.g. `"https://covers.openlibrary.org/b/isbn/...-M.jpg"`.
 * Response (400): "Book has no ISBN" - nothing to look the cover up by.
 * Response (404): "Book not found" | "No cover found for this book".
 * Response (502): "External book service failed" (Google/Open Library request failed).
 */
router.post('/:id/cover/find', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const pool = appService.getDatabasePool();
    const userId = appService.getSessionUser(req);

    try {
        const book = await pool.query(
            "SELECT isbn FROM books WHERE id = $1 AND user_id = $2",
            [id, userId]
        );

        if (book.rowCount !== 1) {
            return res.status(404).send("Book not found");
        }

        const isbnCode = normalizeAndValidateIsbn(book.rows[0].isbn ?? "");
        if (!isbnCode) {
            return res.status(400).send("Book has no ISBN");
        }

        const bookData = await fetchBookData(isbnCode);
        const imageUrl = await resolveCoverImageUrl(isbnCode, bookData?.imageLinks?.thumbnail);

        if (!imageUrl) {
            return res.status(404).send("No cover found for this book");
        }

        await pool.query(
            "UPDATE books SET image_url = $1 WHERE id = $2 AND user_id = $3",
            [imageUrl, id, userId]
        );

        res.status(200).json(imageUrl);
    } catch (error: unknown) {
        console.error("Error finding book cover:", error);

        if (axios.isAxiosError(error)) {
            return res.status(502).send("External book service failed");
        }

        res.status(500).send("Error finding book cover");
    }
});

/** @param fileName Original uploaded file name. @returns The `book_files.file_type` its extension maps to. */
function fileTypeFromName(fileName: string): "epub" | "pdf" | "mobi" {
    const name = fileName.toLowerCase();
    if (name.endsWith(".epub")) return "epub";
    if (name.endsWith(".pdf")) return "pdf";
    return "mobi"; // .mobi or .azw3 - already enforced by fileFilter above.
}

/**
 * POST /book/:id/file
 * --------------------
 * Upload (or replace) one of a book's backup ebook files - a personal copy
 * kept in case the user only has the file itself on an e-reader. A book can
 * have up to one file per type (epub/pdf/mobi); uploading a file replaces
 * any existing file of that same type, leaving files of other types alone.
 *
 * Auth: required. Path param `id` {number} - book id.
 * Body: multipart/form-data with a single field `file` (.epub, .pdf, .mobi
 * or .azw3, max size configurable via MAX_EBOOK_FILE_SIZE_MB, default 10MB -
 * enforced by the `fileUpload` config above). Stored
 * as raw bytes in `book_files.file_data`. `.mobi` and `.azw3` are both
 * stored under the `mobi` file_type - they share the same MOBI/KF8
 * container - so uploading one replaces the other.
 *
 * The file name's extension only gets it past `fileFilter` - the actual
 * bytes are then checked against the real PDF/EPUB/MOBI signature (see
 * `utils/FileSignature.ts`) before anything is persisted, so a renamed
 * unrelated file is rejected rather than stored.
 *
 * Example request (curl):
 *   curl -X POST /api/rest/book/12/file -F "file=@book.epub"
 *
 * Response (200): the file's metadata (no bytes), e.g.
 *   {"id": 3, "file_type": "epub", "file_name": "book.epub", "file_size": 512000, "date_created": "..."}
 * Response (400): "No file provided" | "File content does not match a valid EPUB, PDF or Kindle file" | "Only EPUB, PDF or Kindle files are allowed" (from fileFilter, via `handleUploadError`).
 * Response (413): "File exceeds the maximum allowed upload size of {N}MB" - when the file is larger than MAX_EBOOK_FILE_SIZE_MB.
 */
router.post('/:id/file', requireAuth, fileUpload.single("file"), handleUploadError(maxEbookFileSizeMb), async (req: Request, res: Response) => {
    const id = Number(req.params.id);

    if (!req.file) {
        return res.status(400).send("No file provided");
    }

    const fileType = fileTypeFromName(req.file.originalname);

    // Trust the actual bytes, not just the file name (which fileFilter above only
    // checked by extension - trivially spoofed by renaming any file to .pdf/.epub/.mobi/.azw3).
    const isValidContent = fileType === "epub" ? isValidEpub(req.file.buffer)
        : fileType === "pdf" ? isValidPdf(req.file.buffer)
            : isValidMobi(req.file.buffer);
    if (!isValidContent) {
        return res.status(400).send("File content does not match a valid EPUB, PDF or Kindle file");
    }

    const pool = appService.getDatabasePool();
    const userId = appService.getSessionUser(req);

    try {
        const book = await pool.query("SELECT id FROM books WHERE id = $1 AND user_id = $2", [id, userId]);
        if (book.rowCount !== 1) {
            return res.status(404).send("Book not found");
        }

        const result = await pool.query(
            `INSERT INTO book_files (book_id, user_id, file_type, file_name, file_size, file_data)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (book_id, file_type) DO UPDATE
                 SET file_name    = EXCLUDED.file_name,
                     file_size    = EXCLUDED.file_size,
                     file_data    = EXCLUDED.file_data,
                     date_created = CURRENT_TIMESTAMP
             RETURNING id, file_type, file_name, file_size, date_created`,
            [id, userId, fileType, req.file.originalname, req.file.size, req.file.buffer]
        );

        const file: IBookFile = result.rows[0];
        res.status(200).json(file);
    } catch (error) {
        console.error("Error uploading book file:", error);
        res.status(500).send("Error uploading book file");
    }
});

/**
 * GET /book/:id/file/:fileId/download
 * -------------------------------------
 * Download one of the book's backed-up ebook files.
 *
 * Auth: required. Path params: `id` {number} - book id; `fileId` {number} - `book_files.id`.
 *
 * Response (200): the raw file bytes, with `Content-Type` and
 * `Content-Disposition: attachment` set from the stored file's name/type.
 * Response (404): "File not found" - when no such backed-up file exists for this book.
 */
router.get('/:id/file/:fileId/download', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const fileId = Number(req.params.fileId);
    const pool = appService.getDatabasePool();
    const userId = appService.getSessionUser(req);

    try {
        const result = await pool.query(
            "SELECT file_data, file_name, file_type FROM book_files WHERE id = $1 AND book_id = $2 AND user_id = $3",
            [fileId, id, userId]
        );

        if (result.rowCount !== 1) {
            return res.status(404).send("File not found");
        }

        const {file_data, file_name, file_type} = result.rows[0];
        const contentType = file_type === "epub" ? "application/epub+zip"
            : file_type === "pdf" ? "application/pdf"
                : "application/x-mobipocket-ebook";
        res.setHeader("Content-Type", contentType);
        const asciiName = file_name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
        res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file_name)}`);
        res.status(200).send(file_data);
    } catch (error) {
        console.error("Error downloading book file:", error);
        res.status(500).send("Error downloading book file");
    }
});

/**
 * DELETE /book/:id/file/:fileId
 * -------------------------------
 * Remove one of the book's backed-up ebook files.
 *
 * Auth: required. Path params: `id` {number} - book id; `fileId` {number} - `book_files.id`.
 *
 * Response (200): whether a file was actually deleted, e.g. `true` | `false`.
 */
router.delete('/:id/file/:fileId', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const fileId = Number(req.params.fileId);
    const pool = appService.getDatabasePool();
    const userId = appService.getSessionUser(req);

    try {
        const result = await pool.query(
            "DELETE FROM book_files WHERE id = $1 AND book_id = $2 AND user_id = $3",
            [fileId, id, userId]
        );

        res.status(200).json(result.rowCount === 1);
    } catch (error) {
        console.error("Error deleting book file:", error);
        res.status(500).send("Error deleting book file");
    }
});

/**
 * POST /book
 * ----------
 * Create a book by hand (as opposed to the ISBN auto-lookup below).
 *
 * Auth: required.
 * Body: multipart/form-data
 *  - name        {string} required (books.name is NOT NULL)
 *  - description {string} optional
 *  - isbn        {string} optional - rejected with 404 if it already exists for this user
 *  - image       {file}   optional, PNG/JPEG, stored as base64 data: URI
 *
 * Side effect: if the user has exactly one location, the new book
 * automatically gets one stock entry there (see `__automaticallyAddBookToLocation`).
 *
 * Example request (curl):
 *   curl -X POST /api/rest/book -F "name=The Hobbit" -F "isbn=9780261102217" -F "image=@cover.jpg"
 *
 * Response (200): the new book's id, e.g. `42`.
 */
// @ts-ignore
router.post('', requireAuth, upload.single("image"), handleUploadError(maxCoverImageSizeMb), async (req: Request, res: Response) => {
    const name = req.body.name;
    const description = req.body.description;
    const isbn = req.body.isbn;
    let imageUrl = "";

    if (req.file) {
        const base64 = req.file.buffer.toString("base64");
        imageUrl = `data:${req.file.mimetype};base64,${base64}`;
    }

    const pool = appService.getDatabasePool();
    const userId = appService.getSessionUser(req);

    try {
        // If the user give us a isbn code, check if exist
        if (isbn) {
            const existIsbn = await pool.query(
                'SELECT id FROM books WHERE isbn = $1 AND user_id = $2',
                [isbn, userId]
            );
            if (existIsbn.rowCount == 1) {
                return res.status(404).send("Book with provided ISBN code already exist");
            }
        }

        const insertBook = await pool.query(
            "INSERT INTO books (name, description, image_url, isbn, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [name, description, imageUrl, isbn, userId]
        );

        const bookId = insertBook.rows[0].id;

        /************************************************************
         * LOCATION
         * Try to add the book to a location
         * *********************************************************/
        await __automaticallyAddBookToLocation(pool, bookId, userId);

        res.status(200).json(bookId);
    } catch (error) {
        // Rollback on error
        console.error("Transaction error:", error);
        res.status(500).send("Error adding book");
    }
});

/**
 * POST /book/isbn/:isbn
 * ---------------------
 * Create a book automatically by looking up its metadata from an ISBN,
 * instead of typing everything in by hand.
 *
 * Lookup order: Google Books API (needs `GOOGLE_BOOKS_API_KEY`) -> on
 * failure/missing key, falls back to Open Library's search API for metadata
 * and to its covers API for the image. Categories/authors/language rows are
 * created on the fly if they don't already exist for this user
 * (`__ensureCategory`, `__ensureAuthors`, `ensureLanguage`).
 *
 * Auth: required.
 * Path param: `isbn` {string} - required.
 * Body (optional): { "location": "3" }  // location id to place the new stock in;
 *   if omitted, falls back to the "exactly one location" auto-assign rule.
 *
 * Example request:
 *   POST /api/rest/book/isbn/9780261102217
 *   { "location": "2" }
 *
 * Response (200): the new (or already-existing, matched by isbn) book's id, e.g. `42`.
 * Responses (404): "No ISBN code provided" | "Book not found" (no metadata match).
 * Response (502): "External book service failed" (Google/Open Library request failed).
 */
// @ts-ignore
router.post(
    '/isbn/:isbn',
    requireAuth,
    async (req: Request, res: Response) => {
        const isbnCode = normalizeAndValidateIsbn(req.params.isbn);
        if (!isbnCode) {
            return res.status(400).send('No ISBN code provided');
        }

        const locationId: string | null = req.body.location;
        const userId = appService.getSessionUser(req);

        try {
            /**
             * =========================
             * FETCH BOOK (Google → fallback OpenLibrary)
             * =========================
             */
            const bookData = await fetchBookData(isbnCode);

            if (!bookData) {
                return res.status(404).send('Book not found');
            }

            const {
                title: name,
                authors,
                description,
                categories,
                publisher,
                publishedDate,
                pageCount: pages,
                language,
                imageLinks,
            } = bookData;

            // books.name is NOT NULL - without a title there's nothing to insert.
            if (!name) {
                return res.status(404).send('Book not found');
            }

            const formattedPublishedDate = formatPublishedDate(publishedDate);

            /**
             * IMAGE (Google → Open Library → LibraryThing fallback)
             */
            const imageUrl = await resolveCoverImageUrl(isbnCode, imageLinks?.thumbnail);

            const categoryName = truncate(categories?.[0] ?? null, 100);
            const languageCode = normalizeLanguageCode(language);

            /**
             * =========================
             * DATABASE TRANSACTION ONLY
             * =========================
             */
            const pool = appService.getDatabasePool();
            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                /**
                 * LANGUAGE
                 */
                await ensureLanguage(client, languageCode);

                /**
                 * CATEGORY
                 */
                const categoryId = await __ensureCategory(
                    client,
                    categoryName,
                    userId
                );

                /**
                 * BOOK
                 */
                const bookId = await __getOrCreateBook(
                    client,
                    {
                        name: truncate(name, 255),
                        description,
                        imageUrl,
                        isbnCode,
                        categoryId,
                        publisher: truncate(publisher, 100),
                        formattedPublishedDate,
                        languageCode,
                        pages,
                    },
                    userId
                );

                /**
                 * AUTHORS
                 */
                if (authors?.length) {
                    await __ensureAuthors(
                        client,
                        bookId,
                        authors.map((author: string) => truncate(author, 100)),
                        userId
                    );
                }

                /**
                 * LOCATION
                 */
                if (locationId) {
                    await __addBookToLocation(
                        client,
                        bookId,
                        locationId,
                        userId
                    );
                } else {
                    await __automaticallyAddBookToLocation(
                        client,
                        bookId,
                        userId
                    );
                }

                await client.query('COMMIT');
                res.status(200).json(bookId);
            } catch (dbError) {
                await client.query('ROLLBACK');
                console.error('DB transaction error:', dbError);
                return res
                    .status(500)
                    .send('Error processing book in database');
            } finally {
                client.release();
            }
        } catch (error: unknown) {
            console.error('Error fetching book details:', error);

            if (axios.isAxiosError(error)) {
                return res.status(502).send('External book service failed');
            }

            return res
                .status(500)
                .send('Unexpected server error');
        }
    }
);

/**
 * =========================================================
 * EXTERNAL API: GOOGLE BOOKS (with retry + backoff)
 * =========================================================
 */
/**
 * Fetch volume metadata for `isbn` from the Google Books API, retrying up to
 * `retries` times with linear backoff on HTTP 429 (rate limited). If the
 * request ultimately fails for any other reason (missing API key, network
 * error, no match), falls back to `__fetchOpenLibraryMetadata`.
 */
async function fetchBookData(isbn: string, retries = 3): Promise<any> {
    try {
        const apiKey = appService.getGoogleApiKey();
        if (!apiKey) {
            throw new Error("Missing GOOGLE_BOOKS_API_KEY");
        }

        const { data } = await axios.get(
            'https://www.googleapis.com/books/v1/volumes',
            {
                params: {
                    q: `isbn:${isbn}`,
                    key: apiKey
                },
                timeout: 9000,
                headers: {
                    'User-Agent': 'vaultisse-server/1.0',
                },
            },
        );

        const volumeInfo = data?.items?.[0]?.volumeInfo;

        // Google's isbn: search doesn't index every edition (e.g. no-preview
        // volumes); a clean empty result still needs the fallback, not just errors.
        if (!volumeInfo) {
            return __fetchOpenLibraryMetadata(isbn);
        }

        return volumeInfo;
    } catch (error: unknown) {
        if (
            axios.isAxiosError(error) &&
            error.response?.status === 429 &&
            retries > 0
        ) {
            const delay = (4 - retries) * 1000;

            await new Promise(r => setTimeout(r, delay));

            return fetchBookData(isbn, retries - 1);
        }

        console.warn('Google Books failed, trying fallback...', error);
        return __fetchOpenLibraryMetadata(isbn);
    }
}

/**
 * =========================================================
 * FALLBACK: OPEN LIBRARY METADATA
 * =========================================================
 */
async function __fetchOpenLibraryMetadata(isbn: string): Promise<any> {
    try {
        const { data } = await axios.get(
            `https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}`,
            { timeout: 9000 }
        );

        // The search endpoint returns matches under `docs`, not on the top-level object.
        const doc = data?.docs?.[0];

        if (!doc) {
            return null;
        }

        return {
            title: doc.title,
            authors: doc.author_name ?? [],
            description: undefined,
            categories: doc.subject ?? [],
            publisher: doc.publisher?.[0],
            publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
            pageCount: doc.number_of_pages_median,
            language: doc.language?.[0],
            imageLinks: null,
        };
    } catch (error) {
        console.error('OpenLibrary fallback failed:', error);
        return null;
    }
}

/**
 * =========================================================
 * OPEN LIBRARY COVER
 * =========================================================
 */
async function fetchOpenLibraryCover(isbn: string): Promise<string | null> {
    try {
        const url = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg`;

        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 3000,
        });

        const contentType = String(res.headers['content-type'] ?? '');

        if (res.status === 200 && contentType.startsWith('image/')) {
            return url;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * =========================================================
 * LIBRARYTHING COVER (third fallback, needs a devkey)
 * =========================================================
 */
/**
 * Unlike Open Library, LibraryThing responds 200 with a real image
 * Content-Type even when it has no cover for the ISBN - it serves a
 * transparent 1x1 GIF placeholder instead of a 404 (its API is meant to be
 * embedded directly in an <img src> without a pre-check). A real cover is
 * always far larger, so the placeholder is filtered out by size instead.
 */
const LIBRARYTHING_PLACEHOLDER_MAX_BYTES = 1000;

async function fetchLibraryThingCover(isbn: string, apiKey: string): Promise<string | null> {
    try {
        const url = `https://covers.librarything.com/devkey/${encodeURIComponent(apiKey)}/large/isbn/${encodeURIComponent(isbn)}`;

        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 3000,
        });

        const contentType = String(res.headers['content-type'] ?? '');
        const byteLength = res.data?.length ?? 0;

        if (res.status === 200 && contentType.startsWith('image/') && byteLength > LIBRARYTHING_PLACEHOLDER_MAX_BYTES) {
            return url;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * =========================================================
 * COVER LOOKUP (Google → Open Library → LibraryThing)
 * =========================================================
 * Shared by `POST /book/isbn/:isbn` (new book) and `POST /book/:id/cover/find`
 * (existing book) so the fallback order only lives in one place.
 */
async function resolveCoverImageUrl(isbn: string, googleThumbnail: string | null | undefined): Promise<string | null> {
    if (googleThumbnail) {
        return googleThumbnail;
    }

    const openLibraryCover = await fetchOpenLibraryCover(isbn);
    if (openLibraryCover) {
        return openLibraryCover;
    }

    const libraryThingApiKey = appService.getLibraryThingApiKey();
    if (libraryThingApiKey) {
        return fetchLibraryThingCover(isbn, libraryThingApiKey);
    }

    return null;
}

/**
 * =========================================================
 * DB HELPERS
 * =========================================================
 */
/**
 * Truncates a string to fit a VARCHAR(maxLen) column instead of letting
 * Postgres reject the whole insert with "value too long for type character varying".
 */
function truncate(value: string | null | undefined, maxLen: number): string | null {
    if (value === null || value === undefined) return null;
    return value.length > maxLen ? value.substring(0, maxLen) : value;
}

/**
 * languages.code / books.language_code are CHAR(2) and optional, so any value
 * that isn't a clean 2-letter code (missing, "unknown", ISO 639-2 3-letter
 * codes, etc.) is dropped instead of overflowing the column.
 */
function normalizeLanguageCode(language: string | null | undefined): string | null {
    if (!language) return null;
    const code = language.trim().toLowerCase();
    return /^[a-z]{2}$/.test(code) ? code : null;
}

/**
 * Insert a `languages` row for `code` if one doesn't exist yet (name defaults
 * to the code itself, e.g. "en" - can be renamed later via the settings UI).
 */
async function ensureLanguage(client: any, code: string | null) {
    if (!code) return;

    const result = await client.query(
        'SELECT code FROM languages WHERE code = $1',
        [code]
    );

    if (result.rowCount === 0) {
        await client.query(
            'INSERT INTO languages (code, name) VALUES ($1, $2)',
            [code, code]
        );
    }
}

/**
 * Find-or-create a category by name for this user. Returns `null` if `name`
 * is falsy (a book without a detected category is left uncategorized).
 */
async function __ensureCategory(
    client: any,
    name: string | null,
    userId: number
): Promise<number | null> {
    if (!name) return null;

    const result = await client.query(
        'SELECT id FROM categories WHERE name = $1 AND user_id = $2',
        [name, userId]
    );

    if (result.rowCount > 0) {
        return result.rows[0].id;
    }

    const insert = await client.query(
        'INSERT INTO categories (name, user_id) VALUES ($1, $2) RETURNING id',
        [name, userId]
    );

    return insert.rows[0].id;
}

/**
 * Find-or-create a book by ISBN for this user, so re-scanning the same ISBN
 * never creates a duplicate. Returns the book id either way.
 */
async function __getOrCreateBook(client: any, book: any, userId: number) {
    const existing = await client.query(
        'SELECT id FROM books WHERE isbn = $1 AND user_id = $2',
        [book.isbnCode, userId]
    );

    if (existing.rowCount > 0) {
        return existing.rows[0].id;
    }

    const insert = await client.query(
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

    return insert.rows[0].id;
}

/**
 * Find-or-create each author by name for this user, then link them all to
 * `bookId` in `book_authors` (idempotent via ON CONFLICT DO NOTHING).
 */
async function __ensureAuthors(
    client: any,
    bookId: number,
    authors: string[],
    userId: number
) {
    for (const author of authors) {
        const result = await client.query(
            'SELECT id FROM authors WHERE name = $1 AND user_id = $2',
            [author, userId]
        );

        let authorId: number;

        if (result.rowCount === 0) {
            const insert = await client.query(
                'INSERT INTO authors (name, user_id) VALUES ($1,$2) RETURNING id',
                [author, userId]
            );
            authorId = insert.rows[0].id;
        } else {
            authorId = result.rows[0].id;
        }

        await client.query(
            `INSERT INTO book_authors (book_id, author_id, user_id)
             VALUES ($1,$2,$3)
             ON CONFLICT DO NOTHING`,
            [bookId, authorId, userId]
        );
    }
}

/**
 * Create a single "available" (status 0) stock entry for `bookId` at
 * `locationId`, silently doing nothing if the location doesn't belong to
 * `userId`. Used by the ISBN auto-create flow when a location is supplied.
 */
async function __addBookToLocation(
    client: any,
    bookId: number,
    locationId: string,
    userId: number
) {
    const exist = await client.query(
        'SELECT id FROM locations WHERE id = $1 AND user_id = $2',
        [locationId, userId]
    );

    if (exist.rowCount !== 1) return;

    const code = await generateBookStockCode();

    await client.query(
        `INSERT INTO book_stocks
         (book_id, code, status, location_id, customer_id, user_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [bookId, code, 0, locationId, null, userId]
    );
}

/**
 * POST /book/:id/stock
 * ---------------------
 * Add a new physical copy (stock) of a book at a location.
 *
 * Auth: required. Path param `id` {number} - book id.
 * Body:
 *  {
 *    "status": 0,            // 0 = available, 1 = sold/loaned, 2 = booked (not allowed here - use PUT stock instead)
 *    "location_id": 2,       // required, must belong to the caller
 *    "customer_id": null     // optional, sets the copy as already held by a customer
 *  }
 *
 * A unique 10-character stock `code` is generated server-side (see `generateBookStockCode`).
 *
 * Example request: POST /api/rest/book/12/stock  { "status": 0, "location_id": 2 }
 *
 * Example response (200):
 *  { "id": 5, "code": "a1b2c3d4e5", "status": 0, "location_id": 2,
 *    "location_name": "Main shelf", "customer_id": null, "customer_name": null }
 *
 * Responses: 404 "Location not found" | 406 if status is "booked" (2) | 500 on failure.
 */
// @ts-ignore
router.post('/:id/stock', requireAuth, async (req: Request, res: Response) => {
    const bookId = req.params.id;
    const status = req.body.status;
    const customerId = req.body.customer_id;
    const locationId = req.body.location_id;
    if (!bookId) {
        return res.status(400).send('No book ID provided');
    }

    const BOOKED_STATUS = 2;
    if (status == BOOKED_STATUS) {
        return res.status(406).send('Status "booked" not allowed in add stock action');
    }

    const pool = appService.getDatabasePool();
    const client = await pool.connect();

    const userId = appService.getSessionUser(req);

    try {
        const existLocation = await pool.query(
            'SELECT id FROM locations WHERE id = $1 AND user_id =$2',
            [locationId, userId]
        );
        if (existLocation.rowCount != 1) {
            return res.status(404).send("Location not found");
        }

        if (customerId) {
            const existCustomer = await pool.query(
                'SELECT id FROM customers WHERE id = $1 AND user_id = $2',
                [customerId, userId]
            );
            if (existCustomer.rowCount != 1) {
                return res.status(404).send("Customer not found");
            }
        }

        appService.getLogger().debug(`Adding book stock with status ${status} in book id: ${bookId}`);
        await client.query("BEGIN");

        const code = await generateBookStockCode();

        const insertStock = await client.query(
            "INSERT INTO book_stocks (book_id, code, status, location_id, customer_id, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
            [bookId, code, status, locationId, customerId, userId]
        );

        await client.query("COMMIT");

        // fetch new data
        const result = await pool.query(
            `SELECT book_stocks.id,
                    book_stocks.code,
                    book_stocks.status,
                    book_stocks.location_id,
                    locations.name as location_name,
                    customers.id   as customer_id,
                    customers.name as customer_name
             FROM book_stocks
                      LEFT JOIN customers ON book_stocks.customer_id = customers.id AND customers.user_id = $2
                      LEFT JOIN locations ON book_stocks.location_id = locations.id
             WHERE book_stocks.id = $1
               AND book_stocks.user_id = $2
            `,
            [insertStock.rows[0].id, userId]
        );


        res.status(200).json(result.rows[0]);
    } catch (error) {
        // Rollback on error
        await client.query("ROLLBACK");
        console.error("Transaction error:", error);
        res.status(500).send("Error adding the book stock");
    } finally {
        client.release();
    }
});

/**
 * DELETE /book/:id/stock/:stock_id
 * ----------------------------------
 * Remove a single physical copy of a book.
 *
 * Auth: required. Path params: `id` {number} book id, `stock_id` {number} stock id.
 *
 * Example request: DELETE /api/rest/book/12/stock/5
 *
 * Response (200): boolean - `true` if a row was deleted, `false` otherwise.
 */
// @ts-ignore
router.delete('/:id/stock/:stock_id', requireAuth, async (req: Request, res: Response) => {
    const bookId = req.params.id;
    const stockId = req.params.stock_id;
    if (!bookId || !stockId) {
        return res.status(400).send('No book ID or stock ID provided');
    }

    const userId = appService.getSessionUser(req);

    const pool = appService.getDatabasePool();

    try {
        appService.getLogger().debug(`Removing book stock with status ${stockId} and book id: ${bookId}`);

        const deleteQueryResult = await pool.query(
            'DELETE FROM book_stocks WHERE book_id = $1 AND id = $2 AND user_id = $3',
            [bookId, stockId, userId]
        );

        res.status(200).json(deleteQueryResult.rowCount === 1);
    } catch (error) {
        // Rollback on error
        console.error("Transaction error:", error);
        res.status(500).send("Error deleting the book stock");
    }
});

/**
 * PUT /book/:id/stock/:stock_id
 * -------------------------------
 * Update a physical copy's status, location and/or assigned customer -
 * e.g. moving it to a different shelf, marking it sold/booked, or
 * assigning/clearing the customer it's checked out to.
 *
 * Auth: required. Path params: `id` {number} book id, `stock_id` {number} stock id.
 * Body:
 *  { "status": 2, "location_id": 2, "customer_id": 7 }
 *
 * Example request: PUT /api/rest/book/12/stock/5
 *
 * Example response (200):
 *  { "id": 5, "code": "a1b2c3d4e5", "status": 2, "location_id": 2,
 *    "location_name": "Main shelf", "customer_id": 7, "customer_name": "Jane Doe" }
 *
 * Response (404): "Location not found" if `location_id` doesn't belong to the caller.
 */
// @ts-ignore
router.put('/:id/stock/:stock_id', requireAuth, async (req: Request, res: Response) => {
    const bookId = req.params.id;
    const stockId = req.params.stock_id;
    if (!bookId || !stockId) {
        return res.status(400).send('No book ID or stock ID provided');
    }

    const userId = appService.getSessionUser(req);

    // Body params
    const {
        status,
        location_id,
        customer_id
    } = req.body;

    const pool = appService.getDatabasePool();

    try {
        appService.getLogger().debug(`Updating book stock ${stockId}`);

        const existLocation = await pool.query(
            'SELECT id FROM locations WHERE id = $1 AND user_id = $2',
            [location_id, userId]
        );
        if (existLocation.rowCount != 1) {
            return res.status(404).send("Location not found");
        }

        if (customer_id) {
            const existCustomer = await pool.query(
                'SELECT id FROM customers WHERE id = $1 AND user_id = $2',
                [customer_id, userId]
            );
            if (existCustomer.rowCount != 1) {
                return res.status(404).send("Customer not found");
            }
        }

        // Needed to detect a status transition into/out of "booked" below,
        // since loan_history (unlike loaned_at) can't be updated in the same
        // statement as book_stocks.
        const previousStock = await pool.query(
            'SELECT status FROM book_stocks WHERE id = $1 AND book_id = $2 AND user_id = $3',
            [stockId, bookId, userId]
        );
        const previousStatus = previousStock.rows[0]?.status;

        // loaned_at is set only on the transition *into* booked (status wasn't
        // already 2) and cleared on any transition out of it, so re-saving an
        // already-booked stock (e.g. just moving its location) doesn't reset
        // its loan date.
        const queryResult = await pool.query(
            // $1::smallint - book_stocks.status is SMALLINT, but $1 is also
            // compared against the bare integer literal `2` below; without
            // an explicit cast, Postgres can't decide which type to infer
            // for $1 and rejects the whole statement (42P08 "inconsistent
            // types deduced for parameter $1: integer versus smallint").
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
            [status, location_id, customer_id, bookId, stockId, userId]
        );

        if (queryResult.rowCount != 1) {
            res.status(500).send();
        }

        const stockQueryResult = await pool.query(
            `SELECT book_stocks.id,
                    book_stocks.code,
                    book_stocks.status,
                    book_stocks.location_id,
                    locations.name as location_name,
                    customers.id   as customer_id,
                    customers.name as customer_name
             FROM book_stocks
                      LEFT JOIN customers ON book_stocks.customer_id = customers.id AND customers.user_id = $2
                      LEFT JOIN locations ON book_stocks.location_id = locations.id
             WHERE book_stocks.id = $1
               AND book_stocks.user_id = $2
            `,
            [stockId, userId]
        );

        const updatedStock = stockQueryResult.rows[0];
        const newStatus = Number(status);
        if (updatedStock && Number(previousStatus) !== 2 && newStatus === 2) {
            await recordLoan(pool, userId, updatedStock.code, Number(customer_id));
        } else if (updatedStock && Number(previousStatus) === 2 && newStatus !== 2) {
            await recordReturn(pool, userId, updatedStock.code);
        }

        res.status(200).json(stockQueryResult.rows[0]);
    } catch (error) {
        // Rollback on error
        console.error("Transaction error:", error);
        res.status(500).send("Error deleting the book stock");
    }
});

/**
 * GET /book/:bookCode/add/md
 * ----------------------------
 * Look up the book + single stock behind a scanned/typed stock code, for the
 * "add to customer" flow (e.g. scanning a barcode when lending/selling a copy).
 *
 * Auth: required. Path param `bookCode` {string} - a book_stocks.code value.
 *
 * Example request: GET /api/rest/book/a1b2c3d4e5/add/md
 *
 * Example response (200), shape `IBookAddMd`:
 *  {
 *    "id": 12, "name": "The Hobbit", "image_url": "https://...", "isbn": "9780261102217",
 *    "stocks": [{ "id": 5, "code": "a1b2c3d4e5", "status": 0 }]
 *  }
 *
 * Response (404): "Book stock not found".
 */
// @ts-ignore
router.get('/:bookCode/add/md', requireAuth, async (req: Request, res: Response) => {
    const bookCode = String(req.params.bookCode).trim();
    const userId = appService.getSessionUser(req);

    const pool = appService.getDatabasePool();

    try {
        // 1. Try to match a stock code
        const stockResult = await pool.query(
            `
                SELECT b.id    AS book_id,
                       b.name,
                       b.image_url,
                       b.isbn,
                       bs.id   AS stock_id,
                       bs.code AS stock_code,
                       bs.status
                FROM book_stocks bs
                         INNER JOIN books b ON b.id = bs.book_id
                WHERE bs.code = $1
                  AND bs.user_id = $2 LIMIT 1
            `,
            [bookCode, userId]
        );

        if (stockResult.rows.length == 0) {
            return res.status(404).send("Book stock not found");
        }

        const row = stockResult.rows[0];
        const response: IBookAddMd = {
            id: row.book_id,
            name: row.name,
            image_url: row.image_url,
            isbn: row.isbn,
            stocks: [
                {
                    id: row.stock_id,
                    code: row.stock_code,
                    status: row.status
                }
            ]
        };
        return res.status(200).json(response);
    } catch (error) {
        console.error("Transaction error:", error);
        res.status(500).send("Error retrieving the book data");
    }
});

/**
 * POST /book/return
 * -------------------
 * Bulk-return one or more book stocks: clears their `customer_id` and
 * resets their `status` back to 0 (available). Used e.g. when a customer
 * brings back several borrowed books at once.
 *
 * Auth: required.
 * Body: { "books": ["a1b2c3d4e5", "f6g7h8i9j0"] }  // array of book_stocks.code
 *
 * Example request: POST /api/rest/book/return  { "books": ["a1b2c3d4e5"] }
 *
 * Response: 200 (empty body) on success, 500 on failure.
 */
// @ts-ignore
router.post('/return', requireAuth, upload.single("image"), handleUploadError(maxCoverImageSizeMb), async (req: Request, res: Response) => {
    const books: string[] = req.body.books;
    const pool = appService.getDatabasePool();
    const userId = appService.getSessionUser(req);

    try {
        for (const bookStockCode of books) {
            await pool.query(
                'UPDATE book_stocks SET customer_id = $1, status = $2, loaned_at = NULL WHERE code = $3 AND user_id = $4',
                [null, 0, bookStockCode, userId]
            );
            await recordReturn(pool, userId, bookStockCode);
        }

        res.status(200).send();
    } catch (error) {
        // Rollback on error
        console.error("Transaction error:", error);
        res.status(500).send("Error returning books");
    }
});

// Helper function to format date to YYYY-MM-DD
// Hosts our ISBN metadata lookups (Google Books, Open Library, LibraryThing
// covers) are allowed to point book cover images at.
const ALLOWED_IMAGE_HOSTS = new Set([
    'books.google.com',
    'covers.openlibrary.org',
    'covers.librarything.com',
]);

/**
 * Only allow images we generated ourselves (data: URIs from the upload
 * endpoints) or ones from the known ISBN metadata providers. Without this,
 * a client could set books.image_url to any external URL, which the app
 * would then load as an <img src> - a tracking-pixel / IP-disclosure vector,
 * and it makes the CSP imgSrc allowlist meaningless.
 *
 * Exported so `ImportRoute.ts` can apply the exact same rule to a
 * user-supplied cover in an import CSV, rather than keeping a second copy of
 * a security-relevant allowlist that could silently drift from this one.
 */
export function isAllowedImageUrl(url: string): boolean {
    if (url.startsWith('data:image/png;base64,') || url.startsWith('data:image/jpeg;base64,')) {
        return true;
    }
    try {
        const parsed = new URL(url);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
            && ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
}

function formatPublishedDate(date: string | undefined): string | null {
    if (!date) return null;

    // Attempt to parse the date and format it to YYYY-MM-DD
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
        return null; // Return null if the date is invalid
    }

    // Return the date in the format YYYY-MM-DD
    return parsedDate.toISOString().split('T')[0];
}

/**
 * Generate a random 10-character alphanumeric code for a new book stock
 * (used as the human-scannable/typeable identifier), retrying until it
 * doesn't collide with an existing `book_stocks.code`. Exported for
 * `ImportRoute.ts`, which creates stocks too (one per Goodreads custom
 * shelf) using the exact same scheme as every other stock in the app.
 */
export async function generateBookStockCode(): Promise<string> {
    let code: string = "";
    let isUnique = false;

    const pool = appService.getDatabasePool();


    while (!isUnique) {
        // Generate a random 10-character code
        code = uuidv4().replace(/-/g, '').substring(0, 10);

        // Check if the code already exists
        const {rowCount} = await pool.query(
            "SELECT 1 FROM book_stocks WHERE code = $1",
            [code]
        );

        if (rowCount === 0) {
            isUnique = true;
        }
    }

    return code;
}

/**
 * Try to automatically create a book stock if user has only one location
 * @param client
 * @param bookId
 * @param userId
 */
async function __automaticallyAddBookToLocation(client: Pool | PoolClient, bookId: number, userId: number) {

    const locations = await client.query(`
        SELECT id
        FROM locations
        WHERE user_id = $1
    `, [userId]);

    if (locations.rowCount != null && locations.rowCount == 1) {
        const locationId = locations.rows[0].id;

        const code = await generateBookStockCode();

        await client.query(
            "INSERT INTO book_stocks (book_id, code, location_id, user_id) VALUES ($1, $2, $3, $4)",
            [bookId, code, locationId, userId]
        );
    }
}

export default router;