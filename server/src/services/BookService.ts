import {Pool, PoolClient} from "pg";
import {BookRepository} from "../repositories/BookRepository";
import {AuthorRepository} from "../repositories/AuthorRepository";
import {LocationRepository} from "../repositories/LocationRepository";
import {CustomerRepository} from "../repositories/CustomerRepository";
import {BookMetadataRepository} from "../repositories/BookMetadataRepository";
import {LoanHistoryRepository} from "../repositories/LoanHistoryRepository";
import {withTransaction} from "../repositories/withTransaction";
import {IsbnVerification} from "../utils/IsbnVerification";
import {FileSignature} from "../utils/FileSignature";
import {ReadingStatusEnum} from "../types/book/IReadingStatus";
import {IBookAddMd} from "../types/book/IBookAddMd";
import {
    BookCounters,
    BookDetail,
    BookFileForDownload,
    BookFileMeta,
    BookSearchFilter,
    BookSearchResult,
    BookStockDetail,
    IsbnBookInput,
} from "../types/book";
import {NotAcceptableError, NotFoundError, ValidationError} from "../errors/DomainError";

// Hosts our ISBN metadata lookups (Google Books, Open Library, LibraryThing
// covers) are allowed to point book cover images at.
const ALLOWED_IMAGE_HOSTS = new Set([
    'books.google.com',
    'covers.openlibrary.org',
    'covers.librarything.com',
]);

/** Business rules for the Book resource. Calls BookRepository (+ AuthorRepository/LocationRepository/CustomerRepository/LoanHistoryRepository for cross-resource checks and BookMetadataRepository for ISBN lookups); throws DomainError subclasses for expected failures. */
export class BookService {
    /**
     * @param pool Database connection pool, forwarded to fresh repositories on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /* ---------- Search / counters ---------- */

    /**
     * Paginated/filterable/sortable book search.
     * @param userId Owning user's id.
     * @param filter Search query, category/status filters, date range, sort and page.
     * @returns The total matching row count, the page size, and this page's books.
     */
    public async searchBooks(userId: number, filter: BookSearchFilter): Promise<{total: number; limit: number; books: BookSearchResult[]}> {
        const MAX_ROWS = 50;
        const {total, books} = await new BookRepository(this.pool).search(userId, filter);
        return {total, limit: MAX_ROWS, books};
    }

    /**
     * KPI counters for the Books view.
     * @param userId Owning user's id.
     * @returns Every counter.
     */
    public async getCounters(userId: number): Promise<BookCounters> {
        return new BookRepository(this.pool).getCounters(userId);
    }

    /* ---------- Single book CRUD ---------- */

    /**
     * Full detail for one book, throwing NotFoundError if it doesn't belong to the caller.
     * @param id Book id.
     * @param userId Owning user's id.
     * @returns The book detail.
     */
    public async getBookDetail(id: number, userId: number): Promise<BookDetail> {
        const book = await new BookRepository(this.pool).findDetailById(id, userId);
        if (!book) {
            throw new NotFoundError("Book not found");
        }
        return book;
    }

