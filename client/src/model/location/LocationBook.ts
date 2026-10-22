// Type definition for a book's data at a specific location
import ILocationBook from "@vaultisse/types/location/ILocationBook";

// Enum representing possible stock statuses for a book (e.g., available, reserved, etc.)
import { BookStockStatusEnum } from "@vaultisse/types/book/IBookStock";

/**
 * Represents a specific copy of a book stored at a particular location.
 * Provides read-only access to book details and stock information.
 */
export default class LocationBook {

    /**
     * Unique identifier for the stock item (location-specific book record).
     * @private
     */
    private readonly m_id: number;

    /**
     * Identifier linking this stock record to the main book entity.
     * @private
     */
    private readonly m_bookId: number;

    /**
     * Location-specific stock code for internal tracking.
     * @private
     */
    private readonly m_code: string;

    /**
     * Human-readable name of the book.
     * @private
     */
    private readonly m_name: string;

    /**
     * URL of the book's cover image, if available.
     * May be null when no image is provided.
     * @private
     */
    private readonly m_imageUrl: string | null;

    /**
     * Current stock status of the book (e.g., InStock, OutOfStock, Reserved).
     * @private
     */
    private readonly m_status: BookStockStatusEnum;

    /**
     * Constructs a LocationBook instance from a raw ILocationBook data object.
     * @param data - Data source containing all necessary location-book properties.
     */
    public constructor(data: ILocationBook) {
        this.m_id = data.id;
        this.m_bookId = data.book_id;
        this.m_code = data.code;
        this.m_name = data.name;
        this.m_status = data.status;
        this.m_imageUrl = data.image_url;
    }

    /**
     * Retrieves the unique stock identifier for this location book.
     * @returns The stock record ID.
     */
    public getStockId(): number {
        return this.m_id;
    }

    /**
     * Retrieves the ID of the associated book entity.
     * @returns The main book ID.
     */
    public getBookId(): number {
        return this.m_bookId;
    }

    /**
     * Retrieves the internal stock code assigned to this item.
     * @returns The stock code string.
     */
    public getStockCode(): string {
        return this.m_code;
    }

    /**
     * Retrieves the human-readable name/title of the book.
     * @returns The book name.
     */
    public getBookName(): string {
        return this.m_name;
    }

    /**
     * Retrieves the URL of the book's image.
     * @returns The image URL string, or null if not available.
     */
    public getBookImageUrl(): string | null {
        return this.m_imageUrl;
    }

    /**
     * Retrieves the current stock status of this book item.
     * @returns The stock status as a BookStockStatusEnum value.
     */
    public getStockStatus(): BookStockStatusEnum {
        return this.m_status;
    }
}