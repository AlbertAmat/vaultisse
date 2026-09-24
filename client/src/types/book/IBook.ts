import IBookItem from "@/types/book/IBookItem";
import {IBookStock} from "@/types/book/IBookStock";
import {IBookFile} from "@/types/book/IBookFile";

/**
 * Full book detail as returned by `GET /book/:id` - everything `IBookItem`
 * has plus description/publisher metadata and the full list of physical
 * stocks. Used on the book detail view.
 */
export default interface IBook extends IBookItem {
    /** Free-text description, or null if unset. */
    description: string | null;
    /** Publisher name, or null if unset. */
    publisher: string | null;
    /** Publication date (ISO string), or null if unset. */
    published_date: string | null;
    /** Page count, or null if unset. */
    pages: number | null;
    /** All physical stocks (copies) of this book. */
    stocks: IBookStock[];
    /** Format id, or null if unset. */
    format_id: number | null;
    /** Creation timestamp (ISO string). */
    date_created: string;
    /** Last-updated timestamp (ISO string). */
    date_updated: string;
    /** This book's backed-up ebook files, up to one per type (epub/pdf/mobi). */
    files: IBookFile[];
    /** Display name of whoever added this book to the vault, or null if unknown (predates tracking, or that account has since been deleted). */
    created_by: string | null;
}