    /**
     * Updates a book's editable fields and author links.
     * @param id Book id.
     * @param userId Owning user's id.
     * @param fields New field values, plus the full desired author-id list.
     */
    public async updateBook(
        id: number,
        userId: number,
        fields: {
            name: string; image_url: string | null; isbn: string | null; category_id: number | null;
            language_code: string | null; authors?: number[]; description: string | null;
            publisher: string | null; published_date: string | null; pages: number | null;
            format_id: number | null; reading_status: ReadingStatusEnum | null;
        }
    ): Promise<void> {
        if (fields.image_url && !BookService.isAllowedImageUrl(fields.image_url)) {
            throw new ValidationError("Invalid image URL");
        }
        if (fields.reading_status != null && ![ReadingStatusEnum.WANT_TO_READ, ReadingStatusEnum.CURRENTLY_READING, ReadingStatusEnum.READ].includes(fields.reading_status)) {
            throw new ValidationError("Invalid reading status");
        }

        const repo = new BookRepository(this.pool);
        const found = await repo.exists(id, userId);
        if (!found) {
            throw new NotFoundError("Book not found");
        }

        await repo.updateFields(id, userId, fields);

        if (fields.authors && Array.isArray(fields.authors)) {
            const existingAuthors = await repo.getAuthorIds(id);
            const authorsToRemove = existingAuthors.filter((authorId) => !fields.authors!.includes(authorId));
            const authorsToAdd = fields.authors.filter((authorId) => !existingAuthors.includes(authorId));

            for (const authorId of authorsToRemove) {
                await repo.removeAuthorLink(id, authorId, userId);
            }

            for (const authorId of authorsToAdd) {
                const authorOk = await new AuthorRepository(this.pool).exists(authorId, userId);
                if (authorOk) {
                    await repo.addAuthorLink(id, authorId, userId);
                } else {
                    console.warn(`Author with ID ${authorId} not found, skipping association.`);
                }
            }
        }
    }

    /**
     * Deletes a book, throwing NotFoundError if it doesn't belong to the caller.
     * @param id Book id.
     * @param userId Owning user's id.
     */
    public async deleteBook(id: number, userId: number): Promise<void> {
        const repo = new BookRepository(this.pool);
        const found = await repo.exists(id, userId);
        if (!found) {
            throw new NotFoundError("Book not found");
        }
        await repo.remove(id, userId);
    }

    /* ---------- Cover image ---------- */

    /**
     * Sets a book's cover image from an uploaded file.
     * @param id Book id.
     * @param userId Owning user's id.
     * @param file Uploaded image file, or undefined to clear the cover.
     * @returns Rows affected.
     */
    public async updateBookImage(id: number, userId: number, file: Express.Multer.File | undefined): Promise<number> {
        let imageUrl = "";
        if (file) {
            const base64 = file.buffer.toString("base64");
            imageUrl = `data:${file.mimetype};base64,${base64}`;
        }
        return new BookRepository(this.pool).updateImageUrl(id, userId, imageUrl);
    }

    /**
     * Looks up and sets a book's cover from its ISBN via BookMetadataRepository.
     * @param id Book id.
     * @param userId Owning user's id.
     * @param libraryThingApiKey Optional LibraryThing API key, for the cover fallback.
     * @returns The resolved cover image URL.
     */
    public async findBookCover(id: number, userId: number, libraryThingApiKey: string | undefined): Promise<string> {
        const repo = new BookRepository(this.pool);
        const isbn = await repo.getIsbn(id, userId);
        if (isbn === undefined) {
            throw new NotFoundError("Book not found");
        }

        const isbnCode = IsbnVerification.normalizeAndValidateIsbn(isbn ?? "");
        if (!isbnCode) {
            throw new ValidationError("Book has no ISBN");
        }

        const imageUrl = await BookMetadataRepository.resolveBookCover({isbn: isbnCode, libraryThingApiKey});
        if (!imageUrl) {
            throw new NotFoundError("No cover found for this book");
        }

        await repo.updateImageUrl(id, userId, imageUrl);
        return imageUrl;
    }

    /* ---------- Ebook file backups ---------- */

    /**
     * Maps a filename's extension to the `book_files.file_type` it should be stored as.
     * @param fileName Original uploaded file name.
     * @returns The stored file type.
     */
    private fileTypeFromName(fileName: string): "epub" | "pdf" | "mobi" {
        const name = fileName.toLowerCase();
        if (name.endsWith(".epub")) return "epub";
        if (name.endsWith(".pdf")) return "pdf";
        return "mobi"; // .mobi or .azw3 - already enforced by the route's multer fileFilter.
    }

