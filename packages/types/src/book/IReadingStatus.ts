/**
 * A user's personal reading progress for a book (`books.reading_status`),
 * independent of the physical stock lifecycle (`BookStockStatusEnum`) - this
 * tracks whether *the user* wants to/is/has read the book, not whether a
 * copy is on a shelf or loaned out. `null` means untracked (the default for
 * any book not explicitly placed on one of these three "shelves"). Also compiled
 * into the server (see `server/scripts/sync-shared-types.js`).
 *
 * @example
 * if (book.getReadingStatus() === ReadingStatusEnum.CURRENTLY_READING) { ... }
 */
export enum ReadingStatusEnum {
    /** On the user's to-read list. */
    WANT_TO_READ = 0,
    /** In progress. */
    CURRENTLY_READING = 1,
    /** Finished. */
    READ = 2
}
