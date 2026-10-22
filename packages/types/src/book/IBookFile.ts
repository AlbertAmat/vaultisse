/**
 * Metadata for one of a book's optional backed-up ebook files - up to one
 * per `file_type`. Never carries the file bytes - those are only fetched
 * via the download endpoint.
 *
 * @example
 * const f: IBookFile = { id: 3, file_type: "epub", file_name: "hobbit.epub", file_size: 512000, date_created: "2026-08-30T00:00:00.000Z" };
 */
export interface IBookFile {
    /** File id. */
    id: number;
    /** Whether the backed-up file is an epub, a pdf, or a Kindle (.mobi/.azw3) file. */
    file_type: "epub" | "pdf" | "mobi";
    /** Original file name, used for the download and displayed to the user. */
    file_name: string;
    /** File size in bytes. */
    file_size: number;
    /** Upload timestamp (ISO string). */
    date_created: string;
}