    /**
     * Validates and stores an uploaded ebook file, replacing any existing file of the same type.
     * @param id Book id.
     * @param userId Owning user's id.
     * @param file Uploaded file.
     * @returns The stored file's metadata.
     */
    public async uploadBookFile(id: number, userId: number, file: Express.Multer.File | undefined): Promise<BookFileMeta> {
        if (!file) {
            throw new ValidationError("No file provided");
        }

        const fileType = this.fileTypeFromName(file.originalname);

        // Trust the actual bytes, not just the file name (which the route's fileFilter
        // only checked by extension - trivially spoofed by renaming any file).
        const isValidContent = fileType === "epub" ? FileSignature.isValidEpub(file.buffer)
            : fileType === "pdf" ? FileSignature.isValidPdf(file.buffer)
                : FileSignature.isValidMobi(file.buffer);
        if (!isValidContent) {
            throw new ValidationError("File content does not match a valid EPUB, PDF or Kindle file");
        }

        const repo = new BookRepository(this.pool);
        const found = await repo.exists(id, userId);
        if (!found) {
            throw new NotFoundError("Book not found");
        }

        return repo.upsertFile(id, userId, fileType, file.originalname, file.size, file.buffer);
    }

    /**
     * Looks up one ebook file's bytes for download, throwing NotFoundError if it doesn't exist.
     * @param id Book id.
     * @param fileId File id.
     * @param userId Owning user's id.
     * @returns The file's bytes/name/type.
     */
    public async downloadBookFile(id: number, fileId: number, userId: number): Promise<BookFileForDownload> {
        const file = await new BookRepository(this.pool).findFileForDownload(id, fileId, userId);
        if (!file) {
            throw new NotFoundError("File not found");
        }
        return file;
    }

    /**
     * Deletes one ebook file.
     * @param id Book id.
     * @param fileId File id.
     * @param userId Owning user's id.
     * @returns Whether a matching file was found and deleted.
     */
    public async deleteBookFile(id: number, fileId: number, userId: number): Promise<boolean> {
        return new BookRepository(this.pool).deleteFile(id, fileId, userId);
    }

    /* ---------- Manual create ---------- */

    /**
     * Creates a minimal manually-entered book, then auto-places a stock if the caller has exactly one location.
     * @param userId Owning user's id.
     * @param fields Name/description/isbn and an optional cover upload.
     * @returns The new book's id.
     */
    public async createBook(
        userId: number,
        fields: {name: string; description: string; isbn: string; file: Express.Multer.File | undefined}
    ): Promise<number> {
        let imageUrl = "";
        if (fields.file) {
            const base64 = fields.file.buffer.toString("base64");
            imageUrl = `data:${fields.file.mimetype};base64,${base64}`;
        }

        const repo = new BookRepository(this.pool);

        if (fields.isbn) {
            const alreadyExists = await repo.isbnExists(fields.isbn, userId);
            if (alreadyExists) {
                // NOTE: the original route used 404 for this, not 409 - preserved
                // exactly even though it's a conflict, not a "not found".
                throw new NotFoundError("Book with provided ISBN code already exist");
            }
        }

        const bookId = await repo.insert(userId, {
            name: fields.name,
            description: fields.description,
            imageUrl,
            isbn: fields.isbn,
        });

        await this.automaticallyAddBookToLocation(bookId, userId);

        return bookId;
    }

    /**
     * Auto-places a fresh stock for a newly-created book at the caller's sole location, if they have exactly one.
     * @param bookId Book id.
     * @param userId Owning user's id.
     */
    private async automaticallyAddBookToLocation(bookId: number, userId: number): Promise<void> {
        const repo = new BookRepository(this.pool);
        const locationId = await repo.soleLocationId(userId);
        if (locationId === null) return;

        const code = await repo.generateStockCode();
        await repo.insertStockMinimal(bookId, code, locationId, userId);
    }

    /* ---------- ISBN auto-create ---------- */

    /**
     * Truncates a string to a maximum length.
     * @param value Value to truncate, or null/undefined.
     * @param maxLen Maximum length.
     * @returns The (possibly truncated) value, or null.
     */
    private truncate(value: string | null | undefined, maxLen: number): string | null {
        if (value === null || value === undefined) return null;
        return value.length > maxLen ? value.substring(0, maxLen) : value;
    }

