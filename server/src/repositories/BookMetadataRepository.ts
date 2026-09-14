/**
 * ISBN metadata lookup used by `POST /book/isbn/:isbn`.
 *
 * Google Books is optional (only called when a real API key is configured).
 * Open Library is the default source: edition (`/isbn/{isbn}.json` and
 * `/api/books`), the linked work (description / subjects / cover), then
 * `search.json`. A short Wikipedia extract fills an empty synopsis. Brand-new
 * regional ISBNs that aren't in those catalogs yet can still resolve from a
 * public ISBN product page (schema.org Book), then get a cover from an
 * Open Library title search of the same work.
 *
 * Cover images specifically get one more fallback after Open Library:
 * LibraryThing (only when `LIBRARYTHING_API_KEY` is configured), tried
 * before falling through to a Wikipedia page image.
 *
 * A static-method utility class, not a `Pool`-injected repository - this
 * module has zero database access and zero mutable state, only calls to
 * external catalogs/APIs, so it has no constructor dependency to inject
 * (same treatment as server/src/utils/FileSignature.ts/IsbnVerification.ts).
 */
import axios from "axios";

const USER_AGENT = "vaultisse-server/1.0 (homelab catalog)";
const JSON_HEADERS = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
};
const HTML_HEADERS = {
    "User-Agent": USER_AGENT,
    Accept: "text/html",
};

const GB_VOLUMES = "https://www.googleapis.com/books/v1/volumes";
const OL_SEARCH = "https://openlibrary.org/search.json";
const OL_API_BOOKS = "https://openlibrary.org/api/books";
const OL_ISBN = "https://openlibrary.org/isbn";
const OL_COVER_ISBN = "https://covers.openlibrary.org/b/isbn";
const OL_COVER_ID = "https://covers.openlibrary.org/b/id";
const ISBN_STORE = "https://www.paquebote.com";

/**
 * Bibliographic and terminological ISO 639-2 codes we see from Open Library
 * (`eng`, `spa`, `/languages/ger`, …) mapped onto the CHAR(2) `languages.code`
 * column. Anything else is dropped rather than overflowing that column.
 */
const ISO639_2_TO_1: Record<string, string> = {
    alb: "sq",
    ara: "ar",
    arm: "hy",
    baq: "eu",
    ben: "bn",
    bul: "bg",
    cat: "ca",
    chi: "zh",
    cze: "cs",
    ces: "cs",
    cym: "cy",
    dan: "da",
    deu: "de",
    dut: "nl",
    ell: "el",
    eng: "en",
    est: "et",
    eus: "eu",
    fin: "fi",
    fra: "fr",
    fre: "fr",
    geo: "ka",
    ger: "de",
    gle: "ga",
    glg: "gl",
    gre: "el",
    heb: "he",
    hin: "hi",
    hrv: "hr",
    hun: "hu",
    hye: "hy",
    ice: "is",
    ind: "id",
    isl: "is",
    ita: "it",
    jpn: "ja",
    kat: "ka",
    kor: "ko",
    lat: "la",
    lav: "lv",
    lit: "lt",
    mac: "mk",
    may: "ms",
    mkd: "mk",
    msa: "ms",
    nld: "nl",
    nor: "no",
    per: "fa",
    pol: "pl",
    por: "pt",
    ron: "ro",
    rum: "ro",
    rus: "ru",
    slk: "sk",
    slo: "sk",
    slv: "sl",
    spa: "es",
    sqi: "sq",
    srp: "sr",
    swe: "sv",
    tam: "ta",
    tel: "te",
    tha: "th",
    tur: "tr",
    ukr: "uk",
    urd: "ur",
    vie: "vi",
    wel: "cy",
    zho: "zh",
};

/** OL's missing-cover placeholder is a tiny GIF; reject anything that small. */
const MIN_COVER_BYTES = 800;
const MAX_INLINE_COVER_BYTES = 500_000;

/**
 * Unlike Open Library, LibraryThing responds 200 with a real image
 * Content-Type even when it has no cover for the ISBN - it serves a
 * transparent 1x1 GIF placeholder instead of a 404 (its API is meant to be
 * embedded directly in an <img src> without a pre-check). A real cover is
 * always far larger, so the placeholder is filtered out by size instead.
 */
const LIBRARYTHING_PLACEHOLDER_MAX_BYTES = 1000;

/** Google-shaped volume so `BooksRoute.ts` can keep its existing destructure. */
export interface BookVolumeInfo {
    title?: string;
    authors?: string[];
    description?: string;
    categories?: string[];
    publisher?: string;
    publishedDate?: string;
    pageCount?: number;
    language?: string;
    imageLinks?: {thumbnail?: string} | null;
}

/**
 * ISBN metadata lookup: Google Books/Open Library/Wikipedia/ISBN-store-page
 * fallback chain, plus every small parsing/normalizing helper it relies on.
 */
export class BookMetadataRepository {
    /** Static-only utility class, never instantiated. */
    private constructor() {
    }

    /**
     * Treat empty / the literal string "undefined" (from `String(undefined)` in
     * older AppService code) as "no key", so we never call Google with a junk key.
     * @param raw Raw configured API key value.
     * @returns The trimmed key, or undefined if it's effectively unset.
     */
    public static normalizeGoogleApiKey(raw: string | undefined | null): string | undefined {
        const trimmed = (raw ?? "").trim();
        if (!trimmed || trimmed === "undefined") {
            return undefined;
        }
        return trimmed;
    }

