/**
 * Full book detail view model (backs the book detail view), extending
 * `BookItem` with description/publisher metadata, its list of physical
 * `BookStock`s, and the mutating operations (`updateBook`, `changeImage`,
 * `deleteBook`, `addBookStock`, `removeBookStock`) that call `BookService`
 * and keep local reactive state in sync with the server.
 *
 * @example
 * const book = new Book(await bookService.getBook(12));
 * await book.addBookStock(BookStockStatusEnum.AVAILABLE, locationId, null, false);
 */
import BookItem from "@/model/book/BookItem";
import IBook from "@/types/book/IBook";
import {IBookFile} from "@/types/book/IBookFile";
import {applicationService} from "@/service/ApplicationService";
import Format from "@/model/format/Format";
import {bookService} from "@/service/book/BookService";
import BookStock from "@/model/book/BookStock";
import {BookStockStatusEnum} from "@/types/book/IBookStock";
import {ref, Ref, shallowRef, ShallowRef} from "vue";
import router from "@/router/Router";
import {searchRoute} from "@/router/routes/SearchRoute";
import {appSnackbarController, SnackbarType} from "@/components/appSnackbar/AppSnackbarController";
import axios from "axios";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {printDialogController} from "@/components/printDialog/PrintDialogController";
import {ELECTRONIC_FORMAT_NAME} from "@/Constants";

export default class Book extends BookItem {

    /** Free-text description. */
    private m_description: Ref<string>;

    /** Publisher name, or null if unset. */
    private m_publisher: Ref<string | null>;

    /** Publication date, or null if unset. */
    private m_publishedDate: Ref<Date | null>;

    /** Page count. */
    private m_pages: Ref<number>;

    /** Book format (e.g. paperback/hardcover), or null if unset. */
    private m_format: ShallowRef<Format | null>;

    /** Physical stocks (copies) of this book. */
    private m_stocks: ShallowRef<BookStock[]>;

    /** This book's backed-up ebook files, up to one per type (epub/pdf/mobi). */
    private m_files: ShallowRef<IBookFile[]>;

    /** Timestamp the book was created. */
    private readonly m_dateCreated: Date;

    /** Timestamp the book was last updated. */
    private readonly m_dateUpdated: Date;

    /** @param data Raw full book detail data from the server. */
    public constructor(data: IBook) {
        super(data);
        this.m_description = ref(data.description || "");
        this.m_publisher = ref(data.publisher);
        this.m_publishedDate = ref(data.published_date ? new Date(data.published_date) : null);
        this.m_dateCreated = new Date(data.date_created);
        this.m_dateUpdated = new Date(data.date_updated);
        this.m_pages = ref(data.pages || 0);
        this.m_format = shallowRef(data.format_id ? applicationService.getFormat(data.format_id) || null : null);

        this.m_stocks = shallowRef(data.stocks.map((stock) => new BookStock(this,stock)));
        this.m_files = shallowRef(data.files);
    }

    /** @returns A placeholder "empty" book (id -1) used to initialize forms before real data loads. */
    public static empty(): Book {
        return new Book({
            id: -1,
            name: "",
            image_url: null,
            isbn: null,
            category_id: null,
            language_code: null,
            authors: [],
            description: null,
            publisher: null,
            published_date: null,
            pages: null,
            stocks: [],
            format_id: null,
            reading_status: null,
            date_created: "",
            date_updated: "",
            files: [],
        })
    }

    /** @returns The book's description. */
    public getDescription(): string {
        return this.m_description.value;
    }

    /** @param value New description. */
    public setDescription(value: string) {
        this.m_description.value = value;
    }

    /** @returns Whether the book has a publisher set. */
    public hasPublisher(): boolean {
        return this.m_publisher.value != null;
    }

    /** @returns The publisher name, or null if unset. */
    public getPublisher(): string | null {
        return this.m_publisher.value;
    }