    /**
     * Parses and reformats a looked-up published-date string to `YYYY-MM-DD`.
     * @param date Raw published-date string, if any.
     * @returns The formatted date, or null if unparseable/absent.
     */
    private formatPublishedDate(date: string | undefined): string | null {
        if (!date) return null;
        const parsedDate = new Date(date);
        if (isNaN(parsedDate.getTime())) {
            return null;
        }
        return parsedDate.toISOString().split('T')[0];
    }

    /**
     * Finds or creates a category by name.
     * @param name Category name, or null to no-op.
     * @param userId Owning user's id.
     * @returns The category id, or null if `name` was null.
     */
    private async ensureCategory(name: string | null, userId: number): Promise<number | null> {
        if (!name) return null;
        const repo = new BookRepository(this.pool);
        const existing = await repo.findCategoryByName(name, userId);
        if (existing !== null) return existing;
        return repo.insertCategory(name, userId);
    }

    /**
     * Finds a book by ISBN, overlaying fresh metadata onto it; otherwise inserts a new one.
     * @param book Looked-up book fields.
     * @param userId Owning user's id.
     * @returns The book id.
     */
    private async getOrCreateBook(book: IsbnBookInput, userId: number): Promise<number> {
        const repo = new BookRepository(this.pool);
        const existingId = await repo.findByIsbn(book.isbnCode, userId);
        if (existingId !== null) {
            await repo.fillEmptyFields(existingId, book, userId);
            return existingId;
        }
        return repo.insertFull(book, userId);
    }

    /**
     * Finds or creates each author by name and links them to a book.
     * @param bookId Book id.
     * @param authorNames Author names to ensure/link.
     * @param userId Owning user's id.
     */
    private async ensureAuthorsAndLink(bookId: number, authorNames: string[], userId: number): Promise<void> {
        const repo = new BookRepository(this.pool);
        for (const author of authorNames) {
            let authorId = await repo.findAuthorByName(author, userId);
            if (authorId === null) {
                authorId = await repo.insertAuthorRow(author, userId);
            }
            await repo.linkAuthorToBook(bookId, authorId, userId);
        }
    }

    /**
     * Places a fresh stock for a book at a specific location, if it belongs to the caller.
     * @param bookId Book id.
     * @param locationId Location id.
     * @param userId Owning user's id.
     */
    private async addBookToLocation(bookId: number, locationId: string, userId: number): Promise<void> {
        const repo = new BookRepository(this.pool);
        const exist = await repo.locationExistsForUser(locationId, userId);
        if (!exist) return;

        const code = await repo.generateStockCode();
        await repo.insertStockAtLocation(bookId, code, locationId, userId);
    }