    /**
     * Normalize anything language-shaped (ISO 639-1, 639-2, `en-US`,
     * `/languages/eng`) down to a 2-letter code, or `null` if we can't.
     * @param language Raw language value from any source.
     * @returns A 2-letter language code, or null.
     */
    public static normalizeLanguageCode(language: string | null | undefined): string | null {
        if (!language) {
            return null;
        }
        let code = language.trim().toLowerCase();
        const slash = code.lastIndexOf("/");
        if (slash >= 0) {
            code = code.slice(slash + 1);
        }
        const base = code.split(/[-_]/)[0];
        if (/^[a-z]{2}$/.test(base)) {
            return base;
        }
        if (/^[a-z]{3}$/.test(base) && ISO639_2_TO_1[base]) {
            return ISO639_2_TO_1[base];
        }
        return null;
    }

    /**
     * Look up catalog metadata for a validated ISBN-10/13. Returns `null` when no
     * source produced a title (the route maps that to 404). Network failures in
     * any one source are swallowed so the others can still succeed.
     * @param isbn Validated ISBN-10/13.
     * @param googleApiKey Optional Google Books API key.
     * @param libraryThingApiKey Optional LibraryThing API key, for the cover fallback.
     * @returns The merged metadata, or null if no source resolved a title.
     */
    public static async fetchBookMetadata(
        isbn: string,
        googleApiKey?: string,
        libraryThingApiKey?: string
    ): Promise<BookVolumeInfo | null> {
        const merged: BookVolumeInfo = {};
        let resolvedFromCatalog = false;

        const openLibrary = await BookMetadataRepository.fetchOpenLibraryByIsbn(isbn);
        if (openLibrary?.title) {
            BookMetadataRepository.mergeVolume(merged, openLibrary);
            resolvedFromCatalog = true;
        }

        const key = BookMetadataRepository.normalizeGoogleApiKey(googleApiKey);
        if (key) {
            const google = await BookMetadataRepository.fetchGoogleBooks(isbn, key);
            if (google?.title) {
                BookMetadataRepository.mergeVolume(merged, google);
                resolvedFromCatalog = true;
            }
        }

        if (!resolvedFromCatalog) {
            const store = await BookMetadataRepository.fetchIsbnStoreHint(isbn);
            if (store?.title) {
                BookMetadataRepository.mergeVolume(merged, store);
                const byTitle = await BookMetadataRepository.fetchOpenLibraryByTitle(store.title, store.authors?.[0]);
                BookMetadataRepository.mergeVolume(merged, byTitle);
            }
        }

        if (merged.title && !merged.imageLinks?.thumbnail) {
            const cover = await BookMetadataRepository.resolveCatalogCover({
                isbn,
                title: merged.title,
                authors: merged.authors,
                libraryThingApiKey,
            });
            if (cover) {
                merged.imageLinks = {thumbnail: cover};
            }
        }

        if (merged.title && (BookMetadataRepository.isShortDescription(merged.description) || !merged.imageLinks?.thumbnail)) {
            const wiki = await BookMetadataRepository.fetchWikipediaExtras(merged.title, merged.authors?.[0] ?? "");
            if (wiki.description) {
                BookMetadataRepository.mergeVolume(merged, {description: wiki.description});
            }
            if (wiki.cover && !merged.imageLinks?.thumbnail) {
                merged.imageLinks = {thumbnail: wiki.cover};
            }
        }

        return merged.title ? merged : null;
    }

    /**
     * Best-effort cover: Open Library by ISBN, then another edition of the same
     * work (title + author search), then LibraryThing (only when
     * `libraryThingApiKey` is given), then a Wikipedia page image stored as a
     * `data:` URI so we don't have to widen the CSP allowlist.
     * @param input ISBN/title/authors and optional LibraryThing API key.
     * @returns A cover image URL/data-URI, or null if none was found.
     */
    public static async resolveBookCover(input: {
        isbn?: string | null;
        title?: string | null;
        authors?: string[] | null;
        libraryThingApiKey?: string;
    }): Promise<string | null> {
        const fromCatalog = await BookMetadataRepository.resolveCatalogCover(input);
        if (fromCatalog) {
            return fromCatalog;
        }
        if (input.title) {
            const wiki = await BookMetadataRepository.fetchWikipediaExtras(input.title, input.authors?.[0] ?? "");
            return wiki.cover ?? null;
        }
        return null;
    }

    /**
     * Tries Open Library (by ISBN, then by title), then LibraryThing.
     * @param input ISBN/title/authors and optional LibraryThing API key.
     * @returns A cover image URL, or null if none was found.
     */
    private static async resolveCatalogCover(input: {
        isbn?: string | null;
        title?: string | null;
        authors?: string[] | null;
        libraryThingApiKey?: string;
    }): Promise<string | null> {
        if (input.isbn) {
            const byIsbn = await BookMetadataRepository.fetchOpenLibraryCover(input.isbn);
            if (byIsbn) {
                return byIsbn;
            }
        }
        if (input.title) {
            const byTitle = await BookMetadataRepository.fetchOpenLibraryCoverByTitle(input.title, input.authors?.[0]);
            if (byTitle) {
                return byTitle;
            }
        }
        if (input.isbn && input.libraryThingApiKey) {
            return BookMetadataRepository.fetchLibraryThingCover(input.isbn, input.libraryThingApiKey);
        }
        return null;
    }

    /**
     * Fetches a cover from LibraryThing's cover API, filtering out its placeholder GIF by size.
     * @param isbn ISBN to look up.
     * @param apiKey LibraryThing API key.
     * @returns The cover URL, or null if there's no real cover.
     */
    private static async fetchLibraryThingCover(isbn: string, apiKey: string): Promise<string | null> {
        try {
            const url = `https://covers.librarything.com/devkey/${encodeURIComponent(apiKey)}/large/isbn/${encodeURIComponent(isbn)}`;

            const res = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: 3000,
                headers: {"User-Agent": USER_AGENT},
            });

            const contentType = String(res.headers["content-type"] ?? "");
            const byteLength = BookMetadataRepository.bodyBytes(res.data);

