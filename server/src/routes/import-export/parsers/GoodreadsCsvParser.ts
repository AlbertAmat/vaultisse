/**
 * Parses a Goodreads "Export Library" CSV (My Books -> Import and Export,
 * or directly at goodreads.com/review/import - desktop browser only) into
 * `IImportedBook[]`. Goodreads shut down its public API to new integrations
 * in December 2020, so this CSV export is the only supported way left to get
 * a user's library out of Goodreads and into Vaultisse.
 *
 * The "Exclusive Shelf" column - to-read / currently-reading / read - maps
 * onto Vaultisse's own `reading_status` (see `EXCLUSIVE_SHELF_TO_READING_STATUS`
 * below), so a Goodreads import lands each book directly on the matching
 * Library nav filter instead of coming in untracked.
 */
import {parse} from "csv-parse/sync";
import {IImportedBook} from "./IImportedBook";
import {IsbnVerification} from "../../../utils/IsbnVerification";
import {ReadingStatusEnum} from "../../../types/book/IReadingStatus";

/**
 * Raw shape of one row from a Goodreads "Export Library" CSV, keyed by its
 * exact header names. Every field is optional: `relax_column_count` (see
 * `GoodreadsCsvParser.parse` below) lets a row have fewer columns than the
 * header, in which case csv-parse simply omits the trailing keys rather than
 * filling them with empty strings.
 */
interface IGoodreadsCsvRow {
    "Book Id"?: string;
    "Title"?: string;
    "Author"?: string;
    "Author l-f"?: string;
    "Additional Authors"?: string;
    "ISBN"?: string;
    "ISBN13"?: string;
    "My Rating"?: string;
    "Publisher"?: string;
    "Binding"?: string;
    "Number of Pages"?: string;
    "Year Published"?: string;
    "Original Publication Year"?: string;
    "Date Read"?: string;
    "Date Added"?: string;
    "Bookshelves"?: string;
    "Bookshelves with positions"?: string;
    "Exclusive Shelf"?: string;
    "My Review"?: string;
    "Spoiler"?: string;
    "Private Notes"?: string;
    "Read Count"?: string;
    "Owned Copies"?: string;
}

/** Parses a Goodreads "Export Library" CSV into `IImportedBook[]`. A static-only utility class - stateless, no DB access, same treatment as BookMetadataRepository.ts. */
export class GoodreadsCsvParser {
    /**
     * Goodreads' "Exclusive Shelf" column - the one shelf every book is on
     * (as opposed to "Bookshelves", which can list several custom shelves at
     * once) - always one of these three values. Anything else (a differently
     * localized export, or a future Goodreads shelf name) is left untracked
     * rather than guessed at.
     */
    private static readonly EXCLUSIVE_SHELF_TO_READING_STATUS: Record<string, ReadingStatusEnum> = {
        "to-read": ReadingStatusEnum.WANT_TO_READ,
        "currently-reading": ReadingStatusEnum.CURRENTLY_READING,
        "read": ReadingStatusEnum.READ,
    };

    /** Common Goodreads `Binding` values that don't literally match a `formats.name` row (see `assets/db/databaseSchema.sql`). */
    private static readonly BINDING_SYNONYMS: Record<string, string> = {
        "kindle edition": "Electronic",
        "ebook": "Electronic",
        "leather bound": "Leatherbound",
    };

    /** Static-only utility class, never instantiated. */
    private constructor() {
    }

    /**
     * Parses a Goodreads "Export Library" CSV into `IImportedBook[]`.
     * @param csvText Raw file contents (already read into memory by multer).
     * @returns The parsed rows.
     * @throws If the file isn't parseable CSV at all - a malformed individual
     *         row still comes through as a row with an empty `name`, which
     *         `ImportService.importBooks` skips and reports rather than
     *         failing the batch.
     */
    public static parse(csvText: string): IImportedBook[] {
        const rows: IGoodreadsCsvRow[] = parse(csvText, {
            columns: true,
            skip_empty_lines: true,
            relax_column_count: true,
            bom: true,
        });

        return rows.map((row, index) => ({
            row: index + 1,
            name: row.Title?.trim() ?? "",
            isbn: GoodreadsCsvParser.toIsbn(row),
            authors: GoodreadsCsvParser.toAuthors(row),
            publisher: row.Publisher?.trim() || null,
            publishedDate: GoodreadsCsvParser.yearToDate(row),
            pages: GoodreadsCsvParser.toPages(row["Number of Pages"]),
            formatName: GoodreadsCsvParser.normalizeFormatName(row.Binding),
            description: GoodreadsCsvParser.toDescription(row),
            readingStatus: GoodreadsCsvParser.toReadingStatus(row["Exclusive Shelf"]),
            locations: GoodreadsCsvParser.toLocationNames(row.Bookshelves),
        }));
    }

