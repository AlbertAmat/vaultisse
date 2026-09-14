import {Pool} from "pg";
import {Request, Response} from "express";
import multer from "multer";
import {appService} from "../AppService";
import {BookService} from "../services/BookService";
import {DomainError} from "../errors/DomainError";
import {SearchFilter} from "../types/search/SearchFilter";
import {SortType} from "../types/search/SortType";

// Multer setup - store in memory
const storage = multer.memoryStorage();
const maxCoverImageSizeMb = 4;
export const upload = multer({
    storage,
    limits: {fileSize: maxCoverImageSizeMb * 1024 * 1024},
    fileFilter: (req: Request, file: Express.Multer.File, cb: (error: any, acceptFile: boolean) => void) => {
        if (file.mimetype !== "image/png" && file.mimetype !== "image/jpeg") {
            return cb(new Error("Only PNG or JPG images are allowed"), false);
        }
        cb(null, true);
    }
});
export {maxCoverImageSizeMb};

// Max size for the ebook-file backups, configurable via MAX_EBOOK_FILE_SIZE_MB
// so deployers can raise (or lower) the limit without a code change.
// Defaults to 10MB when unset or not a valid positive number.
const parsedMaxEbookFileSizeMb = Number(process.env.MAX_EBOOK_FILE_SIZE_MB);
export const maxEbookFileSizeMb = Number.isFinite(parsedMaxEbookFileSizeMb) && parsedMaxEbookFileSizeMb > 0
    ? parsedMaxEbookFileSizeMb
    : 10;

