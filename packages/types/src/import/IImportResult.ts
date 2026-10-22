/**
 * Response from `POST /import/library` (see `ImportRoute.ts`): every row is
 * attempted independently, so a partial success (some rows skipped or
 * failed) still comes back as a 200 with these counts, never as an error.
 *
 * @example
 * const result: IImportResult = { imported: 41, skipped: 3, failed: 1, errors: [{row: 12, title: "Some Book", reason: "Missing title"}] };
 */
export interface IImportResult {
    /** Number of rows successfully inserted as new books. */
    imported: number;
    /** Number of rows skipped as a likely duplicate of a book already in the library (matched by ISBN, or by title when there's no ISBN). */
    skipped: number;
    /** Number of rows that failed to import - see `errors` for why. */
    failed: number;
    /** Up to 50 reasons for the rows counted in `failed`. */
    errors: IImportRowError[];
}

/** One failed row from an import - see `IImportResult.errors`. */
export interface IImportRowError {
    /** 1-based row number in the source CSV (header row excluded). */
    row: number;
    /** The row's book title, when the parser could read one. */
    title?: string;
    /** Why the row failed. */
    reason: string;
}

/** The two library-export formats `POST /import/library` accepts as `origin` - see `PARSERS` in `ImportRoute.ts`. */
export type ImportOrigin = "vaultisse" | "goodreads";
