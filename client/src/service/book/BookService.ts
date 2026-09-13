import {PATH_PREFIX} from "@/Constants";
import IBook from "@/types/book/IBook";
import {BookStockStatusEnum, IBookStock} from "@/types/book/IBookStock";
import axiosInstance from "@/plugins/axiosInstance";
import {IBookAddMd} from "@/types/book/IBookAddMd";
import {IBookFile} from "@/types/book/IBookFile";
import {ReadingStatusEnum} from "@/types/book/IReadingStatus";

/**
 * Thin HTTP client for the `/api/rest/book` endpoints (see server/src/routes/BooksRoute.ts):
 * book CRUD, ISBN-based auto-creation, cover image upload, and managing
 * physical stocks (add/update/remove/return) for a book.
 *
 * @example
 * const book = await bookService.getBook(12);
 * const stock = await bookService.addBookStock(12, 2, BookStockStatusEnum.AVAILABLE, null);
 */
export class BookService {

    /**
     * Fetch full detail for a single book, including its stocks and authors.
     * @param id Book id.
     * @returns The full book detail.
     */
    public async getBook(id: number): Promise<IBook> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/book/${id}`, {});
        return data;
    }

    /**
     * Update a book's metadata and its full list of author ids.
     * @param id Book id.
     * @param name Book title.
     * @param image_url Cover image URL, or a `data:` URI, or null to leave unchanged.
     * @param isbn ISBN code, or null.
     * @param category_id Category id, or null.
     * @param language_code 2-letter language code, or null.
     * @param authors Full desired list of author ids (diffed against the current set).
     * @param description Free-text description, or null.
     * @param publisher Publisher name, or null.
     * @param published_date Publication date, or null.
     * @param pages Page count.
     * @param format_id Format id, or null.
     * @param reading_status The user's personal reading progress, or null to leave it untracked.
     */
    public async updateBook(
        id: number,
        name: string,
        image_url: string | null,
        isbn: string | null,
        category_id: number | null,
        language_code: string | null,
        authors: number[],
        description: string | null,
        publisher: string | null,
        published_date: Date | null,
        pages: number,
        format_id: number | null,
        reading_status: ReadingStatusEnum | null
    ): Promise<void> {
        const {data} = await axiosInstance.put(`${PATH_PREFIX}/book/${id}`, {
            name: name,
            image_url,
            isbn,
            category_id: category_id,
            language_code: language_code,
            authors: authors,
            description: description,
            publisher: publisher,
            published_date: published_date,
            pages: pages,
            format_id: format_id,
            reading_status: reading_status
        });
        return data;
    }

    /**
     * Create a book manually (as opposed to `createBookFromIsbn`).
     * @param name Book title.
     * @param description Free-text description, or null.
     * @param isbn ISBN code, or null.
     * @param image Cover image file, or null.
     * @returns The new book's id.
     */
    public async createBook(
        name: string,
        description: string | null,
        isbn: string | null,
        image: File | null,
    ): Promise<number> {
        const formData = new FormData();
        formData.set("name", name);

        if(description) {
            formData.set("description", description);
        }

        if(isbn) {
            formData.set("isbn", isbn);
        }

        if(image) {
            formData.set("image", image);
        }

        const {data} = await axiosInstance.post(`${PATH_PREFIX}/book`, formData);
        return data;
    }

    /**
     * Replace a book's cover image with an uploaded file.
     * @param id Book id.
     * @param image New cover image file.
     */
    public async changeImage(
        id: number,
        image: File,
    ): Promise<void> {
        const formData = new FormData();
        formData.set("image", image);

        await axiosInstance.post(`${PATH_PREFIX}/book/${id}/image`, formData);
    }

    /**
     * Look up a cover online (Google Books, falling back to Open Library) for
     * a book already in the library, using its stored ISBN, and save it as
     * the book's new cover.
     * Uses `suppressErrorDialog` since the caller shows its own "no cover
     * found" feedback instead of the generic error dialog.
     * @param id Book id.
     * @returns The new cover image URL.
     */
    public async findCover(id: number): Promise<string> {
        const {data} = await axiosInstance.post(`${PATH_PREFIX}/book/${id}/cover/find`, undefined, {
            // @ts-ignore - custom flag read by the response interceptor
            suppressErrorDialog: true
        });
        return data;
    }

    /**
     * Upload (or replace) one of a book's backed-up ebook files (epub/pdf/Kindle).
     * A book can have up to one file per type - the server infers the type from
     * the upload and replaces any existing file of that same type only.
     * @param id Book id.
     * @param file New epub/pdf/mobi/azw3 file.
     * @returns The uploaded file's metadata.
     */
    public async uploadFile(
        id: number,
        file: File,
    ): Promise<IBookFile> {
        const formData = new FormData();
        formData.set("file", file);

        const {data} = await axiosInstance.post(`${PATH_PREFIX}/book/${id}/file`, formData);
        return data;
    }

    /**
     * Delete one of a book's backed-up ebook files.
     * @param id Book id.
     * @param fileId Id of the file to delete.
     * @returns Whether a file was actually deleted.
     */
    public async deleteFile(id: number, fileId: number): Promise<boolean> {
        const {data} = await axiosInstance.delete(`${PATH_PREFIX}/book/${id}/file/${fileId}`);
        return data;
    }

    /**
     * Fetch one of a book's backed-up ebook files' raw bytes, for in-page preview
     * (as opposed to the `/file/:fileId/download` link, which forces a browser save).
     * @param id Book id.
     * @param fileId Id of the file to fetch.
     * @returns The file's contents as a `Blob`.
     */
    public async downloadFileBlob(id: number, fileId: number): Promise<Blob> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/book/${id}/file/${fileId}/download`, {responseType: "blob"});
        return data;
    }

    /**
     * Create a book automatically by looking up its metadata from an ISBN
     * (Google Books, falling back to Open Library server-side).
     *
     * Uses `suppressErrorDialog` because callers (e.g. batch ISBN import)
     * render their own per-item error UI instead of the global error dialog.
     *
     * @param isbn ISBN code to look up.
     * @param location Optional location id to place the new stock in.
     * @returns The new (or matched existing) book's id.
     */
    public async createBookFromIsbn(isbn: string, location: number |null): Promise<number> {
        const {data} = await axiosInstance.post(`${PATH_PREFIX}/book/isbn/${isbn}`, {location: location}, {
            // @ts-ignore - custom flag read by the response interceptor
            suppressErrorDialog: true
        });
        return data;
    }

    /**
     * Add a new physical stock (copy) of a book at a location.
     * @param id Book id.
     * @param locationId Destination location id.
     * @param status Initial stock status (BOOKED is not allowed here).
     * @param customerId Customer to assign the copy to, or null.
     * @returns The created stock.
     */
    public async addBookStock(id: number, locationId: number, status: BookStockStatusEnum, customerId: number |null): Promise<IBookStock> {
        const {data} = await axiosInstance.post(`${PATH_PREFIX}/book/${id}/stock`, {
            status: status,
            location_id: locationId,
            customer_id: customerId,
        });

        return data;
    }

    /**
     * Remove a single physical stock of a book.
     * @param id Book id.
     * @param stockId Stock id to remove.
     * @returns Whether a stock was actually removed.
     */
    public async removeBookStock(id: number, stockId: number): Promise<boolean> {
        const {data} = await axiosInstance.delete(`${PATH_PREFIX}/book/${id}/stock/${stockId}`);

        return data;
    }

    /**
     * Update a physical stock's status, location and/or assigned customer.
     * @param id Book id.
     * @param stockId Stock id.
     * @param stockStatus New status.
     * @param stockLocationId New location id.
     * @param customerId New customer id, or null to clear.
     * @returns The updated stock.
     */
    public async updateBookStock(id: number, stockId: number, stockStatus: BookStockStatusEnum, stockLocationId: number, customerId: number | null): Promise<IBookStock> {
        const {data} = await axiosInstance.put(`${PATH_PREFIX}/book/${id}/stock/${stockId}`, {
            status: stockStatus,
            location_id: stockLocationId,
            customer_id: customerId
        });

        return data;
    }

    /**
     * Delete a book by id (and, via DB foreign keys, its stocks/author links).
     * @param id Book id to delete.
     */
    public async deleteBook(id: number): Promise<void> {
        await axiosInstance.delete(`${PATH_PREFIX}/book/${id}`);
    }


    /**
     * Look up the book + single stock behind a scanned/typed stock code,
     * for the "add book to customer/location" flow.
     * @param bookCode A book_stocks.code value.
     * @returns The matched book plus its single stock.
     */
    public async fetchBookAddMd(bookCode: string): Promise<IBookAddMd> {
        const {data} = await axiosInstance.get(`${PATH_PREFIX}/book/${bookCode}/add/md`);
        return data;
    }

    /**
     * Bulk-return one or more book stocks: clears their assigned customer
     * and resets their status to available.
     * @param books Array of book_stocks.code values.
     */
    public async returnBooks(books: string[]): Promise<void> {
        const {data} = await axiosInstance.post(`${PATH_PREFIX}/book/return`, {books: books});
        return data;
    }

}

/** Singleton instance shared by every part of the app. */
export const bookService = new BookService();