    /**
     * Creates (or find-or-creates, by ISBN) a book from ISBN metadata. Mirrors
     * the original route's two-phase error handling: a fetch-phase failure and
     * a DB-transaction-phase failure produce different 500 messages, so both
     * are preserved as distinctly-worded thrown Errors for the controller to
     * relay verbatim.
     *
     * @param userId Owning user's id.
     * @param isbn Raw ISBN input.
     * @param locationId Location to place the new stock at, or null to auto-place.
     * @param googleApiKey Optional Google Books API key.
     * @param libraryThingApiKey Optional LibraryThing API key.
     * @returns The book id.
     */
    public async createBookFromIsbn(userId: number, isbn: string, locationId: string | null, googleApiKey: string | undefined, libraryThingApiKey: string | undefined): Promise<number> {
        const isbnCode = IsbnVerification.normalizeAndValidateIsbn(isbn);
        if (!isbnCode) {
            throw new ValidationError("No ISBN code provided");
        }

        let bookData;
        try {
            bookData = await BookMetadataRepository.fetchBookMetadata(isbnCode, googleApiKey, libraryThingApiKey);
        } catch (error: unknown) {
            console.error('Error fetching book details:', error);
            throw new Error('Unexpected server error');
        }

        if (!bookData) {
            throw new NotFoundError('Book not found');
        }

        const {title: name, authors, description, categories, publisher, publishedDate, pageCount: pages, language, imageLinks} = bookData;

        // books.name is NOT NULL - without a title there's nothing to insert.
        if (!name) {
            throw new NotFoundError('Book not found');
        }

        const formattedPublishedDate = this.formatPublishedDate(publishedDate);
        const imageUrl: string | null = imageLinks?.thumbnail ?? null;
        const categoryName = this.truncate(categories?.[0] ?? null, 100);
        const languageCode = BookMetadataRepository.normalizeLanguageCode(language);

        try {
            const repo = new BookRepository(this.pool);
            await repo.ensureLanguage(languageCode);
            const categoryId = await this.ensureCategory(categoryName, userId);

            const bookId = await this.getOrCreateBook({
                name: this.truncate(name, 255)!,
                description,
                imageUrl,
                isbnCode,
                categoryId,
                publisher: this.truncate(publisher, 100),
                formattedPublishedDate,
                languageCode,
                pages: pages && pages > 0 ? pages : null,
            }, userId);

            if (authors?.length) {
                await this.ensureAuthorsAndLink(
                    bookId,
                    authors.map((author: string) => this.truncate(author, 100)).filter((author): author is string => Boolean(author)),
                    userId
                );
            }

            if (locationId) {
                await this.addBookToLocation(bookId, locationId, userId);
            } else {
                await this.automaticallyAddBookToLocation(bookId, userId);
            }

            return bookId;
        } catch (dbError) {
            console.error('DB transaction error:', dbError);
            throw new Error('Error processing book in database');
        }
    }

    /* ---------- Stock lifecycle ---------- */

    /**
     * Adds a new (non-booked) stock for a book.
     * @param bookId Book id.
     * @param userId Owning user's id.
     * @param fields Status/location/optional customer for the new stock.
     * @returns The new stock's detail.
     */
    public async addBookStock(
        bookId: string,
        userId: number,
        fields: {status: number; locationId: string; customerId: string | undefined}
    ): Promise<BookStockDetail> {
        const BOOKED_STATUS = 2;
        if (fields.status == BOOKED_STATUS) {
            throw new NotAcceptableError('Status "booked" not allowed in add stock action');
        }

        const repo = new BookRepository(this.pool);

        // Without this check, any authenticated user could add a stock to any
        // other user's book (IDOR - security audit #2): the location/customer
        // ownership checks below don't cover the book itself.
        const bookOk = await repo.exists(Number(bookId), userId);
        if (!bookOk) {
            throw new NotFoundError("Book not found");
        }

        const locationOk = await new LocationRepository(this.pool).exists(Number(fields.locationId), userId);
        if (!locationOk) {
            throw new NotFoundError("Location not found");
        }

        if (fields.customerId) {
            const customerOk = await new CustomerRepository(this.pool).exists(Number(fields.customerId), userId);
            if (!customerOk) {
                throw new NotFoundError("Customer not found");
            }
        }

        const code = await repo.generateStockCode();
        const stockId = await repo.insertStockWithId(bookId, code, fields.status, fields.locationId, fields.customerId, userId);

        const stock = await repo.findStockDetail(stockId, userId);
        return stock!;
    }

    /**
     * Deletes one book stock.
     * @param bookId Book id.
     * @param stockId Stock id.
     * @param userId Owning user's id.
     * @returns Whether a matching stock was found and deleted.
     */
    public async deleteBookStock(bookId: string, stockId: string, userId: number): Promise<boolean> {
        return new BookRepository(this.pool).deleteStock(bookId, stockId, userId);
    }

