/**
 * =============================================================================
 * BooksRoute
 * =============================================================================
 * Mounted at `/api/rest/book` (see server/src/routes/Routes.ts).
 *
 * Owns everything related to a vault's book catalog:
 *  - searching/listing/reading/updating/deleting `books`
 *  - creating books either manually or automatically from an ISBN lookup
 *    (Open Library, optional Google Books, Wikipedia, ISBN store fallback)
 *  - managing physical copies of a book ("book stocks": add/update/remove,
 *    and bulk "return" of loaned/sold copies)
 *
 * Every route in this file requires a valid session - see `requireAuth` in
 * server/src/middlewares/AuthMiddleware.ts. All queries are additionally
 * scoped by `vault_id` (issue #7) so one vault can never read/modify another vault's data.
 *
 * See BookController/BookService/BookRepository (+ BookMetadataRepository
 * for the external ISBN lookup) for the actual request handling, business
 * rules, and SQL/external-API access respectively.
 */
import {Request, Response, Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {handleUploadError} from "../middlewares/UploadErrorMiddleware";
import {
    BookController,
    upload,
    fileUpload,
    maxCoverImageSizeMb,
    maxEbookFileSizeMb
} from "../controllers/BookController";
import {lazy} from "./lazySingleton";

const router: Router = Router();
const getBookController = lazy(() => new BookController(appService.getDatabasePool()));

/**
 * GET /book/search
 * ------------------
 * Paginated/filterable/sortable book search, each row carrying its author list.
 *
 * Auth: required. Query: `?query=hobbit&category_id=1,2&page=0&filters=recent,hasStock&date_from=2026-01-01&date_to=2026-01-31&sort=nameAsc`
 * (all optional; `page` is 0-indexed, 50 rows per page).
 *
 * Example response (200):
 *  { "total": 12, "books": [{ "id": 3, "name": "The Hobbit", "image_url": null, "isbn": "9780261102217",
 *    "category_id": 1, "language_code": "en", "reading_status": null, "authors": [{ "id": 1, "name": "J.R.R. Tolkien" }] }] }
 */
router.get('/search', requireAuth, (req, res) => getBookController().search(req, res));

/**
 * GET /book/counters
 * ---------------------
 * KPI counters for the Books view.
 *
 * Auth: required.
 *
 * Example response (200): { "total": 128, "recent": 4, "onLoan": 5, "noStock": 2, "wantToRead": 10, "currentlyReading": 3 }
 */
router.get('/counters', requireAuth, (req, res) => getBookController().counters(req, res));

/**
 * GET /book/:id
 * ---------------
 * Full detail for one book: fields, files, stocks (with location/customer), and authors.
 *
 * Auth: required.
 *
 * Example response (200):
 *  { "id": 3, "name": "The Hobbit", "description": "...", "image_url": null, "isbn": "9780261102217",
 *    "category_id": 1, "language_code": "en", "publisher": "HarperCollins", "published_date": "1937-01-01",
 *    "pages": 310, "format_id": null, "reading_status": null, "files": [], "stocks": [], "authors": [] }
 * Responses: 200 the book detail | 404 "Book not found".
 */
router.get('/:id', requireAuth, (req, res) => getBookController().getById(req, res));

/**
 * PUT /book/:id
 * ---------------
 * Updates a book's editable fields and author links.
 *
 * Auth: required. Body:
 *  { "name": "The Hobbit", "image_url": null, "isbn": "9780261102217", "category_id": 1,
 *    "language_code": "en", "authors": [1, 2], "description": "...", "publisher": "HarperCollins",
 *    "published_date": "1937-01-01", "pages": 310, "format_id": null, "reading_status": null }
 *
 * Example response (200): { "message": "Book updated successfully" }
 * Responses: 200 success | 400 invalid image URL/reading status | 404 "Book not found".
 */
router.put('/:id', requireAuth, (req, res) => getBookController().update(req, res));

/**
 * DELETE /book/:id
 * ------------------
 * Deletes a book.
 *
 * Auth: required.
 *
 * Example response (200): { "message": "Book deleted successfully" }
 * Responses: 200 success | 404 "Book not found".
 */
router.delete('/:id', requireAuth, (req, res) => getBookController().remove(req, res));

/**
 * POST /book/:id/image
 * -----------------------
 * Sets a book's cover image from an uploaded file.
 *
 * Auth: required. Body: multipart/form-data, field `image` (PNG/JPEG, max 4MB).
 *
 * Example response (200): 1 (the number of rows affected)
 * Responses: 413 file too large.
 */
router.post('/:id/image', requireAuth, upload.single("image"), handleUploadError(maxCoverImageSizeMb), (req: Request, res: Response) => getBookController().updateImage(req, res));

/**
 * POST /book/:id/cover/find
 * ----------------------------
 * Looks up and sets a book's cover from its ISBN (Open Library, then LibraryThing, then Wikipedia).
 *
 * Auth: required.
 *
 * Example response (200): "https://covers.openlibrary.org/b/isbn/9780261102217-M.jpg"
 * Responses: 200 the resolved cover URL | 404 "Book not found" / "No cover found for this book" | 400 "Book has no ISBN".
 */
router.post('/:id/cover/find', requireAuth, (req, res) => getBookController().findCover(req, res));

/**
 * POST /book/:id/file
 * ----------------------
 * Uploads an ebook file backup for a book (replaces any existing file of the same type).
 *
 * Auth: required. Body: multipart/form-data, field `file` (.epub/.pdf/.mobi/.azw3, max 10MB by default,
 * configurable via `MAX_EBOOK_FILE_SIZE_MB`).
 *
 * Example response (200): { "id": 1, "file_type": "epub", "file_name": "hobbit.epub", "file_size": 512000, "date_created": "2026-01-05T10:00:00.000Z" }
 * Responses: 400 file content doesn't match a valid EPUB/PDF/Kindle file | 404 "Book not found" | 413 file too large.
 */
router.post('/:id/file', requireAuth, fileUpload.single("file"), handleUploadError(maxEbookFileSizeMb), (req: Request, res: Response) => getBookController().uploadFile(req, res));

/**
 * GET /book/:id/file/:fileId/download
 * --------------------------------------
 * Downloads an ebook file backup's raw bytes.
 *
 * Auth: required.
 *
 * Response (200): the raw file bytes, with `Content-Type`/`Content-Disposition` headers set for download.
 * Responses: 404 "File not found".
 */
router.get('/:id/file/:fileId/download', requireAuth, (req, res) => getBookController().downloadFile(req, res));

/**
 * DELETE /book/:id/file/:fileId
 * ---------------------------------
 * Deletes one ebook file backup.
 *
 * Auth: required.
 *
 * Example response (200): true
 */
router.delete('/:id/file/:fileId', requireAuth, (req, res) => getBookController().deleteFile(req, res));

/**
 * POST /book
 * ------------
 * Creates a minimal manually-entered book, auto-placing a stock if the caller has exactly one location.
 *
 * Auth: required. Body: multipart/form-data, fields `name`, `description`, `isbn`, and an optional `image` file (PNG/JPEG, max 4MB).
 *
 * Example response (200): 42 (the new book's id)
 * Responses: 404 "Book with provided ISBN code already exist" | 413 file too large.
 */
router.post('', requireAuth, upload.single("image"), handleUploadError(maxCoverImageSizeMb), (req: Request, res: Response) => getBookController().create(req, res));

/**
 * POST /book/isbn/:isbn
 * ------------------------
 * Creates (or find-or-creates, by ISBN) a book from looked-up ISBN metadata (Open Library, optional Google Books,
 * Wikipedia, ISBN store fallback).
 *
 * Auth: required. Body: { "location": "3" } (optional - location id to place the new stock at; auto-placed if omitted).
 *
 * Example response (200): 42 (the book's id)
 * Responses: 400 "No ISBN code provided" | 404 "Book not found" | 500 on a fetch/DB-transaction failure.
 */
router.post('/isbn/:isbn', requireAuth, (req, res) => getBookController().createFromIsbn(req, res));

/**
 * POST /book/:id/stock
 * -----------------------
 * Adds a new (non-booked) stock for a book.
 *
 * Auth: required. Body: { "status": 0, "location_id": "1", "customer_id": null }
 *
 * Example response (200): { "id": 10, "code": "abc123", "status": 0, "location_id": 1, "location_name": "Shelf",
 *    "customer_id": null, "customer_name": null }
 * Responses: 404 "Location not found" / "Customer not found" | 406 status "booked" not allowed here.
 */
router.post('/:id/stock', requireAuth, (req, res) => getBookController().addStock(req, res));

/**
 * DELETE /book/:id/stock/:stock_id
 * ------------------------------------
 * Deletes one book stock.
 *
 * Auth: required.
 *
 * Example response (200): true
 */
router.delete('/:id/stock/:stock_id', requireAuth, (req, res) => getBookController().deleteStock(req, res));

/**
 * PUT /book/:id/stock/:stock_id
 * ---------------------------------
 * Updates a book stock's status/location/customer. Recording a loan/return in `loan_history` when the
 * status crosses in/out of "booked" (2).
 *
 * Auth: required. Body: { "status": 2, "location_id": 1, "customer_id": 7 }
 *
 * Example response (200): { "id": 10, "code": "abc123", "status": 2, "location_id": 1, "location_name": "Shelf",
 *    "customer_id": 7, "customer_name": "Jane Doe" }
 * Responses: 404 "Location not found" / "Customer not found".
 */
router.put('/:id/stock/:stock_id', requireAuth, (req, res) => getBookController().updateStock(req, res));

/**
 * GET /book/:bookCode/add/md
 * ------------------------------
 * Looks up a book + stock by the stock's code, for the "add stock via scan" flow.
 *
 * Auth: required.
 *
 * Example response (200): { "id": 3, "name": "The Hobbit", "image_url": null, "isbn": "9780261102217",
 *    "stocks": [{ "id": 10, "code": "abc123", "status": 0 }] }
 * Responses: 404 "Book stock not found".
 */
router.get('/:bookCode/add/md', requireAuth, (req, res) => getBookController().getAddMetadata(req, res));

/**
 * POST /book/return
 * --------------------
 * Bulk-returns a batch of book stocks (by code), all-or-nothing in one transaction.
 *
 * Auth: required. Body: { "books": ["abc123", "def456"] }
 *
 * Response (200): empty body on success.
 */
router.post('/return', requireAuth, upload.single("image"), handleUploadError(maxCoverImageSizeMb), (req: Request, res: Response) => getBookController().bulkReturn(req, res));

export default router;
