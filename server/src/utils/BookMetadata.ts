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
 * Treat empty / the literal string "undefined" (from `String(undefined)` in
 * older AppService code) as "no key", so we never call Google with a junk key.
 */
export function normalizeGoogleApiKey(raw: string | undefined | null): string | undefined {
    const trimmed = (raw ?? "").trim();
    if (!trimmed || trimmed === "undefined") {
        return undefined;
    }
    return trimmed;
}

/**
 * Normalize anything language-shaped (ISO 639-1, 639-2, `en-US`,
 * `/languages/eng`) down to a 2-letter code, or `null` if we can't.
 */
export function normalizeLanguageCode(language: string | null | undefined): string | null {
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
 */
export async function fetchBookMetadata(
    isbn: string,
    googleApiKey?: string
): Promise<BookVolumeInfo | null> {
    const merged: BookVolumeInfo = {};
    let resolvedFromCatalog = false;

    const openLibrary = await fetchOpenLibraryByIsbn(isbn);
    if (openLibrary?.title) {
        mergeVolume(merged, openLibrary);
        resolvedFromCatalog = true;
    }

    const key = normalizeGoogleApiKey(googleApiKey);
    if (key) {
        const google = await fetchGoogleBooks(isbn, key);
        if (google?.title) {
            mergeVolume(merged, google);
            resolvedFromCatalog = true;
        }
    }

    if (!resolvedFromCatalog) {
        const store = await fetchIsbnStoreHint(isbn);
        if (store?.title) {
            mergeVolume(merged, store);
            const byTitle = await fetchOpenLibraryByTitle(store.title, store.authors?.[0]);
            mergeVolume(merged, byTitle);
        }
    }

    if (merged.title && !merged.imageLinks?.thumbnail) {
        const cover = await resolveOpenLibraryCover({
            isbn,
            title: merged.title,
            authors: merged.authors,
        });
        if (cover) {
            merged.imageLinks = {thumbnail: cover};
        }
    }

    if (merged.title && (isShortDescription(merged.description) || !merged.imageLinks?.thumbnail)) {
        const wiki = await fetchWikipediaExtras(merged.title, merged.authors?.[0] ?? "");
        if (wiki.description) {
            mergeVolume(merged, {description: wiki.description});
        }
        if (wiki.cover && !merged.imageLinks?.thumbnail) {
            merged.imageLinks = {thumbnail: wiki.cover};
        }
    }

    return merged.title ? merged : null;
}

/** OL's missing-cover placeholder is a tiny GIF; reject anything that small. */
const MIN_COVER_BYTES = 800;
const MAX_INLINE_COVER_BYTES = 500_000;

/**
 * Best-effort cover: Open Library by ISBN, then another edition of the same
 * work (title + author search), then a Wikipedia page image stored as a
 * `data:` URI so we don't have to widen the CSP allowlist.
 */
export async function resolveBookCover(input: {
    isbn?: string | null;
    title?: string | null;
    authors?: string[] | null;
}): Promise<string | null> {
    const fromOpenLibrary = await resolveOpenLibraryCover(input);
    if (fromOpenLibrary) {
        return fromOpenLibrary;
    }
    if (input.title) {
        const wiki = await fetchWikipediaExtras(input.title, input.authors?.[0] ?? "");
        return wiki.cover ?? null;
    }
    return null;
}

async function resolveOpenLibraryCover(input: {
    isbn?: string | null;
    title?: string | null;
    authors?: string[] | null;
}): Promise<string | null> {
    if (input.isbn) {
        const byIsbn = await fetchOpenLibraryCover(input.isbn);
        if (byIsbn) {
            return byIsbn;
        }
    }
    if (input.title) {
        return fetchOpenLibraryCoverByTitle(input.title, input.authors?.[0]);
    }
    return null;
}

/**
 * Best-effort cover by ISBN via Open Library's covers API. `null` on any
 * failure (no cover, timeout, placeholder GIF) so a missing cover never
 * fails the whole insert. Used by ISBN auto-create and CSV import.
 */
export async function fetchOpenLibraryCover(isbn: string): Promise<string | null> {
    const url = `${OL_COVER_ISBN}/${encodeURIComponent(isbn)}-M.jpg`;
    return coverUrlIfReal(`${url}?default=false`, url);
}

/**
 * Merge `source` into `target`, filling empty fields. Description keeps the
 * longer text when the current one is still a stub. ALL-CAPS titles lose to
 * mixed-case ones from a later source (OL title search after a store hint).
 */
export function mergeVolume(target: BookVolumeInfo, source: BookVolumeInfo | null | undefined): void {
    if (!source) {
        return;
    }
    if (source.title) {
        if (!target.title) {
            target.title = source.title;
        } else if (isAllCaps(target.title) && !isAllCaps(source.title)) {
            target.title = source.title;
        }
    }
    if (source.authors?.length && !target.authors?.length) {
        target.authors = source.authors;
    }
    if (source.description && (
        !target.description
        || (isShortDescription(target.description) && source.description.length > target.description.length)
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
    const language = normalizeLanguageCode(source.language);
    if (language && !target.language) {
        target.language = language;
    }
    const thumb = source.imageLinks?.thumbnail;
    if (thumb && !target.imageLinks?.thumbnail) {
        target.imageLinks = {thumbnail: toHttps(thumb)};
    }
}

/** Parse a schema.org Book product page. Exported for unit tests. */
export function parseIsbnStoreHtml(html: string, isbn: string): BookVolumeInfo | null {
    const digits = html.replace(/[\s-]/g, "");
    if (!digits.includes(isbn)) {
        return null;
    }

    const title = decodeHtml(matchItemprop(html, "name"))
        ?? parseStoreTitleTag(html);
    if (!title || isStoreNotFoundTitle(title)) {
        return null;
    }

    const authors = compact([decodeHtml(matchItemprop(html, "author"))]);
    const publisher = decodeHtml(matchItemprop(html, "publisher"));
    const publishedDate = matchItemprop(html, "datePublished");
    const language = inferStoreLanguage(html);

    return {
        title,
        authors: authors.length ? authors : undefined,
        publisher: publisher ?? undefined,
        publishedDate: publishedDate ?? undefined,
        language: language ?? undefined,
    };
}

/** Score a Wikipedia hit title against the book title. Exported for tests. */
export function wikipediaTitleScore(title: string, candidate: string): number {
    const t = normalizeWikiTitle(title);
    const c = normalizeWikiTitle(candidate);
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

async function fetchOpenLibraryByIsbn(isbn: string): Promise<BookVolumeInfo | null> {
    const merged: BookVolumeInfo = {};

    const apiBooks = await getJson(OL_API_BOOKS, {
        bibkeys: `ISBN:${isbn}`,
        format: "json",
        jscmd: "data",
    });
    applyOpenLibraryApiBook(merged, apiBooks?.[`ISBN:${isbn}`]);

    const edition = await getJson(`${OL_ISBN}/${encodeURIComponent(isbn)}.json`);
    applyOpenLibraryEdition(merged, edition);

    const workKey = editionWorkKey(edition) ?? undefined;
    if (workKey) {
        applyOpenLibraryWork(merged, await getJson(`https://openlibrary.org${workKey}.json`));
    }

    const search = await getJson(OL_SEARCH, {isbn, limit: "1"});
    applyOpenLibrarySearchDoc(merged, search?.docs?.[0]);
    const searchWork = workKeyFromSearch(search?.docs?.[0]);
    if (searchWork && searchWork !== workKey) {
        applyOpenLibraryWork(merged, await getJson(`https://openlibrary.org${searchWork}.json`));
    }

    return merged.title ? merged : null;
}

async function fetchOpenLibraryCoverByTitle(title: string, author?: string): Promise<string | null> {
    const query = [title, author].filter(Boolean).join(" ");
    const search = await getJson(OL_SEARCH, {q: query, limit: "10"});
    const docs = Array.isArray(search?.docs) ? search.docs : [];
    const doc = docs.find((item: any) => (
        item?.cover_i
        && authorsOverlap(author, item?.author_name)
        && coverTitleRelated(title, item?.title)
    ));
    if (!doc) {
        return null;
    }
    const url = `${OL_COVER_ID}/${doc.cover_i}-M.jpg`;
    return coverUrlIfReal(`${url}?default=false`, url);
}

async function findWikipediaPageTitle(title: string, authors: string): Promise<[string, string] | null> {
    const query = `${title} ${authors}`.trim();
    for (const lang of ["ca", "es", "en"] as const) {
        const found = await getJson(`https://${lang}.wikipedia.org/w/api.php`, {
            action: "query",
            list: "search",
            srsearch: query,
            srlimit: "5",
            format: "json",
        });
        const hits = found?.query?.search ?? [];
        const ranked = hits
            .map((hit: {title?: string}) => ({
                score: wikipediaTitleScore(title, String(hit?.title ?? "")),
                pageTitle: String(hit?.title ?? ""),
            }))
            .sort((a: {score: number}, b: {score: number}) => b.score - a.score);
        if (ranked[0]?.score >= 70 && ranked[0].pageTitle) {
            return [lang, ranked[0].pageTitle];
        }
    }
    return null;
}

async function fetchOpenLibraryByTitle(title: string, author?: string): Promise<BookVolumeInfo | null> {
    const params: Record<string, string> = {title, limit: "3"};
    if (author) {
        params.author = author;
    }
    const search = await getJson(OL_SEARCH, params);
    const docs = Array.isArray(search?.docs) ? search.docs : [];
    const doc = docs.find((item: any) => titlesLookAlike(title, item?.title) && authorsOverlap(author, item?.author_name))
        ?? docs.find((item: any) => titlesLookAlike(title, item?.title));
    if (!doc) {
        return null;
    }
    const merged: BookVolumeInfo = {};
    applyOpenLibrarySearchDoc(merged, doc);
    const workKey = workKeyFromSearch(doc);
    if (workKey) {
        applyOpenLibraryWork(merged, await getJson(`https://openlibrary.org${workKey}.json`));
    }
    return merged.title ? merged : null;
}

async function fetchGoogleBooks(isbn: string, apiKey: string): Promise<BookVolumeInfo | null> {
    const data = await getJson(GB_VOLUMES, {
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
        description: stripHtml(info.description),
        categories: Array.isArray(info.categories) ? info.categories : undefined,
        publisher: info.publisher,
        publishedDate: info.publishedDate,
        pageCount: positiveInt(info.pageCount),
        language: normalizeLanguageCode(info.language) ?? undefined,
        imageLinks: info.imageLinks?.thumbnail
            ? {thumbnail: toHttps(info.imageLinks.thumbnail)}
            : info.imageLinks?.smallThumbnail
                ? {thumbnail: toHttps(info.imageLinks.smallThumbnail)}
                : null,
    };
}

async function fetchIsbnStoreHint(isbn: string): Promise<BookVolumeInfo | null> {
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
        return parseIsbnStoreHtml(res.data, isbn);
    } catch {
        return null;
    }
}

async function fetchWikipediaExtras(title: string, authors: string): Promise<{description?: string; cover?: string}> {
    const pageTitle = await findWikipediaPageTitle(title, authors);
    if (!pageTitle) {
        return {};
    }
    const [lang, wikiTitle] = pageTitle;
    const page = await getJson(`https://${lang}.wikipedia.org/w/api.php`, {
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
        const extract = stripHtml(item?.extract);
        if (extract) {
            extras.description = extract.slice(0, 8000);
        }
        const source = item?.thumbnail?.source;
        if (!extras.cover && typeof source === "string" && source.startsWith("https://")) {
            const dataUri = await downloadImageAsDataUri(source);
            if (dataUri) {
                extras.cover = dataUri;
            }
        }
    }
    return extras;
}

async function coverUrlIfReal(fetchUrl: string, storeUrl: string): Promise<string | null> {
    try {
        const res = await axios.get(fetchUrl, {
            responseType: "arraybuffer",
            timeout: 5000,
            headers: {"User-Agent": USER_AGENT, Accept: "image/*"},
            validateStatus: () => true,
            maxRedirects: 3,
        });
        const contentType = String(res.headers["content-type"] ?? "");
        if (res.status === 200 && isUsableCover(contentType, res.data)) {
            return storeUrl;
        }
        return null;
    } catch {
        return null;
    }
}

async function downloadImageAsDataUri(url: string): Promise<string | null> {
    try {
        const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 8000,
            headers: {"User-Agent": USER_AGENT, Accept: "image/*"},
            validateStatus: () => true,
            maxRedirects: 3,
        });
        const contentType = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (res.status !== 200 || !isUsableCover(contentType, res.data)) {
            return null;
        }
        const buf = toBuffer(res.data);
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

function isUsableCover(contentType: string, data: unknown): boolean {
    const mime = contentType.split(";")[0].trim().toLowerCase();
    const bytes = bodyBytes(data);
    return /^image\/(jpeg|jpg|png)$/.test(mime) && bytes >= MIN_COVER_BYTES;
}

function toBuffer(data: unknown): Buffer | null {
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

function bodyBytes(data: unknown): number {
    return toBuffer(data)?.length ?? 0;
}

function applyOpenLibraryApiBook(target: BookVolumeInfo, item: any): void {
    if (!item || typeof item !== "object") {
        return;
    }
    mergeVolume(target, {
        title: nonempty(item.title),
        authors: names(item.authors),
        description: firstExcerpt(item.excerpts),
        categories: pickCategories(names(item.subjects)),
        publisher: names(item.publishers)?.[0],
        publishedDate: nonempty(item.publish_date),
        pageCount: positiveInt(item.number_of_pages),
        imageLinks: coverFromOl(item.cover?.medium || item.cover?.large || item.cover?.small),
    });
}

function applyOpenLibraryEdition(target: BookVolumeInfo, edition: any): void {
    if (!edition || typeof edition !== "object" || Array.isArray(edition)) {
        return;
    }
    const languageKeys = (edition.languages ?? [])
        .map((entry: any) => typeof entry === "string" ? entry : entry?.key)
        .filter(Boolean);
    mergeVolume(target, {
        title: nonempty(edition.title),
        description: unwrapDescription(edition.description),
        categories: pickCategories(asStringList(edition.subjects)),
        publisher: firstPublisher(edition.publishers),
        publishedDate: nonempty(edition.publish_date),
        pageCount: positiveInt(edition.number_of_pages),
        language: pickLanguage(languageKeys) ?? undefined,
        imageLinks: coverFromId(edition.covers?.[0]),
    });
}

function applyOpenLibraryWork(target: BookVolumeInfo, work: any): void {
    if (!work || typeof work !== "object") {
        return;
    }
    mergeVolume(target, {
        title: nonempty(work.title),
        description: unwrapDescription(work.description),
        categories: pickCategories(asStringList(work.subjects)),
        imageLinks: coverFromId(work.covers?.[0]),
    });
}

function applyOpenLibrarySearchDoc(target: BookVolumeInfo, doc: any): void {
    if (!doc || typeof doc !== "object") {
        return;
    }
    mergeVolume(target, {
        title: nonempty(doc.title),
        authors: asStringList(doc.author_name),
        categories: pickCategories(asStringList(doc.subject)),
        publisher: asStringList(doc.publisher)?.[0],
        publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
        pageCount: positiveInt(doc.number_of_pages_median),
        language: pickLanguage(asStringList(doc.language) ?? []) ?? undefined,
        imageLinks: coverFromId(doc.cover_i),
    });
}

function pickLanguage(codes: string[]): string | null {
    const mapped = compact(codes.map((code) => normalizeLanguageCode(code)));
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

function pickCategories(subjects: string[] | undefined): string[] | undefined {
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

async function getJson(url: string, params?: Record<string, string>): Promise<any | null> {
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

function editionWorkKey(edition: any): string | null {
    const key = edition?.works?.[0]?.key;
    return typeof key === "string" && key.startsWith("/works/") ? key : null;
}

function workKeyFromSearch(doc: any): string | null {
    const key = doc?.key;
    return typeof key === "string" && key.startsWith("/works/") ? key : null;
}

function unwrapDescription(value: unknown): string | undefined {
    if (typeof value === "string") {
        return nonempty(stripHtml(value));
    }
    if (value && typeof value === "object" && "value" in value) {
        return nonempty(stripHtml(String((value as {value?: unknown}).value ?? "")));
    }
    return undefined;
}

function firstExcerpt(excerpts: unknown): string | undefined {
    if (!Array.isArray(excerpts) || !excerpts.length) {
        return undefined;
    }
    const first = excerpts[0];
    if (typeof first === "string") {
        return nonempty(first);
    }
    if (first && typeof first === "object" && "text" in first) {
        return nonempty(String((first as {text?: unknown}).text ?? ""));
    }
    return undefined;
}

function names(items: unknown): string[] | undefined {
    if (!Array.isArray(items)) {
        return undefined;
    }
    const out = compact(items.map((item) => {
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

function asStringList(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const out = compact(value.map((item) => typeof item === "string" ? item.trim() : ""));
    return out.length ? out : undefined;
}

function firstPublisher(publishers: unknown): string | undefined {
    if (Array.isArray(publishers)) {
        const first = publishers[0];
        return typeof first === "string" ? nonempty(first) : names(publishers)?.[0];
    }
    return typeof publishers === "string" ? nonempty(publishers) : undefined;
}

function coverFromOl(url: unknown): {thumbnail: string} | null {
    return typeof url === "string" && url ? {thumbnail: toHttps(url)} : null;
}

function coverFromId(id: unknown): {thumbnail: string} | null {
    const n = typeof id === "number" ? id : typeof id === "string" && /^\d+$/.test(id) ? Number(id) : NaN;
    if (!Number.isFinite(n) || n <= 0) {
        return null;
    }
    return {thumbnail: `${OL_COVER_ID}/${n}-M.jpg`};
}

function matchItemprop(html: string, prop: string): string | null {
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

function parseStoreTitleTag(html: string): string | null {
    const raw = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
    if (!raw) {
        return null;
    }
    const cleaned = raw.replace(/\s*\|\s*paquebote\.com\s*$/i, "").trim();
    const parts = cleaned.split(/\s+-\s+/);
    return nonempty(parts[0] ?? cleaned) ?? null;
}

function isStoreNotFoundTitle(title: string): boolean {
    return /p[aá]gina no encontrada|not found|error 404/i.test(title);
}

function inferStoreLanguage(html: string): string | null {
    const inLanguage = normalizeLanguageCode(matchItemprop(html, "inLanguage"));
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

function titlesLookAlike(expected: string, actual: unknown): boolean {
    if (typeof actual !== "string") {
        return false;
    }
    return normalizeWikiTitle(expected) === normalizeWikiTitle(actual);
}

/** Looser than titlesLookAlike: another-language edition of the same novel is fine for a cover. */
function coverTitleRelated(expected: string, actual: unknown): boolean {
    if (typeof actual !== "string") {
        return false;
    }
    if (titlesLookAlike(expected, actual) || wikipediaTitleScore(expected, actual) >= 35) {
        return true;
    }
    const want = new Set(normalizeWikiTitle(expected).split(" ").filter((token) => token.length >= 4));
    const have = normalizeWikiTitle(actual).split(" ").filter((token) => token.length >= 4);
    return have.some((token) => want.has(token));
}

function authorsOverlap(expected: string | undefined, actual: unknown): boolean {
    if (!expected) {
        return true;
    }
    if (!Array.isArray(actual)) {
        return false;
    }
    const want = tokenizeName(expected);
    return actual.some((name) => {
        const have = tokenizeName(String(name ?? ""));
        const shared = [...want].filter((token) => have.has(token));
        return shared.length >= Math.min(2, want.size);
    });
}

function tokenizeName(value: string): Set<string> {
    return new Set(
        normalizeWikiTitle(value)
            .split(/\s+/)
            .filter((token) => token.length > 2)
    );
}

function normalizeWikiTitle(value: string): string {
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

function stripHtml(value: unknown): string | undefined {
    if (typeof value !== "string" || !value.trim()) {
        return undefined;
    }
    const text = decodeHtml(
        value
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
    );
    return nonempty(text);
}

function decodeHtml(value: string | null | undefined): string | null {
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

function toHttps(url: string): string {
    return url.replace(/^http:\/\//i, "https://");
}

function nonempty(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function compact(values: Array<string | null | undefined>): string[] {
    return values.filter((value): value is string => Boolean(value && value.trim()));
}

function positiveInt(value: unknown): number | undefined {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

function isShortDescription(value: string | undefined): boolean {
    return !value || value.trim().length < 180;
}

function isAllCaps(value: string): boolean {
    return value === value.toUpperCase() && /[A-ZÀ-Ü]/.test(value);
}
