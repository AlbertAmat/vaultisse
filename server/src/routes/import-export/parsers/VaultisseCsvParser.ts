/**
 * Parses Vaultisse's own hand-fillable CSV format - for someone who doesn't
 * have a Goodreads (or other) export to convert, and instead wants to build
 * a spreadsheet of their books from scratch. `GET /import/template/vaultisse`
 * (see `ImportRoute.ts`) hands out `VaultisseCsvParser.TEMPLATE` below as a
 * starting point, with the exact headers this parser expects.
 *
 * Unlike `GoodreadsCsvParser.ts`, this format is ours to define, so it's
 * kept deliberately simple: one column per `IImportedBook` field, plain
 * values, no origin-specific quirks to work around.
 */
import {parse} from "csv-parse/sync";
import {IImportedBook} from "./IImportedBook";
import {IsbnVerification} from "../../../utils/IsbnVerification";
import {ReadingStatusEnum} from "../../../types/book/IReadingStatus";

/** Parses Vaultisse's own hand-fillable CSV format into `IImportedBook[]`. A static-only utility class - stateless, no DB access, same treatment as BookMetadataRepository.ts/GoodreadsCsvParser.ts. */
export class VaultisseCsvParser {
    /** Column headers this parser expects, in order. */
    public static readonly HEADERS = [
        "Title", "Authors", "ISBN", "Publisher", "Published Year",
        "Pages", "Format", "Category", "Description", "Language", "Cover", "Reading Status"
    ];

    /** Matches `GoodreadsCsvParser.ts`'s shelf names, so the two origins share one vocabulary. */
    private static readonly READING_STATUS_VALUES: Record<string, ReadingStatusEnum> = {
        "want-to-read": ReadingStatusEnum.WANT_TO_READ,
        "currently-reading": ReadingStatusEnum.CURRENTLY_READING,
        "read": ReadingStatusEnum.READ,
    };

    /** Handed out by `GET /import/template/vaultisse` - the header row plus one filled-in example row to copy/replace. */
    public static readonly TEMPLATE = [
        VaultisseCsvParser.toCsvRow(VaultisseCsvParser.HEADERS),
        VaultisseCsvParser.toCsvRow([
            "The Hobbit", "J.R.R. Tolkien", "9780261102217", "HarperCollins", "1937",
            "310", "Paperback", "Fantasy", "A hobbit's unexpected journey.", "en",
            "https://covers.openlibrary.org/b/isbn/9780261102217-M.jpg", "want-to-read"
        ])
    ].join("\r\n") + "\r\n";

    /** Static-only utility class, never instantiated. */
    private constructor() {
    }

    /**
     * Maps a raw "Reading Status" cell value to Vaultisse's `reading_status`.
     * @param value Raw cell value.
     * @returns The mapped reading status, or null if unrecognized/absent.
     */
    private static toReadingStatus(value: string | undefined): ReadingStatusEnum | null {
        const trimmed = value?.trim().toLowerCase();
        return trimmed ? VaultisseCsvParser.READING_STATUS_VALUES[trimmed] ?? null : null;
    }

    /**
     * Wraps every field in quotes (escaping internal ones) - always valid CSV, no need to reason about which fields happen to contain a comma.
     * @param values Row values.
     * @returns The CSV-encoded row.
     */
    private static toCsvRow(values: string[]): string {
        return values.map((value) => `"${value.replace(/"/g, '""')}"`).join(",");
    }

    /**
     * Splits a semicolon-separated authors cell into names.
     * Multiple authors are semicolon-separated (`;`) - unlike Goodreads' comma-separated column, a name itself may contain a comma ("Lastname, Firstname").
     * @param value Raw "Authors" cell value.
     * @returns The author names.
     */
    private static toAuthors(value: string | undefined): string[] {
        if (!value) return [];
        return value.split(";").map((name) => name.trim()).filter(Boolean);
    }

    /**
     * Parses a page-count cell value.
     * @param value Raw "Pages" cell value.
     * @returns The positive page count, or null.
     */
    private static toPages(value: string | undefined): number | null {
        const pages = parseInt(value ?? "", 10);
        return Number.isFinite(pages) && pages > 0 ? pages : null;
    }

    /**
     * Parses a 4-digit publication year cell into a `YYYY-01-01` date string.
     * @param value Raw "Published Year" cell value.
     * @returns The date string, or null.
     */
    private static toPublishedDate(value: string | undefined): string | null {
        const year = value?.trim();
        return year && /^\d{4}$/.test(year) ? `${year}-01-01` : null;
    }

    /**
     * Validates a language cell against `languages.code`'s `CHAR(2)` shape.
     * `languages.code` is `CHAR(2)` - anything else (missing, "unknown", a 3-letter code) is dropped rather than stored.
     * @param value Raw "Language" cell value.
     * @returns The 2-letter code, or null.
     */
    private static toLanguageCode(value: string | undefined): string | null {
        const code = value?.trim().toLowerCase();
        return code && /^[a-z]{2}$/.test(code) ? code : null;
    }

    /**
     * Parses Vaultisse's own hand-fillable CSV format into `IImportedBook[]`.
     * @param csvText Raw file contents (already read into memory by multer).
     * @returns The parsed rows.
     */
    public static parse(csvText: string): IImportedBook[] {
        const rows: Record<string, string>[] = parse(csvText, {
            columns: true,
            skip_empty_lines: true,
            relax_column_count: true,
            bom: true,
        });

        return rows.map((row, index) => ({
            row: index + 1,
            name: row.Title?.trim() ?? "",
            isbn: IsbnVerification.normalizeAndValidateIsbn(row.ISBN ?? ""),
            authors: VaultisseCsvParser.toAuthors(row.Authors),
            publisher: row.Publisher?.trim() || null,
            publishedDate: VaultisseCsvParser.toPublishedDate(row["Published Year"]),
            pages: VaultisseCsvParser.toPages(row.Pages),
            formatName: row.Format?.trim() || null,
            categoryName: row.Category?.trim() || null,
            description: row.Description?.trim() || null,
            languageCode: VaultisseCsvParser.toLanguageCode(row.Language),
            // A data:image/png|jpeg;base64,... URI or a URL from an allowed host
            // (see BookService.isAllowedImageUrl) - validated in
            // ImportService.ts, not here. Falls back to an ISBN cover lookup if
            // absent or rejected.
            imageUrl: row.Cover?.trim() || null,
            readingStatus: VaultisseCsvParser.toReadingStatus(row["Reading Status"]),
        }));
    }
}