            if (res.status === 200 && contentType.startsWith("image/") && byteLength > LIBRARYTHING_PLACEHOLDER_MAX_BYTES) {
                return url;
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * Best-effort cover by ISBN via Open Library's covers API. `null` on any
     * failure (no cover, timeout, placeholder GIF) so a missing cover never
     * fails the whole insert. Used by ISBN auto-create and post-import enrichment.
     * @param isbn ISBN to look up.
     * @returns The cover URL, or null.
     */
    public static async fetchOpenLibraryCover(isbn: string): Promise<string | null> {
        const url = `${OL_COVER_ISBN}/${encodeURIComponent(isbn)}-M.jpg`;
        return BookMetadataRepository.coverUrlIfReal(`${url}?default=false`, url);
    }

    /**
     * Merge `source` into `target`, filling empty fields. Description keeps the
     * longer text when the current one is still a stub. ALL-CAPS titles lose to
     * mixed-case ones from a later source (OL title search after a store hint).
     * @param target Volume being built up; mutated in place.
     * @param source Volume fields to merge in, if any.
     */
    public static mergeVolume(target: BookVolumeInfo, source: BookVolumeInfo | null | undefined): void {
        if (!source) {
            return;
        }
        if (source.title) {
            if (!target.title) {
                target.title = source.title;
            } else if (BookMetadataRepository.isAllCaps(target.title) && !BookMetadataRepository.isAllCaps(source.title)) {
                target.title = source.title;
            }
        }
        if (source.authors?.length && !target.authors?.length) {
            target.authors = source.authors;
        }
        if (source.description && (
            !target.description
            || (BookMetadataRepository.isShortDescription(target.description) && source.description.length > target.description.length)
        )) {
            target.description = source.description;
        }
        if (source.categories?.length && !target.categories?.length) {
            target.categories = source.categories;
        }
        if (source.publisher && !target.publisher) {
            target.publisher = source.publisher;
        }
        if (source.publishedDate && !target.publishedDate) {
            target.publishedDate = source.publishedDate;
        } else if (source.publishedDate && target.publishedDate && source.publishedDate.length > target.publishedDate.length) {
            target.publishedDate = source.publishedDate;
        }
        if (source.pageCount && source.pageCount > 0 && !target.pageCount) {
            target.pageCount = source.pageCount;
        }
        const language = BookMetadataRepository.normalizeLanguageCode(source.language);
        if (language && !target.language) {
            target.language = language;
        }
        const thumb = source.imageLinks?.thumbnail;
        if (thumb && !target.imageLinks?.thumbnail) {
            target.imageLinks = {thumbnail: BookMetadataRepository.toHttps(thumb)};
        }
    }

    /**
     * Parse a schema.org Book product page. Exported for unit tests.
     * @param html Raw HTML of the store product page.
     * @param isbn Expected ISBN, to confirm the page matches.
     * @returns The parsed volume, or null if the page doesn't look like a match.
     */
    public static parseIsbnStoreHtml(html: string, isbn: string): BookVolumeInfo | null {
        const digits = html.replace(/[\s-]/g, "");
        if (!digits.includes(isbn)) {
            return null;
        }

        const title = BookMetadataRepository.decodeHtml(BookMetadataRepository.matchItemprop(html, "name"))
            ?? BookMetadataRepository.parseStoreTitleTag(html);
        if (!title || BookMetadataRepository.isStoreNotFoundTitle(title)) {
            return null;
        }

        const authors = BookMetadataRepository.compact([BookMetadataRepository.decodeHtml(BookMetadataRepository.matchItemprop(html, "author"))]);
        const publisher = BookMetadataRepository.decodeHtml(BookMetadataRepository.matchItemprop(html, "publisher"));
        const publishedDate = BookMetadataRepository.matchItemprop(html, "datePublished");
        const language = BookMetadataRepository.inferStoreLanguage(html);

        return {
            title,
            authors: authors.length ? authors : undefined,
            publisher: publisher ?? undefined,
            publishedDate: publishedDate ?? undefined,
            language: language ?? undefined,
        };
    }

    /**
     * Score a Wikipedia hit title against the book title. Exported for tests.
     * @param title Expected book title.
     * @param candidate Candidate Wikipedia page title.
     * @returns A match score (higher is better; 0 means no match).
     */
    public static wikipediaTitleScore(title: string, candidate: string): number {
        const t = BookMetadataRepository.normalizeWikiTitle(title);
        const c = BookMetadataRepository.normalizeWikiTitle(candidate);
        if (!t || !c) {
            return 0;
        }
        if (c === t) {
            return 100;
        }
        // Page title is the book plus a subtitle. 80 clears findWikipediaPageTitle's
        // >= 70 gate; 45 is only for cover matching (coverTitleRelated).
        if (t.length >= 8 && c.includes(t)) {
            return 80;
        }
        if (c.length >= 8 && t.includes(c)) {
            return 45;
        }
        return 0;
    }

    /**
     * Fetches an Open Library edition, its linked work, and a search fallback, merging all three.
     * @param isbn ISBN to look up.
     * @returns The merged volume, or null if no title was found.
     */
    private static async fetchOpenLibraryByIsbn(isbn: string): Promise<BookVolumeInfo | null> {
        const merged: BookVolumeInfo = {};

        const apiBooks = await BookMetadataRepository.getJson(OL_API_BOOKS, {
            bibkeys: `ISBN:${isbn}`,
            format: "json",
            jscmd: "data",
        });
        BookMetadataRepository.applyOpenLibraryApiBook(merged, apiBooks?.[`ISBN:${isbn}`]);

        const edition = await BookMetadataRepository.getJson(`${OL_ISBN}/${encodeURIComponent(isbn)}.json`);
        BookMetadataRepository.applyOpenLibraryEdition(merged, edition);

        const workKey = BookMetadataRepository.editionWorkKey(edition) ?? undefined;
        if (workKey) {
            BookMetadataRepository.applyOpenLibraryWork(merged, await BookMetadataRepository.getJson(`https://openlibrary.org${workKey}.json`));
        }

        const search = await BookMetadataRepository.getJson(OL_SEARCH, {isbn, limit: "1"});
        BookMetadataRepository.applyOpenLibrarySearchDoc(merged, search?.docs?.[0]);
        const searchWork = BookMetadataRepository.workKeyFromSearch(search?.docs?.[0]);
        if (searchWork && searchWork !== workKey) {
            BookMetadataRepository.applyOpenLibraryWork(merged, await BookMetadataRepository.getJson(`https://openlibrary.org${searchWork}.json`));
        }

        return merged.title ? merged : null;
    }

    /**
     * Searches Open Library by title/author for a cover image.
     * @param title Book title.
     * @param author Optional author name.
     * @returns The cover URL, or null.
     */
    private static async fetchOpenLibraryCoverByTitle(title: string, author?: string): Promise<string | null> {
        const query = [title, author].filter(Boolean).join(" ");
        const search = await BookMetadataRepository.getJson(OL_SEARCH, {q: query, limit: "10"});
        const docs = Array.isArray(search?.docs) ? search.docs : [];
        const doc = docs.find((item: any) => (
            item?.cover_i
            && BookMetadataRepository.authorsOverlap(author, item?.author_name)
            && BookMetadataRepository.coverTitleRelated(title, item?.title)
        ));
        if (!doc) {
            return null;
        }
        const url = `${OL_COVER_ID}/${doc.cover_i}-M.jpg`;
        return BookMetadataRepository.coverUrlIfReal(`${url}?default=false`, url);
    }

    /**
     * Searches Wikipedia (Catalan, Spanish, Italian, English in order) for a page matching the book.
     * @param title Book title.
     * @param authors Author name(s), as free text.
     * @returns The matching language and page title, or null.
     */
    private static async findWikipediaPageTitle(title: string, authors: string): Promise<[string, string] | null> {
        const query = `${title} ${authors}`.trim();
        for (const lang of ["ca", "es", "it", "en"] as const) {
            const found = await BookMetadataRepository.getJson(`https://${lang}.wikipedia.org/w/api.php`, {
                action: "query",
                list: "search",
                srsearch: query,
                srlimit: "5",
                format: "json",
            });
            const hits = found?.query?.search ?? [];
            const ranked = hits
                .map((hit: {title?: string}) => ({
                    score: BookMetadataRepository.wikipediaTitleScore(title, String(hit?.title ?? "")),
                    pageTitle: String(hit?.title ?? ""),
                }))
                .sort((a: {score: number}, b: {score: number}) => b.score - a.score);
            if (ranked[0]?.score >= 70 && ranked[0].pageTitle) {
                return [lang, ranked[0].pageTitle];
            }
        }
        return null;
    }

    /**
     * Searches Open Library by title/author for full metadata.
     * @param title Book title.
     * @param author Optional author name.
     * @returns The matched volume, or null.
     */
    private static async fetchOpenLibraryByTitle(title: string, author?: string): Promise<BookVolumeInfo | null> {
        const params: Record<string, string> = {title, limit: "3"};
        if (author) {
            params.author = author;
        }
        const search = await BookMetadataRepository.getJson(OL_SEARCH, params);
        const docs = Array.isArray(search?.docs) ? search.docs : [];
        const doc = docs.find((item: any) => BookMetadataRepository.titlesLookAlike(title, item?.title) && BookMetadataRepository.authorsOverlap(author, item?.author_name))
            ?? docs.find((item: any) => BookMetadataRepository.titlesLookAlike(title, item?.title));
        if (!doc) {
            return null;
        }
        const merged: BookVolumeInfo = {};
        BookMetadataRepository.applyOpenLibrarySearchDoc(merged, doc);
        const workKey = BookMetadataRepository.workKeyFromSearch(doc);
        if (workKey) {
            BookMetadataRepository.applyOpenLibraryWork(merged, await BookMetadataRepository.getJson(`https://openlibrary.org${workKey}.json`));
        }
        return merged.title ? merged : null;
    }

    /**
     * Looks up a book by ISBN via the Google Books API.
     * @param isbn ISBN to look up.
     * @param apiKey Google Books API key.
     * @returns The matched volume, or null.
     */
    private static async fetchGoogleBooks(isbn: string, apiKey: string): Promise<BookVolumeInfo | null> {
        const data = await BookMetadataRepository.getJson(GB_VOLUMES, {
            q: `isbn:${isbn}`,
            maxResults: "1",
            printType: "books",
            key: apiKey,
        });
        const info = data?.items?.[0]?.volumeInfo;
        if (!info?.title) {
            return null;
        }
        return {
            title: info.title,
            authors: Array.isArray(info.authors) ? info.authors : undefined,
            description: BookMetadataRepository.stripHtml(info.description),
            categories: Array.isArray(info.categories) ? info.categories : undefined,
            publisher: info.publisher,
            publishedDate: info.publishedDate,
            pageCount: BookMetadataRepository.positiveInt(info.pageCount),
            language: BookMetadataRepository.normalizeLanguageCode(info.language) ?? undefined,
            imageLinks: info.imageLinks?.thumbnail
                ? {thumbnail: BookMetadataRepository.toHttps(info.imageLinks.thumbnail)}
                : info.imageLinks?.smallThumbnail
                    ? {thumbnail: BookMetadataRepository.toHttps(info.imageLinks.smallThumbnail)}
                    : null,
        };
    }

    /**
     * Fetches and parses a public ISBN store product page as a last-resort metadata source.
     * @param isbn ISBN to look up.
     * @returns The parsed volume, or null.
     */
    private static async fetchIsbnStoreHint(isbn: string): Promise<BookVolumeInfo | null> {
        try {
            const res = await axios.get(`${ISBN_STORE}/${encodeURIComponent(isbn)}/`, {
                timeout: 8000,
                headers: HTML_HEADERS,
                responseType: "text",
                validateStatus: () => true,
                maxRedirects: 3,
            });
            if (res.status !== 200 || typeof res.data !== "string") {
                return null;
            }
            return BookMetadataRepository.parseIsbnStoreHtml(res.data, isbn);
        } catch {
            return null;
        }
    }

    /**
     * Finds a matching Wikipedia page and extracts its intro text and thumbnail.
     * @param title Book title.
     * @param authors Author name(s), as free text.
     * @returns A short description and/or cover data-URI, whichever were found.
     */
    private static async fetchWikipediaExtras(title: string, authors: string): Promise<{description?: string; cover?: string}> {
        const pageTitle = await BookMetadataRepository.findWikipediaPageTitle(title, authors);
        if (!pageTitle) {
            return {};
        }
        const [lang, wikiTitle] = pageTitle;
        const page = await BookMetadataRepository.getJson(`https://${lang}.wikipedia.org/w/api.php`, {
            action: "query",
            prop: "extracts|pageimages",
            exintro: "1",
            explaintext: "1",
            piprop: "thumbnail",
            pithumbsize: "400",
            redirects: "1",
            titles: wikiTitle,
            format: "json",
        });
        const extras: {description?: string; cover?: string} = {};
        const pages = page?.query?.pages ?? {};
        for (const item of Object.values(pages) as Array<{extract?: string; thumbnail?: {source?: string}}>) {
            const extract = BookMetadataRepository.stripHtml(item?.extract);
            if (extract) {
                extras.description = extract.slice(0, 8000);
            }
            const source = item?.thumbnail?.source;
            if (!extras.cover && typeof source === "string" && source.startsWith("https://")) {
                const dataUri = await BookMetadataRepository.downloadImageAsDataUri(source);
                if (dataUri) {
                    extras.cover = dataUri;
                }
            }
        }
        return extras;
    }

    /**
     * Confirms a candidate cover URL actually serves a real (non-placeholder) image before trusting it.
     * @param fetchUrl URL to fetch and inspect.
     * @param storeUrl URL to return/store if `fetchUrl` checks out (may differ, e.g. to drop a query param).
     * @returns `storeUrl` if the image is real, else null.
     */
    private static async coverUrlIfReal(fetchUrl: string, storeUrl: string): Promise<string | null> {
        try {
            const res = await axios.get(fetchUrl, {
                responseType: "arraybuffer",
                timeout: 5000,
                headers: {"User-Agent": USER_AGENT, Accept: "image/*"},
                validateStatus: () => true,
                maxRedirects: 3,
            });
            const contentType = String(res.headers["content-type"] ?? "");
            if (res.status === 200 && BookMetadataRepository.isUsableCover(contentType, res.data)) {
                return storeUrl;
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Downloads an image and inlines it as a `data:` URI (JPEG/PNG only, capped size).
     * @param url Image URL to download.
     * @returns The `data:` URI, or null if it's not usable.
     */
    private static async downloadImageAsDataUri(url: string): Promise<string | null> {
        try {
            const res = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: 8000,
                headers: {"User-Agent": USER_AGENT, Accept: "image/*"},
                validateStatus: () => true,
                maxRedirects: 3,
            });
            const contentType = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
            if (res.status !== 200 || !BookMetadataRepository.isUsableCover(contentType, res.data)) {
                return null;
            }
            const buf = BookMetadataRepository.toBuffer(res.data);
            if (!buf || buf.length > MAX_INLINE_COVER_BYTES) {
                return null;
            }
            if (contentType === "image/jpeg" || contentType === "image/jpg") {
                return `data:image/jpeg;base64,${buf.toString("base64")}`;
            }
            if (contentType === "image/png") {
                return `data:image/png;base64,${buf.toString("base64")}`;
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Checks whether a fetched image is a real cover (right MIME type, big enough to not be a placeholder).
     * @param contentType Response `Content-Type` header.
     * @param data Response body.
     * @returns Whether the image looks like a real cover.
     */
    private static isUsableCover(contentType: string, data: unknown): boolean {
        const mime = contentType.split(";")[0].trim().toLowerCase();
        const bytes = BookMetadataRepository.bodyBytes(data);
        return /^image\/(jpeg|jpg|png)$/.test(mime) && bytes >= MIN_COVER_BYTES;
    }

    /**
     * Coerces an axios response body into a `Buffer`.
     * @param data Response body of unknown shape.
     * @returns The buffer, or null if `data` isn't buffer-like.
     */
    private static toBuffer(data: unknown): Buffer | null {
        if (!data) {
            return null;
        }
        if (Buffer.isBuffer(data)) {
            return data;
        }
        if (data instanceof ArrayBuffer) {
            return Buffer.from(data);
        }
        if (ArrayBuffer.isView(data)) {
            return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        }
        return null;
    }

    /**
     * Byte length of a response body.
     * @param data Response body of unknown shape.
     * @returns The byte length, or 0 if it isn't buffer-like.
     */
    private static bodyBytes(data: unknown): number {
        return BookMetadataRepository.toBuffer(data)?.length ?? 0;
    }

    /**
     * Merges Open Library's `/api/books` "data" shape into `target`.
     * @param target Volume being built up; mutated in place.
     * @param item Raw `/api/books` item, if any.
     */
    private static applyOpenLibraryApiBook(target: BookVolumeInfo, item: any): void {
        if (!item || typeof item !== "object") {
            return;
        }
        BookMetadataRepository.mergeVolume(target, {
            title: BookMetadataRepository.nonempty(item.title),
            authors: BookMetadataRepository.names(item.authors),
            description: BookMetadataRepository.firstExcerpt(item.excerpts),
            categories: BookMetadataRepository.pickCategories(BookMetadataRepository.names(item.subjects)),
            publisher: BookMetadataRepository.names(item.publishers)?.[0],
            publishedDate: BookMetadataRepository.nonempty(item.publish_date),
            pageCount: BookMetadataRepository.positiveInt(item.number_of_pages),
            imageLinks: BookMetadataRepository.coverFromOl(item.cover?.medium || item.cover?.large || item.cover?.small),
        });
    }

    /**
     * Merges an Open Library edition (`/isbn/{isbn}.json`) into `target`.
     * @param target Volume being built up; mutated in place.
     * @param edition Raw edition JSON, if any.
     */
    private static applyOpenLibraryEdition(target: BookVolumeInfo, edition: any): void {
        if (!edition || typeof edition !== "object" || Array.isArray(edition)) {
            return;
        }
        const languageKeys = (edition.languages ?? [])
            .map((entry: any) => typeof entry === "string" ? entry : entry?.key)
            .filter(Boolean);
        BookMetadataRepository.mergeVolume(target, {
            title: BookMetadataRepository.nonempty(edition.title),
            description: BookMetadataRepository.unwrapDescription(edition.description),
            categories: BookMetadataRepository.pickCategories(BookMetadataRepository.asStringList(edition.subjects)),
            publisher: BookMetadataRepository.firstPublisher(edition.publishers),
            publishedDate: BookMetadataRepository.nonempty(edition.publish_date),
            pageCount: BookMetadataRepository.positiveInt(edition.number_of_pages),
            language: BookMetadataRepository.pickLanguage(languageKeys) ?? undefined,
            imageLinks: BookMetadataRepository.coverFromId(edition.covers?.[0]),
        });
    }

    /**
     * Merges an Open Library work (the edition's parent record) into `target`.
     * @param target Volume being built up; mutated in place.
     * @param work Raw work JSON, if any.
     */
    private static applyOpenLibraryWork(target: BookVolumeInfo, work: any): void {
        if (!work || typeof work !== "object") {
            return;
        }
        BookMetadataRepository.mergeVolume(target, {
            title: BookMetadataRepository.nonempty(work.title),
            description: BookMetadataRepository.unwrapDescription(work.description),
            categories: BookMetadataRepository.pickCategories(BookMetadataRepository.asStringList(work.subjects)),
            imageLinks: BookMetadataRepository.coverFromId(work.covers?.[0]),
        });
    }

    /**
     * Merges one Open Library search-result doc into `target`.
     * @param target Volume being built up; mutated in place.
     * @param doc Raw search-result doc, if any.
     */
    private static applyOpenLibrarySearchDoc(target: BookVolumeInfo, doc: any): void {
        if (!doc || typeof doc !== "object") {
            return;
        }
        BookMetadataRepository.mergeVolume(target, {
            title: BookMetadataRepository.nonempty(doc.title),
            authors: BookMetadataRepository.asStringList(doc.author_name),
            categories: BookMetadataRepository.pickCategories(BookMetadataRepository.asStringList(doc.subject)),
            publisher: BookMetadataRepository.asStringList(doc.publisher)?.[0],
            publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
            pageCount: BookMetadataRepository.positiveInt(doc.number_of_pages_median),
            language: BookMetadataRepository.pickLanguage(BookMetadataRepository.asStringList(doc.language) ?? []) ?? undefined,
            imageLinks: BookMetadataRepository.coverFromId(doc.cover_i),
        });
    }

    /**
     * Picks one preferred language out of a set of candidate codes.
     * @param codes Raw language codes/keys.
     * @returns The chosen 2-letter code, or null.
     */
    private static pickLanguage(codes: string[]): string | null {
        const mapped = BookMetadataRepository.compact(codes.map((code) => BookMetadataRepository.normalizeLanguageCode(code)));
        if (mapped.length === 1) {
            return mapped[0];
        }
        for (const preferred of ["en", "es", "ca", "fr", "it"]) {
            if (mapped.includes(preferred)) {
                return preferred;
            }
        }
        return mapped[0] ?? null;
    }

    /**
     * Picks a single representative category out of a raw subjects list, preferring "Fiction".
     * @param subjects Raw subject strings.
     * @returns A one-element category array, or undefined.
     */
    private static pickCategories(subjects: string[] | undefined): string[] | undefined {
        if (!subjects?.length) {
            return undefined;
        }
        const cleaned = subjects
            .map((s) => s.trim())
            .filter((s) => s && !s.toLowerCase().startsWith("nyt:") && !/^fiction\s*\//i.test(s));
        const fiction = cleaned.find((s) => /^fiction$/i.test(s));
        if (fiction) {
            return ["Fiction"];
        }
        return cleaned.length ? [cleaned[0]] : undefined;
    }

    /**
     * GETs a URL and returns its parsed JSON body, or null on any failure/non-2xx/non-object response.
     * @param url URL to fetch.
     * @param params Optional query params.
     * @returns The parsed JSON body, or null.
     */
    private static async getJson(url: string, params?: Record<string, string>): Promise<any | null> {
        try {
            const res = await axios.get(url, {
                params,
                timeout: 9000,
                headers: JSON_HEADERS,
                validateStatus: () => true,
                maxRedirects: 5,
            });
            if (res.status < 200 || res.status >= 300 || !res.data || typeof res.data !== "object") {
                return null;
            }
            return res.data;
        } catch {
            return null;
        }
    }

    /**
     * Extracts the `/works/...` key an edition belongs to.
     * @param edition Raw edition JSON.
     * @returns The work key, or null.
     */
    private static editionWorkKey(edition: any): string | null {
        const key = edition?.works?.[0]?.key;
        return typeof key === "string" && key.startsWith("/works/") ? key : null;
    }

    /**
     * Extracts the `/works/...` key from a search-result doc.
     * @param doc Raw search-result doc.
     * @returns The work key, or null.
     */
    private static workKeyFromSearch(doc: any): string | null {
        const key = doc?.key;
        return typeof key === "string" && key.startsWith("/works/") ? key : null;
    }

    /**
     * Unwraps Open Library's description field, which is sometimes a plain string and sometimes `{value: string}`.
     * @param value Raw description value.
     * @returns The plain-text description, or undefined.
     */
    private static unwrapDescription(value: unknown): string | undefined {
        if (typeof value === "string") {
            return BookMetadataRepository.nonempty(BookMetadataRepository.stripHtml(value));
        }
        if (value && typeof value === "object" && "value" in value) {
            return BookMetadataRepository.nonempty(BookMetadataRepository.stripHtml(String((value as {value?: unknown}).value ?? "")));
        }
        return undefined;
    }

    /**
     * Takes the first excerpt out of Open Library's `excerpts` array, in either its string or `{text}` shape.
     * @param excerpts Raw excerpts array.
     * @returns The first excerpt's text, or undefined.
     */
    private static firstExcerpt(excerpts: unknown): string | undefined {
        if (!Array.isArray(excerpts) || !excerpts.length) {
            return undefined;
        }
        const first = excerpts[0];
        if (typeof first === "string") {
            return BookMetadataRepository.nonempty(first);
        }
        if (first && typeof first === "object" && "text" in first) {
            return BookMetadataRepository.nonempty(String((first as {text?: unknown}).text ?? ""));
        }
        return undefined;
    }

    /**
     * Extracts a list of names from a mixed array of strings/`{name|title}` objects.
     * @param items Raw items array.
     * @returns The extracted names, or undefined if none.
     */
    private static names(items: unknown): string[] | undefined {
        if (!Array.isArray(items)) {
            return undefined;
        }
        const out = BookMetadataRepository.compact(items.map((item) => {
            if (typeof item === "string") {
                return item.trim();
            }
            if (item && typeof item === "object") {
                const name = (item as {name?: unknown; title?: unknown}).name
                    ?? (item as {title?: unknown}).title;
                return typeof name === "string" ? name.trim() : "";
            }
            return "";
        }));
        return out.length ? out : undefined;
    }

    /**
     * Coerces an array of unknown items into a list of non-empty strings.
     * @param value Raw array value.
     * @returns The string list, or undefined if none.
     */
    private static asStringList(value: unknown): string[] | undefined {
        if (!Array.isArray(value)) {
            return undefined;
        }
        const out = BookMetadataRepository.compact(value.map((item) => typeof item === "string" ? item.trim() : ""));
        return out.length ? out : undefined;
    }

    /**
     * Takes the first publisher out of a raw publishers field (string, or array of strings/objects).
     * @param publishers Raw publishers value.
     * @returns The first publisher's name, or undefined.
     */
    private static firstPublisher(publishers: unknown): string | undefined {
        if (Array.isArray(publishers)) {
            const first = publishers[0];
            return typeof first === "string" ? BookMetadataRepository.nonempty(first) : BookMetadataRepository.names(publishers)?.[0];
        }
        return typeof publishers === "string" ? BookMetadataRepository.nonempty(publishers) : undefined;
    }

    /**
     * Builds a cover-image object from an Open Library `/api/books` cover URL.
     * @param url Raw cover URL.
     * @returns The cover object, or null.
     */
    private static coverFromOl(url: unknown): {thumbnail: string} | null {
        return typeof url === "string" && url ? {thumbnail: BookMetadataRepository.toHttps(url)} : null;
    }

    /**
     * Builds a cover-image object from an Open Library numeric cover id.
     * @param id Raw cover id.
     * @returns The cover object, or null.
     */
    private static coverFromId(id: unknown): {thumbnail: string} | null {
        const n = typeof id === "number" ? id : typeof id === "string" && /^\d+$/.test(id) ? Number(id) : NaN;
        if (!Number.isFinite(n) || n <= 0) {
            return null;
        }
        return {thumbnail: `${OL_COVER_ID}/${n}-M.jpg`};
    }

    /**
     * Extracts one `itemprop="..."` value from a schema.org HTML page, either as inner text or a `content` attribute.
     * @param html Raw page HTML.
     * @param prop `itemprop` name to look for.
     * @returns The extracted value, or null.
     */
    private static matchItemprop(html: string, prop: string): string | null {
        const named = html.match(new RegExp(
            `itemprop="${prop}"[^>]*>\\s*(?:<a[^>]*>)?\\s*(?:<b>)?([^<]+)`,
            "i"
        ));
        if (named?.[1]?.trim()) {
            return named[1].trim();
        }
        const attr = html.match(new RegExp(
            `itemprop="${prop}"[^>]*content="([^"]+)"`,
            "i"
        ));
        return attr?.[1]?.trim() || null;
    }

    /**
     * Falls back to the page's `<title>` tag when no `itemprop="name"` was found.
     * @param html Raw page HTML.
     * @returns The cleaned title, or null.
     */
    private static parseStoreTitleTag(html: string): string | null {
        const raw = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
        if (!raw) {
            return null;
        }
        const cleaned = raw.replace(/\s*\|\s*paquebote\.com\s*$/i, "").trim();
        const parts = cleaned.split(/\s+-\s+/);
        return BookMetadataRepository.nonempty(parts[0] ?? cleaned) ?? null;
    }

    /**
     * Checks whether a parsed store-page title is actually a "not found"/error page.
     * @param title Parsed page title.
     * @returns Whether it looks like a not-found page.
     */
    private static isStoreNotFoundTitle(title: string): boolean {
        return /p[aá]gina no encontrada|not found|error 404/i.test(title);
    }

    /**
     * Infers a store page's language from its `itemprop="inLanguage"` or category-path hints.
     * @param html Raw page HTML.
     * @returns The inferred 2-letter language code, or null.
     */
    private static inferStoreLanguage(html: string): string | null {
        const inLanguage = BookMetadataRepository.normalizeLanguageCode(BookMetadataRepository.matchItemprop(html, "inLanguage"));
        if (inLanguage) {
            return inLanguage;
        }
        if (/libros-en-catalan|llibres-en-catal/i.test(html)) {
            return "ca";
        }
        if (/libros-en-espanol|libros-en-castellano/i.test(html)) {
            return "es";
        }
        return null;
    }

    /**
     * Strict title match after normalization (accents/case/leading article stripped).
     * @param expected Expected title.
     * @param actual Candidate title.
     * @returns Whether they match.
     */
    private static titlesLookAlike(expected: string, actual: unknown): boolean {
        if (typeof actual !== "string") {
            return false;
        }
        return BookMetadataRepository.normalizeWikiTitle(expected) === BookMetadataRepository.normalizeWikiTitle(actual);
    }

    /**
     * Looser than titlesLookAlike: another-language edition of the same novel is fine for a cover.
     * @param expected Expected title.
     * @param actual Candidate title.
     * @returns Whether they're related enough to reuse a cover.
     */
    private static coverTitleRelated(expected: string, actual: unknown): boolean {
        if (typeof actual !== "string") {
            return false;
        }
        if (BookMetadataRepository.titlesLookAlike(expected, actual) || BookMetadataRepository.wikipediaTitleScore(expected, actual) >= 35) {
            return true;
        }
        const want = new Set(BookMetadataRepository.normalizeWikiTitle(expected).split(" ").filter((token) => token.length >= 4));
        const have = BookMetadataRepository.normalizeWikiTitle(actual).split(" ").filter((token) => token.length >= 4);
        return have.some((token) => want.has(token));
    }

    /**
     * Checks whether an expected author name shares enough tokens with any of a list of candidate names.
     * @param expected Expected author name, or undefined to skip the check (treated as a match).
     * @param actual Candidate author names.
     * @returns Whether they overlap enough to be considered the same author.
     */
    private static authorsOverlap(expected: string | undefined, actual: unknown): boolean {
        if (!expected) {
            return true;
        }
        if (!Array.isArray(actual)) {
            return false;
        }
        const want = BookMetadataRepository.tokenizeName(expected);
        return actual.some((name) => {
            const have = BookMetadataRepository.tokenizeName(String(name ?? ""));
            const shared = [...want].filter((token) => have.has(token));
            return shared.length >= Math.min(2, want.size);
        });
    }

    /**
     * Splits a name into normalized, length-filtered tokens for overlap comparison.
     * @param value Raw name.
     * @returns The token set.
     */
    private static tokenizeName(value: string): Set<string> {
        return new Set(
            BookMetadataRepository.normalizeWikiTitle(value)
                .split(/\s+/)
                .filter((token) => token.length > 2)
        );
    }

    /**
     * Normalizes a title for fuzzy comparison: strips accents/diacritics, lowercases, drops a trailing
     * "(novel)"-style qualifier and a leading article, strips punctuation, collapses whitespace.
     * @param value Raw title.
     * @returns The normalized title.
     */
    private static normalizeWikiTitle(value: string): string {
        return value
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s*\((novel|novela|novel·la|novella|book|libro|llibre)\)\s*$/i, "")
            .replace(/^(the|el|la|les|las|los|un|una|l')\s+/i, "")
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    /**
     * Strips HTML tags (converting `<br>` to newlines) and decodes entities.
     * @param value Raw HTML string.
     * @returns The plain text, or undefined if empty.
     */
    private static stripHtml(value: unknown): string | undefined {
        if (typeof value !== "string" || !value.trim()) {
            return undefined;
        }
        const text = BookMetadataRepository.decodeHtml(
            value
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<[^>]+>/g, "")
        );
        return BookMetadataRepository.nonempty(text);
    }

    /**
     * Decodes the small set of HTML entities that show up in these sources.
     * @param value Raw string, or null/undefined.
     * @returns The decoded string, or null.
     */
    private static decodeHtml(value: string | null | undefined): string | null {
        if (!value) {
            return null;
        }
        return value
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;|&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&nbsp;/g, " ")
            .trim();
    }

    /**
     * Upgrades an `http://` URL to `https://`.
     * @param url Raw URL.
     * @returns The URL with an https scheme.
     */
    private static toHttps(url: string): string {
        return url.replace(/^http:\/\//i, "https://");
    }

    /**
     * Trims a string and returns undefined instead of an empty result.
     * @param value Raw string, or null/undefined.
     * @returns The trimmed string, or undefined.
     */
    private static nonempty(value: string | null | undefined): string | undefined {
        const trimmed = value?.trim();
        return trimmed ? trimmed : undefined;
    }

    /**
     * Filters a list down to its non-empty string values.
     * @param values Raw values.
     * @returns The non-empty strings.
     */
    private static compact(values: Array<string | null | undefined>): string[] {
        return values.filter((value): value is string => Boolean(value && value.trim()));
    }

    /**
     * Coerces a value to a positive integer.
     * @param value Raw value.
     * @returns The rounded positive integer, or undefined.
     */
    private static positiveInt(value: unknown): number | undefined {
        const n = typeof value === "number" ? value : Number(value);
        return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
    }

    /**
     * Whether a description is missing or short enough to still be worth replacing.
     * @param value Description text, if any.
     * @returns Whether it's short (or absent).
     */
    private static isShortDescription(value: string | undefined): boolean {
        return !value || value.trim().length < 180;
    }

    /**
     * Whether a string is ALL CAPS (and contains at least one letter).
     * @param value String to check.
     * @returns Whether it's all-caps.
     */
    private static isAllCaps(value: string): boolean {
        return value === value.toUpperCase() && /[A-ZÀ-Ü]/.test(value);
    }
}