    /**
     * Maps a Goodreads "Exclusive Shelf" value to Vaultisse's `reading_status`.
     * @param shelf Raw "Exclusive Shelf" cell value.
     * @returns The mapped reading status, or null if unrecognized/absent.
     */
    private static toReadingStatus(shelf: string | undefined): ReadingStatusEnum | null {
        const trimmed = shelf?.trim().toLowerCase();
        return trimmed ? GoodreadsCsvParser.EXCLUSIVE_SHELF_TO_READING_STATUS[trimmed] ?? null : null;
    }

    /**
     * "Bookshelves" lists every shelf a book is on, including its one
     * "Exclusive Shelf" redundantly - a book on "office" also lists it as
     * "office" here (or "office, to-read" if it's on both). Any shelf that
     * isn't one of the three built-in reading-status ones is a custom shelf,
     * which - short of anything else in a Goodreads export to go on - is
     * treated as where the user keeps that physical copy, one Vaultisse stock
     * per custom shelf (see `locations` on `IImportedBook`).
     *
     * @param bookshelves Raw "Bookshelves" cell value.
     * @returns The distinct custom shelf names, in first-seen order.
     */
    private static toLocationNames(bookshelves: string | undefined): string[] {
        if (!bookshelves) return [];

        const seen = new Set<string>();
        const names: string[] = [];

        for (const raw of bookshelves.split(",")) {
            const name = raw.trim();
            if (!name || name.toLowerCase() in GoodreadsCsvParser.EXCLUSIVE_SHELF_TO_READING_STATUS) continue;

            const key = name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                names.push(name);
            }
        }

        return names;
    }

    /**
     * Goodreads wraps ISBN/ISBN13 in an Excel "treat as text" formula
     * (`="1451648537"`, or `=""` when absent) so spreadsheet apps don't mangle
     * leading zeros / drop them as numbers - strip that wrapper before use.
     * @param value Raw cell value.
     * @returns The unwrapped value.
     */
    private static unwrapExcelFormula(value: string | undefined): string {
        if (!value) return "";
        const match = value.match(/^="(.*)"$/);
        return match ? match[1] : value;
    }

    /**
     * Normalizes a raw `Binding` cell value to a `formats.name`-matching name.
     * @param binding Raw "Binding" cell value.
     * @returns The normalized format name, or null.
     */
    private static normalizeFormatName(binding: string | undefined): string | null {
        const trimmed = binding?.trim();
        if (!trimmed) return null;
        return GoodreadsCsvParser.BINDING_SYNONYMS[trimmed.toLowerCase()] ?? trimmed;
    }

    /**
     * `Year Published` (falling back to `Original Publication Year`) is all Goodreads gives us - no month/day.
     * @param row Raw CSV row.
     * @returns A `YYYY-01-01` date string, or null.
     */
    private static yearToDate(row: IGoodreadsCsvRow): string | null {
        const year = row["Year Published"]?.trim() || row["Original Publication Year"]?.trim();
        return year && /^\d{4}$/.test(year) ? `${year}-01-01` : null;
    }

    /**
     * Parses a page-count cell value.
     * @param value Raw "Number of Pages" cell value.
     * @returns The positive page count, or null.
     */
    private static toPages(value: string | undefined): number | null {
        const pages = parseInt(value ?? "", 10);
        return Number.isFinite(pages) && pages > 0 ? pages : null;
    }

    /**
     * Extracts and validates the book's ISBN, preferring ISBN13 then falling back to ISBN.
     * @param row Raw CSV row.
     * @returns The normalized/validated ISBN, or null.
     */
    private static toIsbn(row: IGoodreadsCsvRow): string | null {
        const isbn13 = GoodreadsCsvParser.unwrapExcelFormula(row.ISBN13);
        const isbn10 = GoodreadsCsvParser.unwrapExcelFormula(row.ISBN);
        return IsbnVerification.normalizeAndValidateIsbn(isbn13) ?? IsbnVerification.normalizeAndValidateIsbn(isbn10);
    }

    /**
     * Combines the primary and additional-authors columns into one list.
     * @param row Raw CSV row.
     * @returns The author names.
     */
    private static toAuthors(row: IGoodreadsCsvRow): string[] {
        const additional = row["Additional Authors"]
            ? row["Additional Authors"].split(",").map((name) => name.trim())
            : [];
        return [row.Author, ...additional]
            .map((name) => name?.trim())
            .filter((name): name is string => !!name);
    }

    /**
     * Picks a description from the row's review/notes columns, preferring the review.
     * @param row Raw CSV row.
     * @returns The description, or null.
     */
    private static toDescription(row: IGoodreadsCsvRow): string | null {
        const review = row["My Review"]?.trim();
        if (review) {
            return review;
        }
        const notes = row["Private Notes"]?.trim();
        return notes || null;
    }
}
