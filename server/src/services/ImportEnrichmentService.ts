/**
 * Post-import metadata fill. CSV import must return before nginx's
 * proxy_read_timeout; this walks the new rows afterwards and fills empty
 * cover / description / publisher / date / language / pages / category
 * from Open Library (and Google / LibraryThing / Wikipedia when those
 * helpers would).
 */
import {Pool} from "pg";
import {BookRepository} from "../repositories/BookRepository";
import {BookMetadataRepository} from "../repositories/BookMetadataRepository";
import {BookEnrichmentRow} from "../types/book";

const ENRICH_CONCURRENCY = 3;

/** Business logic for the deferred post-import metadata fill. Calls BookRepository/BookMetadataRepository. */
export class ImportEnrichmentService {
    /**
     * @param pool Database connection pool, forwarded to fresh repositories on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Fires off `enrichImportedBooks` on the next event-loop tick, without awaiting it - the CSV-import response must
     * return before nginx's `proxy_read_timeout`, so enrichment runs in the background instead.
     * @param vaultId Vault id.
     * @param bookIds Freshly-imported book ids to enrich.
     * @param googleApiKey Optional Google Books API key.
     * @param libraryThingApiKey Optional LibraryThing API key.
     */
    public scheduleEnrichment(
        vaultId: number,
        bookIds: number[],
        googleApiKey?: string,
        libraryThingApiKey?: string
    ): void {
        if (bookIds.length === 0) {
            return;
        }
        setImmediate(() => {
            this.enrichImportedBooks(vaultId, bookIds, googleApiKey, libraryThingApiKey).catch((err) => {
                console.error("Import enrichment failed:", err);
            });
        });
    }

    /**
     * Enriches a batch of freshly-imported books, a few at a time.
     * @param vaultId Vault id.
     * @param bookIds Book ids to enrich.
     * @param googleApiKey Optional Google Books API key.
     * @param libraryThingApiKey Optional LibraryThing API key.
     */
    public async enrichImportedBooks(
        vaultId: number,
        bookIds: number[],
        googleApiKey?: string,
        libraryThingApiKey?: string
    ): Promise<void> {
        for (let i = 0; i < bookIds.length; i += ENRICH_CONCURRENCY) {
            const batch = bookIds.slice(i, i + ENRICH_CONCURRENCY);
            await Promise.all(batch.map((id) => this.enrichOneBook(vaultId, id, googleApiKey, libraryThingApiKey)));
        }
    }

    /**
     * Fills in a single book's still-empty fields from looked-up metadata.
     * @param vaultId Vault id.
     * @param bookId Book id.
     * @param googleApiKey Optional Google Books API key.
     * @param libraryThingApiKey Optional LibraryThing API key.
     */
    private async enrichOneBook(
        vaultId: number,
        bookId: number,
        googleApiKey?: string,
        libraryThingApiKey?: string
    ): Promise<void> {
        const repo = new BookRepository(this.pool);
        const book = await repo.findRowForEnrichment(bookId, vaultId);
        if (!book || !this.needsEnrichment(book)) {
            return;
        }

        const authors = await repo.getAuthorNames(bookId, vaultId);
        let description: string | null = null;
        let imageUrl: string | null = null;
        let publisher: string | null = null;
        let publishedDate: string | null = null;
        let language: string | null = null;
        let pages: number | null = null;
        let categoryName: string | null = null;

        if (book.isbn) {
            const meta = await BookMetadataRepository.fetchBookMetadata(book.isbn, googleApiKey, libraryThingApiKey);
            if (meta) {
                description = meta.description ?? null;
                imageUrl = meta.imageLinks?.thumbnail ?? null;
                publisher = meta.publisher ?? null;
                publishedDate = this.formatPublishedDate(meta.publishedDate);
                language = BookMetadataRepository.normalizeLanguageCode(meta.language);
                pages = meta.pageCount && meta.pageCount > 0 ? meta.pageCount : null;
                categoryName = meta.categories?.[0] ?? null;
            }
        }

        if (!imageUrl && !book.image_url) {
            imageUrl = await BookMetadataRepository.resolveBookCover({
                isbn: book.isbn,
                title: book.name,
                authors,
                libraryThingApiKey,
            });
        }

        if (language) {
            await repo.ensureLanguage(language);
        }
        const categoryId = book.category_id ?? await this.ensureCategory(categoryName, vaultId);

        await repo.fillEmptyFields(
            bookId,
            {
                name: book.name,
                isbnCode: book.isbn ?? "",
                description: description ?? undefined,
                imageUrl,
                categoryId,
                publisher: publisher ? publisher.slice(0, 100) : null,
                formattedPublishedDate: publishedDate,
                languageCode: language,
                pages,
            },
            vaultId
        );
    }

    /**
     * Whether a book still has any field worth enriching.
     * @param book Book's enrichable fields.
     * @returns Whether enrichment is still needed.
     */
    private needsEnrichment(book: BookEnrichmentRow): boolean {
        return !book.image_url
            || !book.description
            || !book.publisher
            || !book.published_date
            || !book.language_code
            || !book.pages
            || !book.category_id;
    }

    /**
     * Finds or creates a category by name.
     * @param name Category name, or null to no-op.
     * @param vaultId Vault id.
     * @returns The category id, or null if `name` was null.
     */
    private async ensureCategory(name: string | null, vaultId: number): Promise<number | null> {
        if (!name) {
            return null;
        }
        const repo = new BookRepository(this.pool);
        const existing = await repo.findCategoryByName(name, vaultId);
        if (existing !== null) {
            return existing;
        }
        return repo.insertCategory(name, vaultId);
    }

    /**
     * Parses and reformats a looked-up published-date string to `YYYY-MM-DD`.
     * @param date Raw published-date string, if any.
     * @returns The formatted date, or null if unparseable/absent.
     */
    private formatPublishedDate(date: string | undefined): string | null {
        if (!date) {
            return null;
        }
        const parsed = new Date(date);
        if (Number.isNaN(parsed.getTime())) {
            return null;
        }
        return parsed.toISOString().split("T")[0];
    }
}