    /**
     * Updates a book stock's status/location/customer, recording a loan/return in loan_history when the status crosses in/out of "booked".
     * @param bookId Book id.
     * @param stockId Stock id.
     * @param userId Owning user's id.
     * @param fields New status/location/customer.
     * @returns The updated stock's detail.
     */
    public async updateBookStock(
        bookId: string,
        stockId: string,
        userId: number,
        fields: {status: number; location_id: number; customer_id: number | null | undefined}
    ): Promise<BookStockDetail | undefined> {
        const locationOk = await new LocationRepository(this.pool).exists(fields.location_id, userId);
        if (!locationOk) {
            throw new NotFoundError("Location not found");
        }

        if (fields.customer_id) {
            const customerOk = await new CustomerRepository(this.pool).exists(fields.customer_id, userId);
            if (!customerOk) {
                throw new NotFoundError("Customer not found");
            }
        }

        const repo = new BookRepository(this.pool);
        const previousStatus = await repo.getStockStatus(stockId, bookId, userId);

        const rowsAffected = await repo.updateStock(bookId, stockId, userId, fields.status, fields.location_id, fields.customer_id);
        if (rowsAffected !== 1) {
            // Original route sent a bare 500 here but (bug) never returned, so
            // execution continued into the same response - not faithfully
            // reproducible in a clean service/controller split, and untested.
            // Judgment call: surface it as a clean thrown error instead.
            throw new Error("Book stock update affected an unexpected number of rows");
        }

        const stock = await repo.findStockDetail(stockId, userId);

        const newStatus = Number(fields.status);
        if (stock && Number(previousStatus) !== 2 && newStatus === 2) {
            await new LoanHistoryRepository(this.pool).recordLoan(userId, stock.code, Number(fields.customer_id));
        } else if (stock && Number(previousStatus) === 2 && newStatus !== 2) {
            await new LoanHistoryRepository(this.pool).recordReturn(userId, stock.code);
        }

        return stock ?? undefined;
    }

    /**
     * Looks up a book + stock by the stock's code, for the "add stock via scan" flow.
     * @param bookCode Stock code.
     * @param userId Owning user's id.
     * @returns The book/stock summary.
     */
    public async getAddMetadata(bookCode: string, userId: number): Promise<IBookAddMd> {
        const row = await new BookRepository(this.pool).findStockAndBookByCode(bookCode, userId);
        if (!row) {
            throw new NotFoundError("Book stock not found");
        }

        return {
            id: row.book_id,
            name: row.name,
            image_url: row.image_url,
            isbn: row.isbn,
            stocks: [{id: row.stock_id, code: row.stock_code, status: row.status}],
        };
    }

    /**
     * Bulk-returns a batch of book stocks. Originally an un-transacted loop of
     * UPDATE + recordReturn pairs - same atomicity fix as
     * CustomerService.lendBooksToCustomer / returnBookFromCustomer.
     *
     * @param userId Owning user's id.
     * @param bookStockCodes Stock codes to return.
     */
    public async bulkReturnBooks(userId: number, bookStockCodes: string[]): Promise<void> {
        await withTransaction(this.pool, async (client: PoolClient) => {
            const txBookRepo = new BookRepository(client);
            const txLoanHistoryRepo = new LoanHistoryRepository(client);
            for (const bookStockCode of bookStockCodes) {
                await txBookRepo.returnStockByCode(bookStockCode, userId);
                await txLoanHistoryRepo.recordReturn(userId, bookStockCode);
            }
        });
    }

    /* ---------- Shared validation ---------- */

    /**
     * Only allow images we generated ourselves (data: URIs from the upload
     * endpoints) or ones from the known ISBN metadata providers. Without this,
     * a client could set books.image_url to any external URL, which the app
     * would then load as an <img src> - a tracking-pixel / IP-disclosure vector,
     * and it makes the CSP imgSrc allowlist meaningless.
     *
     * Public static so `ImportService.ts` can apply the exact same rule to a
     * user-supplied cover in an import CSV, rather than keeping a second copy of
     * a security-relevant allowlist that could silently drift from this one.
     *
     * @param url Candidate image URL.
     * @returns Whether the URL is allowed.
     */
    public static isAllowedImageUrl(url: string): boolean {
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
}
