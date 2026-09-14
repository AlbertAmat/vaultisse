import {Pool} from "pg";
import {ImportRepository} from "../repositories/ImportRepository";
import {BookRepository} from "../repositories/BookRepository";
import {BookService} from "./BookService";
import {IImportedBook} from "../routes/import-export/parsers/IImportedBook";
import {GoodreadsCsvParser} from "../routes/import-export/parsers/GoodreadsCsvParser";
import {VaultisseCsvParser} from "../routes/import-export/parsers/VaultisseCsvParser";
import {ImportError, ImportResult} from "../types/import";
import {NotFoundError, ValidationError} from "../errors/DomainError";

// Capped so a file with thousands of bad rows doesn't blow up the response body.
const MAX_REPORTED_ERRORS = 50;

/** Business logic for the CSV-import flow: parsing, per-row insert with duplicate detection, and the origin/template registries. Calls ImportRepository/BookRepository (+ BookService.isAllowedImageUrl for the cover-URL allowlist); throws DomainError subclasses for expected failures. */
export class ImportService {
    /**
     * Registry of supported `origin` values. Each parser turns a raw file's text
     * into the shared `IImportedBook[]` shape - add an entry here (and a parser
     * in `parsers/`) to support another source, e.g. a Vaultisse-to-Vaultisse
     * export once `POST /export/library` exists.
     */
    private static readonly PARSERS: Record<string, (fileText: string) => IImportedBook[]> = {
        goodreads: (fileText) => GoodreadsCsvParser.parse(fileText),
        vaultisse: (fileText) => VaultisseCsvParser.parse(fileText),
    };

    /**
     * Downloadable starting-point CSVs for origins with no export of their own
     * to convert - someone building their library by hand fills this in rather
     * than guessing at column names. An origin like "goodreads" has nothing
     * here since it's exported directly from Goodreads, never hand-authored.
     */
    private static readonly TEMPLATES: Record<string, string> = {
        vaultisse: VaultisseCsvParser.TEMPLATE,
    };

    /**
     * @param pool Database connection pool, forwarded to fresh repositories on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Looks up the starting-point CSV template for an origin.
     * @param origin Import origin (e.g. "vaultisse").
     * @returns The template's CSV text.
     */
    public getTemplate(origin: string): string {
        const template = ImportService.TEMPLATES[origin];
        if (!template) {
            throw new NotFoundError("No template available for this origin");
        }
        return template;
    }

    /**
     * Parses a raw uploaded file into `IImportedBook[]` via the origin's registered parser.
     * @param origin Import origin.
     * @param fileText Raw uploaded file text.
     * @returns The parsed rows.
     */
    public parseImportFile(origin: string, fileText: string): IImportedBook[] {
        if (!origin) {
            throw new ValidationError("Missing import origin");
        }
        const parseFile = ImportService.PARSERS[origin];
        if (!parseFile) {
            throw new ValidationError(`Unsupported import origin: ${origin}`);
        }
        try {
            return parseFile(fileText);
        } catch (err: any) {
            throw new ValidationError(`Invalid CSV file: ${err.message}`);
        }
    }

    /**
     * Truncates a string to fit a VARCHAR(maxLen) column instead of letting Postgres reject the whole insert.
     * @param value Value to truncate, or null.
     * @param maxLen Maximum length.
     * @returns The (possibly truncated) value, or null.
     */
    private truncate(value: string | null, maxLen: number): string | null {
        if (value === null) return null;
        return value.length > maxLen ? value.substring(0, maxLen) : value;
    }

    /**
     * Imports a batch of parsed rows. Each row is inserted independently (its
     * own transaction) - a bad row is skipped and reported rather than
     * failing the whole import.
     *
     * @param userId Owning user's id.
     * @param books Parsed rows to import.
     * @returns The import result summary and the ids of successfully-imported books.
     */
    public async importBooks(userId: number, books: IImportedBook[]): Promise<{result: ImportResult; importedIds: number[]}> {
        let imported = 0;
        let skipped = 0;
        const errors: ImportError[] = [];
        const importedIds: number[] = [];
        const client = await this.pool.connect();

        try {
            for (const book of books) {
                if (!book.name) {
                    errors.push({row: book.row, reason: "Missing title"});
                    continue;
                }

                try {
                    await client.query("BEGIN");

                    const repo = new ImportRepository(client);
                    const isDuplicate = book.isbn
                        ? await repo.existsByIsbn(book.isbn, userId)
                        : await repo.existsByName(book.name, userId);

                    if (isDuplicate) {
                        await client.query("ROLLBACK");
                        skipped++;
                        continue;
                    }

                    const formatId = await repo.findFormatId(book.formatName);
                    const categoryId = await repo.ensureCategory(book.categoryName ?? null, userId);
                    await new BookRepository(client).ensureLanguage(book.languageCode ?? null);

                    // CSV Cover column only (Vaultisse origin). Do not resolve a
                    // cover from ISBN here: a Goodreads export is hundreds of
                    // rows and that does several HTTP hops per book, so nginx
                    // hits proxy_read_timeout (504) while the import is still
                    // running - see ImportEnrichmentService for the deferred fill.
                    const imageUrl = book.imageUrl && BookService.isAllowedImageUrl(book.imageUrl) ? book.imageUrl : null;

                    const bookId = await repo.insertBook(userId, {
                        name: this.truncate(book.name, 255) as string,
                        description: book.description ?? null,
                        imageUrl,
                        isbn: book.isbn,
                        categoryId,
                        formatId,
                        publisher: this.truncate(book.publisher, 100),
                        publishedDate: book.publishedDate,
                        languageCode: book.languageCode ?? null,
                        pages: book.pages,
                        readingStatus: book.readingStatus ?? null,
                    });

                    await repo.ensureAuthors(bookId, book.authors, userId);

                    for (const locationName of book.locations ?? []) {
                        await repo.addStockAtLocation(bookId, locationName, userId);
                    }

                    await client.query("COMMIT");
                    importedIds.push(bookId);
                    imported++;
                } catch (err: any) {
                    await client.query("ROLLBACK");
                    errors.push({row: book.row, title: book.name, reason: err.message ?? "Unknown error"});
                }
            }
        } finally {
            client.release();
        }

        return {
            result: {imported, skipped, failed: errors.length, errors: errors.slice(0, MAX_REPORTED_ERRORS)},
            importedIds,
        };
    }
}
