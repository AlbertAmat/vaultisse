import {bookRoute} from "@/router/routes/BookRoute";
import {ICustomerBook} from "@vaultisse/types/customer/ICustomerBook";

/** Read-only view model for a book currently on loan to a customer. */
export class CustomerBook {

    /** Book id. */
    protected readonly m_id: number;

    /** Book title. */
    protected readonly m_name: string;

    /** Cover image URL/data-URI, or null if none. */
    protected readonly m_imageUrl: string | null;

    /** ISBN code, or null if none. */
    protected readonly m_isbn: string | null;

    /** Stock code of the loaned copy. */
    protected readonly m_stockCode: string;

    /** @param data Raw customer-book data from the server. */
    public constructor(data: ICustomerBook) {
        this.m_id = data.id;
        this.m_name = data.name;
        this.m_imageUrl = data.image_url;
        this.m_isbn = data.isbn;
        this.m_stockCode = data.code;
    }

    /** @returns The book id. */
    public getId(): number {
        return this.m_id;
    }

    /** @returns The book title. */
    public getName(): string {
        return this.m_name;
    }

    /** @returns The stock code of the loaned copy. */
    public getStockCode(): string {
        return this.m_stockCode;
    }

    /** @returns The cover image URL/data-URI, or null if none. */
    public getImageUrl(): string | null {
        return this.m_imageUrl;
    }

    /** @returns Whether the book has an ISBN set. */
    public hasIsbn(): boolean {
        return this.m_isbn != null;
    }

    /** @returns The ISBN code, or null if none. */
    public getIsbn(): string | null {
        return this.m_isbn;
    }

    /** @returns In-app router path to this book's detail view. */
    public getUrl(): string {
        return bookRoute.getPath(this.m_id)
    }
}