    /** @param value New publisher name, or null to clear it. */
    public setPublisher(value: string | null) {
        this.m_publisher.value = value;
    }

    /** @returns Whether the book has a publish date set. */
    public hasPublishDate(): boolean {
        return this.m_publishedDate.value != null;
    }

    /** @returns The publish date, or null if unset. */
    public getPublishDate(): Date | null {
        return this.m_publishedDate.value;
    }

    /** @param value New publish date, or null to clear it. */
    public setPublishDate(value: Date | null) {
        this.m_publishedDate.value = value;
    }

    /** @returns The timestamp the book was created. */
    public getDateCreated(): Date {
        return this.m_dateCreated;
    }

    /** @returns The creation timestamp formatted for display in the user's locale. */
    public getFormatedDateCreated(): string {
        return this.m_dateCreated.toLocaleString();
    }

    /** @returns The timestamp the book was last updated. */
    public getDateUpdated(): Date {
        return this.m_dateUpdated;
    }

    /** @returns The last-updated timestamp formatted for display in the user's locale. */
    public getFormatedDateUpdated(): string {
        return this.m_dateUpdated.toLocaleString();
    }

    /** @returns The page count. */
    public getNumberOfPages(): number {
        return this.m_pages.value;
    }

    /** @param value New page count. */
    public setNumberOfPages(value: number) {
        this.m_pages.value = value;
    }

    /** @returns Whether the book has a format set. */
    public hasFormat(): boolean {
        return this.m_format.value != null;
    }

    /** @returns The book's format, or null if unset. */
    public getFormat(): Format | null {
        return this.m_format.value;
    }

    /** @param format New format, or null to clear it. */
    public setFormat(format: Format | null) {
        this.m_format.value = format;
    }

    /** @returns Whether this book's format is the digital/ebook edition (`ELECTRONIC_FORMAT_NAME`) - gates the file upload/preview card on the detail view. */
    public isElectronic(): boolean {
        return this.m_format.value?.getFormatName() === ELECTRONIC_FORMAT_NAME;
    }

    /** @returns The book's physical stocks (copies). */
    public getStocks(): BookStock[] {
        return this.m_stocks.value;
    }

    /** @returns The book's backed-up ebook files, up to one per type (epub/pdf/mobi). */
    public getFiles(): IBookFile[] {
        return this.m_files.value;
    }

