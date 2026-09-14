import {Pool} from "pg";
import * as ImportRepository from "../repositories/ImportRepository";
import {BookRepository} from "../repositories/BookRepository";
import {BookService} from "./BookService";
import {IImportedBook} from "../routes/import-export/parsers/IImportedBook";
import {parseGoodreadsCsv} from "../routes/import-export/parsers/GoodreadsCsvParser";
import {parseVaultisseCsv, VAULTISSE_CSV_TEMPLATE} from "../routes/import-export/parsers/VaultisseCsvParser";
import {ImportError, ImportResult} from "../types/import";
import {NotFoundError, ValidationError} from "../errors/DomainError";

/**
 * Registry of supported `origin` values. Each parser turns a raw file's text
 * into the shared `IImportedBook[]` shape - add an entry here (and a parser
 * in `parsers/`) to support another source, e.g. a Vaultisse-to-Vaultisse
 * export once `POST /export/library` exists.
 */
const PARSERS: Record<string, (fileText: string) => IImportedBook[]> = {
    goodreads: parseGoodreadsCsv,
    vaultisse: parseVaultisseCsv,
};

/**
 * Downloadable starting-point CSVs for origins with no export of their own
 * to convert - someone building their library by hand fills this in rather
 * than guessing at column names. An origin like "goodreads" has nothing
 * here since it's exported directly from Goodreads, never hand-authored.
 */
const TEMPLATES: Record<string, string> = {
    vaultisse: VAULTISSE_CSV_TEMPLATE,
};

// Capped so a file with thousands of bad rows doesn't blow up the response body.
const MAX_REPORTED_ERRORS = 50;

export function getTemplate(origin: string): string {
    const template = TEMPLATES[origin];
    if (!template) {
        throw new NotFoundError("No template available for this origin");
    }
    return template;
}

export function parseImportFile(origin: string, fileText: string): IImportedBook[] {
    if (!origin) {
        throw new ValidationError("Missing import origin");
    }
    const parseFile = PARSERS[origin];
    if (!parseFile) {
        throw new ValidationError(`Unsupported import origin: ${origin}`);
    }
    try {
        return parseFile(fileText);
    } catch (err: any) {
        throw new ValidationError(`Invalid CSV file: ${err.message}`);
    }
}

/** Truncates a string to fit a VARCHAR(maxLen) column instead of letting Postgres reject the whole insert. */
function truncate(value: string | null, maxLen: number): string | null {
    if (value === null) return null;
    return value.length > maxLen ? value.substring(0, maxLen) : value;
}

/**
 * Each row is inserted independently (its own transaction) - a bad row is
 * skipped and reported rather than failing the whole import.
 */
export async function importBooks(pool: Pool, userId: number, books: IImportedBook[]): Promise<{result: ImportResult; importedIds: number[]}> {
    let imported = 0;
    let skipped = 0;
    const errors: ImportError[] = [];
    const importedIds: number[] = [];
    const client = await pool.connect();

    try {
        for (const book of books) {
            if (!book.name) {
                errors.push({row: book.row, reason: "Missing title"});
                continue;
            }

            try {
                await client.query("BEGIN");

                const isDuplicate = book.isbn
                    ? await ImportRepository.existsByIsbn(client, book.isbn, userId)
                    : await ImportRepository.existsByName(client, book.name, userId);

                if (isDuplicate) {
                    await client.query("ROLLBACK");
                    skipped++;
                    continue;
                }

                const formatId = await ImportRepository.findFormatId(client, book.formatName);
                const categoryId = await ImportRepository.ensureCategory(client, book.categoryName ?? null, userId);
                await new BookRepository(client).ensureLanguage(book.languageCode ?? null);

                // CSV Cover column only (Vaultisse origin). Do not resolve a
                // cover from ISBN here: a Goodreads export is hundreds of
                // rows and that does several HTTP hops per book, so nginx
                // hits proxy_read_timeout (504) while the import is still
                // running - see ImportEnrichmentService for the deferred fill.
                const imageUrl = book.imageUrl && BookService.isAllowedImageUrl(book.imageUrl) ? book.imageUrl : null;

                const bookId = await ImportRepository.insertBook(client, userId, {
                    name: truncate(book.name, 255) as string,
                    description: book.description ?? null,
                    imageUrl,
                    isbn: book.isbn,
                    categoryId,
                    formatId,
                    publisher: truncate(book.publisher, 100),
                    publishedDate: book.publishedDate,
                    languageCode: book.languageCode ?? null,
                    pages: book.pages,
                    readingStatus: book.readingStatus ?? null,
                });

                await ImportRepository.ensureAuthors(client, bookId, book.authors, userId);

                for (const locationName of book.locations ?? []) {
                    await ImportRepository.addStockAtLocation(client, bookId, locationName, userId);
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
