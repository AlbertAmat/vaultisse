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

export function scheduleEnrichment(
    pool: Pool,
    userId: number,
    bookIds: number[],
    googleApiKey?: string,
    libraryThingApiKey?: string
): void {
    if (bookIds.length === 0) {
        return;
    }
    setImmediate(() => {
        enrichImportedBooks(pool, userId, bookIds, googleApiKey, libraryThingApiKey).catch((err) => {
            console.error("Import enrichment failed:", err);
        });
    });
}

export async function enrichImportedBooks(
    pool: Pool,
    userId: number,
    bookIds: number[],
    googleApiKey?: string,
    libraryThingApiKey?: string
): Promise<void> {
    for (let i = 0; i < bookIds.length; i += ENRICH_CONCURRENCY) {
        const batch = bookIds.slice(i, i + ENRICH_CONCURRENCY);
        await Promise.all(batch.map((id) => enrichOneBook(pool, userId, id, googleApiKey, libraryThingApiKey)));
    }
}

async function enrichOneBook(
    pool: Pool,
    userId: number,
    bookId: number,
    googleApiKey?: string,
    libraryThingApiKey?: string
): Promise<void> {
    const repo = new BookRepository(pool);
    const book = await repo.findRowForEnrichment(bookId, userId);
    if (!book || !needsEnrichment(book)) {
        return;
    }

    const authors = await repo.getAuthorNames(bookId, userId);
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
            publishedDate = formatPublishedDate(meta.publishedDate);
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
    const categoryId = book.category_id ?? await ensureCategory(pool, categoryName, userId);

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
        userId
    );
}

function needsEnrichment(book: BookEnrichmentRow): boolean {
    return !book.image_url
        || !book.description
        || !book.publisher
        || !book.published_date
        || !book.language_code
        || !book.pages
        || !book.category_id;
}

async function ensureCategory(pool: Pool, name: string | null, userId: number): Promise<number | null> {
    if (!name) {
        return null;
    }
    const repo = new BookRepository(pool);
    const existing = await repo.findCategoryByName(name, userId);
    if (existing !== null) {
        return existing;
    }
    return repo.insertCategory(name, userId);
}

function formatPublishedDate(date: string | undefined): string | null {
    if (!date) {
        return null;
    }
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toISOString().split("T")[0];
}