    /**
     * Add a new physical stock (copy) of this book, append it to the local
     * list, show a confirmation snackbar, and optionally queue a barcode
     * label for printing via `printDialogController`.
     * @param status Initial stock status.
     * @param locationId Destination location id.
     * @param customerId Customer to assign the copy to, or null.
     * @param print If true, add a printable barcode label to the print queue.
     */
    public async addBookStock(status: BookStockStatusEnum, locationId: number, customerId: number | null, print: boolean) {
        try {
            const data = await bookService.addBookStock(this.m_id, locationId, status, customerId);
            const stock = new BookStock(this, data)
            this.m_stocks.value = [...this.m_stocks.value, stock];

            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_BOOK_STOCK_ADDED)})

            if(print) {
                printDialogController.addLabel(this.m_name.value, stock.getCode(), stock.generateBarcodeImage(), this.getImageUrl());
            }
        } catch (e) {
            console.error("Error while adding book stock", e)
        }
    }

    /**
     * Delete a physical stock from the server and remove it from the local list.
     * @param stockId Id of the stock to remove.
     */
    public async removeBookStock(stockId: number) {
        try {
            const result = await bookService.removeBookStock(this.m_id, stockId);

            if(!result) {
                throw "Unable to remove book stock";
            }

            const index = this.m_stocks.value.findIndex((stock) => stock.getId() === stockId);
            if(index != -1) {
                this.m_stocks.value.splice(index, 1);
                this.m_stocks.value = [...this.m_stocks.value];

                appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_BOOK_STOCK_DELETED)})

            } else {
                console.warn("Unable to remove stock from array since index is -1")
            }
        } catch (e) {
            console.error("Error while removing book stock", e)
        }
    }

    /** Persist all current field values (name, metadata, authors, ...) to the server. */
    public async updateBook() {
        try {
            await bookService.updateBook(
                this.m_id,
                this.m_name.value,
                this.m_imageUrl.value,
                this.m_isbn.value,
                this.m_categoryId.value,
                this.m_languageCode.value,
                this.m_authors.value.map((author) => author.getAuthorId()),
                this.m_description.value,
                this.m_publisher.value,
                this.m_publishedDate.value,
                this.m_pages.value,
                this.m_format.value ? this.m_format.value.getFormatId() : null,
                this.getReadingStatus()
            )
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_BOOK_UPDATED)})
        } catch (e) {
            console.error("Error while updating book.", e)
        }
    }

    /**
     * Upload a new cover image, then optimistically update the local
     * `imageUrl` by converting the same file to a base64 data URL client-side
     * (avoids waiting for a second round trip to re-fetch the book).
     * @param image New cover image file.
     */
    public async changeImage(image: File) {
        try {
            await bookService.changeImage(this.m_id, image);
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_BOOK_IMAGE_UPDATED)})

            /** @param file Image file to encode. @returns A `data:` URL for the file's contents. */
            function fileToBase64(file: File): Promise<string> {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();

                    reader.onload = () => {
                        // The result includes the "data:mime/type;base64," prefix
                        resolve(reader.result as string);
                    };

                    reader.onerror = (error) => {
                        reject(error);
                    };

                    reader.readAsDataURL(file); // Reads the file and encodes to Base64
                });
            }

            this.m_imageUrl.value = await fileToBase64(image);
        } catch (e) {
            console.error("Error while updating book.", e)
        }
    }

    /**
     * Look up a cover online (Google Books, falling back to Open Library)
     * using this book's ISBN, and use it as the new cover if one is found.
     */
    public async findCover() {
        try {
            const imageUrl = await bookService.findCover(this.m_id);
            this.m_imageUrl.value = imageUrl;
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_BOOK_IMAGE_UPDATED)})
        } catch (e) {
            const notFound = axios.isAxiosError(e) && e.response?.status === 404;
            appSnackbarController.show({
                message: i18n.global.t(notFound ? AppLabels.SNACKBAR_BOOK_COVER_NOT_FOUND : AppLabels.ERROR_OCCURRED),
                type: SnackbarType.ERROR
            })
            console.error("Error while finding book cover.", e)
        }
    }

    /**
     * Upload (or replace) one of this book's backed-up ebook files. The
     * server infers the file's type (epub/pdf/mobi) from its content, and
     * replaces any existing file of that same type only.
     * @param file New epub/pdf/mobi/azw3 file.
     */
    public async uploadFile(file: File) {
        try {
            const uploaded = await bookService.uploadFile(this.m_id, file);
            const withoutSameType = this.m_files.value.filter((f) => f.file_type !== uploaded.file_type);
            this.m_files.value = [...withoutSameType, uploaded];
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_BOOK_FILE_UPLOADED)})
        } catch (e) {
            console.error("Error while uploading book file.", e)
        }
    }

    /**
     * Delete one of this book's backed-up ebook files.
     * @param fileId Id of the file to remove.
     */
    public async removeFile(fileId: number) {
        try {
            const result = await bookService.deleteFile(this.m_id, fileId);

            if (!result) {
                throw "Unable to remove book file";
            }

            this.m_files.value = this.m_files.value.filter((f) => f.id !== fileId);
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_BOOK_FILE_DELETED)})
        } catch (e) {
            console.error("Error while removing book file.", e)
        }
    }

    /** Delete this book on the server, then navigate back to the search/library view. */
    public async deleteBook() {
        try {
            await bookService.deleteBook(this.m_id)
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_BOOK_DELETED)})
            router.push(searchRoute.getPath())
        } catch (e) {
            console.error("Error while deleting book.", e)
        }
    }

}