// Multer setup for the book ebook-file backups (epub/pdf/Kindle) - also stored
// in memory, validated by extension since browsers report inconsistent
// mimetypes for .epub/.mobi/.azw3.
export const fileUpload = multer({
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

/** Thin HTTP<->service glue for the Book resource. Constructed once per process (see BooksRoute.ts) and reused across requests. Multer config (`upload`/`fileUpload`/size limits above) stays module-level, not on the class, since it's Express middleware wiring consumed directly by BooksRoute.ts, not request-handling logic. */
export class BookController {
    /**
     * @param pool Database connection pool, forwarded to a fresh BookService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * GET /book/search - paginated/filterable/sortable book search.
     * @param req Express request.
     * @param res Express response.
     */
    public async search(req: Request, res: Response): Promise<void> {
        const query = req.query.query ? String(req.query.query) : undefined;
        const category_id = req.query.category_id;
        const page = Math.max(0, Number(req.query.page)) || 0;
        const filters: SearchFilter[] = req.query.filters ? String(req.query.filters).split(",") as SearchFilter[] : [];
        const dateFrom = req.query.date_from ? String(req.query.date_from) : undefined;
        const dateTo = req.query.date_to ? String(req.query.date_to) : undefined;
        const sort = Object.values(SortType).includes(req.query.sort as SortType)
            ? req.query.sort as SortType
            : SortType.NAME_ASC;

        const categoryId = category_id
            ? (Array.isArray(category_id) ? category_id.map(Number) : String(category_id).split(',').map(Number))
            : undefined;

        try {
            const userId = appService.getSessionUser(req);
            const result = await new BookService(this.pool).searchBooks(userId, {
                query, categoryId, filters, dateFrom, dateTo, sort, page,
            });
            res.status(200).json(result);
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * GET /book/counters - KPI counters for the Books view.
     * @param req Express request.
     * @param res Express response.
     */
    public async counters(req: Request, res: Response): Promise<void> {
        try {
            const userId = appService.getSessionUser(req);
            const result = await new BookService(this.pool).getCounters(userId);
            res.status(200).json(result);
        } catch (err: any) {
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * GET /book/:id - full detail for one book.
     * @param req Express request.
     * @param res Express response.
     */
    public async getById(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        appService.getLogger().debug(`Get book, id: ${id}`);
        try {
            const userId = appService.getSessionUser(req);
            const book = await new BookService(this.pool).getBookDetail(id, userId);
            res.status(200).json(book);
        } catch (err: any) {
            if (err instanceof DomainError) {
                res.status(err.httpStatus).send(err.message);
                return;
            }
            console.error('Error executing query', err.stack);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * PUT /book/:id - updates a book's editable fields and author links.
     * @param req Express request.
     * @param res Express response.
     */
    public async update(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        appService.getLogger().debug(`Update book, id: ${id}`);

        try {
            const userId = appService.getSessionUser(req);
            await new BookService(this.pool).updateBook(id, userId, req.body);
            res.send({message: "Book updated successfully"});
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while updating book", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * DELETE /book/:id - deletes a book.
     * @param req Express request.
     * @param res Express response.
     */
    public async remove(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        appService.getLogger().debug(`Delete book, id: ${id}`);

        try {
            const userId = appService.getSessionUser(req);
            await new BookService(this.pool).deleteBook(id, userId);
            res.send({message: "Book deleted successfully"});
        } catch (e) {
            if (e instanceof DomainError) {
                res.status(e.httpStatus).send({error: e.message});
                return;
            }
            console.error("Error while deleting book", e);
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * POST /book/:id/image - sets a book's cover image from an uploaded file.
     * @param req Express request.
     * @param res Express response.
     */
    public async updateImage(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        try {
            const userId = appService.getSessionUser(req);
            const rowCount = await new BookService(this.pool).updateBookImage(id, userId, req.file);
            res.status(200).json(rowCount);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error adding book");
        }
    }

    /**
     * POST /book/:id/cover/find - looks up and sets a book's cover from its ISBN.
     * @param req Express request.
     * @param res Express response.
     */
    public async findCover(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        try {
            const userId = appService.getSessionUser(req);
            const imageUrl = await new BookService(this.pool).findBookCover(id, userId, appService.getLibraryThingApiKey());
            res.status(200).json(imageUrl);
        } catch (error: unknown) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error("Error finding book cover:", error);
            res.status(500).send("Error finding book cover");
        }
    }

    /**
     * POST /book/:id/file - uploads an ebook file backup for a book.
     * @param req Express request.
     * @param res Express response.
     */
    public async uploadFile(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        try {
            const userId = appService.getSessionUser(req);
            const file = await new BookService(this.pool).uploadBookFile(id, userId, req.file);
            res.status(200).json(file);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error("Error uploading book file:", error);
            res.status(500).send("Error uploading book file");
        }
    }

    /**
     * GET /book/:id/file/:fileId/download - downloads an ebook file backup.
     * @param req Express request.
     * @param res Express response.
     */
    public async downloadFile(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        const fileId = Number(req.params.fileId);
        try {
            const userId = appService.getSessionUser(req);
            const {file_data, file_name, file_type} = await new BookService(this.pool).downloadBookFile(id, fileId, userId);
            const contentType = file_type === "epub" ? "application/epub+zip"
                : file_type === "pdf" ? "application/pdf"
                    : "application/x-mobipocket-ebook";
            res.setHeader("Content-Type", contentType);
            const asciiName = file_name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
            res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file_name)}`);
            res.status(200).send(file_data);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error("Error downloading book file:", error);
            res.status(500).send("Error downloading book file");
        }
    }

    /**
     * DELETE /book/:id/file/:fileId - deletes an ebook file backup.
     * @param req Express request.
     * @param res Express response.
     */
    public async deleteFile(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        const fileId = Number(req.params.fileId);
        try {
            const userId = appService.getSessionUser(req);
            const deleted = await new BookService(this.pool).deleteBookFile(id, fileId, userId);
            res.status(200).json(deleted);
        } catch (error) {
            console.error("Error deleting book file:", error);
            res.status(500).send("Error deleting book file");
        }
    }

    /**
     * POST /book - creates a minimal manually-entered book.
     * @param req Express request.
     * @param res Express response.
     */
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const userId = appService.getSessionUser(req);
            const bookId = await new BookService(this.pool).createBook(userId, {
                name: req.body.name,
                description: req.body.description,
                isbn: req.body.isbn,
                file: req.file,
            });
            res.status(200).json(bookId);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error("Transaction error:", error);
            res.status(500).send("Error adding book");
        }
    }

    /**
     * POST /book/isbn/:isbn - creates (or find-or-creates) a book from ISBN metadata.
     * @param req Express request.
     * @param res Express response.
     */
    public async createFromIsbn(req: Request, res: Response): Promise<void> {
        try {
            const userId = appService.getSessionUser(req);
            const bookId = await new BookService(this.pool).createBookFromIsbn(
                userId,
                req.params.isbn,
                req.body.location,
                appService.getGoogleApiKey(),
                appService.getLibraryThingApiKey()
            );
            res.status(200).json(bookId);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            res.status(500).send((error as Error).message);
        }
    }

    /**
     * POST /book/:id/stock - adds a new (non-booked) stock for a book.
     * @param req Express request.
     * @param res Express response.
     */
    public async addStock(req: Request, res: Response): Promise<void> {
        const bookId = req.params.id;
        if (!bookId) {
            res.status(400).send('No book ID provided');
            return;
        }

        try {
            const userId = appService.getSessionUser(req);
            appService.getLogger().debug(`Adding book stock with status ${req.body.status} in book id: ${bookId}`);
            const stock = await new BookService(this.pool).addBookStock(bookId, userId, {
                status: req.body.status,
                locationId: req.body.location_id,
                customerId: req.body.customer_id,
            });
            res.status(200).json(stock);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error("Transaction error:", error);
            res.status(500).send("Error adding the book stock");
        }
    }

    /**
     * DELETE /book/:id/stock/:stock_id - deletes one book stock.
     * @param req Express request.
     * @param res Express response.
     */
    public async deleteStock(req: Request, res: Response): Promise<void> {
        const bookId = req.params.id;
        const stockId = req.params.stock_id;
        if (!bookId || !stockId) {
            res.status(400).send('No book ID or stock ID provided');
            return;
        }

        try {
            const userId = appService.getSessionUser(req);
            appService.getLogger().debug(`Removing book stock with status ${stockId} and book id: ${bookId}`);
            const deleted = await new BookService(this.pool).deleteBookStock(bookId, stockId, userId);
            res.status(200).json(deleted);
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error deleting the book stock");
        }
    }

    /**
     * PUT /book/:id/stock/:stock_id - updates a book stock's status/location/customer.
     * @param req Express request.
     * @param res Express response.
     */
    public async updateStock(req: Request, res: Response): Promise<void> {
        const bookId = req.params.id;
        const stockId = req.params.stock_id;
        if (!bookId || !stockId) {
            res.status(400).send('No book ID or stock ID provided');
            return;
        }

        try {
            const userId = appService.getSessionUser(req);
            appService.getLogger().debug(`Updating book stock ${stockId}`);
            const stock = await new BookService(this.pool).updateBookStock(bookId, stockId, userId, {
                status: req.body.status,
                location_id: req.body.location_id,
                customer_id: req.body.customer_id,
            });
            res.status(200).json(stock);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error("Transaction error:", error);
            res.status(500).send("Error deleting the book stock");
        }
    }

    /**
     * GET /book/:bookCode/add/md - looks up a book + stock by the stock's code, for the "add stock via scan" flow.
     * @param req Express request.
     * @param res Express response.
     */
    public async getAddMetadata(req: Request, res: Response): Promise<void> {
        const bookCode = String(req.params.bookCode).trim();
        try {
            const userId = appService.getSessionUser(req);
            const response = await new BookService(this.pool).getAddMetadata(bookCode, userId);
            res.status(200).json(response);
        } catch (error) {
            if (error instanceof DomainError) {
                res.status(error.httpStatus).send(error.message);
                return;
            }
            console.error("Transaction error:", error);
            res.status(500).send("Error retrieving the book data");
        }
    }

    /**
     * POST /book/return - bulk-returns a batch of book stocks.
     * @param req Express request.
     * @param res Express response.
     */
    public async bulkReturn(req: Request, res: Response): Promise<void> {
        try {
            const userId = appService.getSessionUser(req);
            await new BookService(this.pool).bulkReturnBooks(userId, req.body.books);
            res.status(200).send();
        } catch (error) {
            console.error("Transaction error:", error);
            res.status(500).send("Error returning books");
        }
    }
}
