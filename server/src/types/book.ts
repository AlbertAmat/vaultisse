import {BookStockStatusEnum} from "./book/IBookStock";
import {ReadingStatusEnum} from "./book/IReadingStatus";

export interface BookAuthor {
    id: number;
    name: string;
}

export interface BookSearchResult {
    id: number;
    name: string;
    image_url: string | null;
    isbn: string | null;
    category_id: number | null;
    language_code: string | null;
    reading_status: ReadingStatusEnum | null;
    authors: BookAuthor[];
}

export interface BookSearchFilter {
    query?: string;
    categoryId?: number[];
    filters: string[];
    dateFrom?: string;
    dateTo?: string;
    sort: string;
    page: number;
}

export interface BookCounters {
    total: number;
    recent: number;
    onLoan: number;
    noStock: number;
    wantToRead: number;
    currentlyReading: number;
}

export interface BookStockDetail {
    id: number;
    code: string;
    status: BookStockStatusEnum;
    location_id: number | null;
    location_name: string | null;
    customer_id: number | null;
    customer_name: string | null;
}

export interface BookFileMeta {
    id: number;
    file_type: "epub" | "pdf" | "mobi";
    file_name: string;
    file_size: number;
    date_created: string;
}

export interface BookDetail {
    id: number;
    name: string;
    description: string | null;
    image_url: string | null;
    isbn: string | null;
    category_id: number | null;
    language_code: string | null;
    publisher: string | null;
    published_date: string | null;
    date_created: string;
    date_updated: string;
    pages: number | null;
    format_id: number | null;
    reading_status: ReadingStatusEnum | null;
    files: BookFileMeta[];
    stocks: BookStockDetail[];
    authors: BookAuthor[];
    /** Display name of whoever added this book to the vault, or null if unknown (predates tracking, or that account has since been deleted). */
    created_by: string | null;
}

export interface UpdateBookFields {
    name: string;
    description: string | null;
    image_url: string | null;
    isbn: string | null;
    category_id: number | null;
    language_code: string | null;
    authors?: number[];
    publisher: string | null;
    published_date: string | null;
    pages: number | null;
    format_id: number | null;
    reading_status: ReadingStatusEnum | null;
}

/** Metadata resolved from an ISBN lookup, shaped for BookRepository's find-or-create helpers. */
export interface IsbnBookInput {
    name: string;
    description?: string;
    imageUrl: string | null;
    isbnCode: string;
    categoryId: number | null;
    publisher: string | null;
    formattedPublishedDate: string | null;
    languageCode: string | null;
    pages: number | null;
}

/** Row shape ImportEnrichmentService reads before deciding what's still missing to fill in. */
export interface BookEnrichmentRow {
    id: number;
    name: string;
    isbn: string | null;
    description: string | null;
    image_url: string | null;
    publisher: string | null;
    published_date: Date | string | null;
    language_code: string | null;
    pages: number | null;
    category_id: number | null;
}

export interface BookFileForDownload {
    file_data: Buffer;
    file_name: string;
    file_type: "epub" | "pdf" | "mobi";
}
