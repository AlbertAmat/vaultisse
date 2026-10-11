import {Pool} from "pg";
import crypto from "crypto";
import {AuthRepository} from "../repositories/AuthRepository";
import {OpdsBook, OpdsRepository} from "../repositories/OpdsRepository";
import {BookRepository} from "../repositories/BookRepository";
import {NotFoundError} from "../errors/DomainError";
import {BookFileForDownload} from "../types/book";

/** Books per OPDS page. */
export const OPDS_PAGE_SIZE = 50;

/** The caller an OPDS token resolved to: the user and the vault the feed is scoped to. */
export interface OpdsPrincipal {
    userId: number;
    vaultId: number;
}

/** Business rules for the OPDS feed: token issuing/resolution and Atom (OPDS 1.2) document building. */
export class OpdsService {
    private static readonly MIME: Record<string, string> = {
        epub: "application/epub+zip",
        pdf: "application/pdf",
        mobi: "application/x-mobipocket-ebook",
    };

    /**
     * @param pool Database connection pool.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * SHA-256 hex of a raw token, which is what gets stored.
     * @param token Raw token.
     */
    private static hash(token: string): string {
        return crypto.createHash("sha256").update(token).digest("hex");
    }

    /**
     * Creates a new feed token for the user, invalidating any previous one.
     * @param userId Owning user's id.
     * @returns The raw token - the only time it is ever available.
     */
    public async createToken(userId: number): Promise<string> {
        const token = crypto.randomBytes(32).toString("hex");
        await new OpdsRepository(this.pool).setTokenHash(userId, OpdsService.hash(token));
        return token;
    }

    /**
     * Disables the user's feed.
     * @param userId Owning user's id.
     */
    public async revokeToken(userId: number): Promise<void> {
        await new OpdsRepository(this.pool).setTokenHash(userId, null);
    }

    /**
     * Whether the user currently has a feed token.
     * @param userId Owning user's id.
     */
    public async hasToken(userId: number): Promise<boolean> {
        return new OpdsRepository(this.pool).hasToken(userId);
    }

    /**
     * Resolves a raw token to its user and active vault (accepted memberships only).
     * @param token Raw token from the URL.
     * @returns The principal, or null for an unknown token or a user without a vault.
     */
    public async resolve(token: string): Promise<OpdsPrincipal | null> {
        if (!/^[0-9a-f]{64}$/.test(token)) {
            return null;
        }
        const userId = await new OpdsRepository(this.pool).findUserIdByTokenHash(OpdsService.hash(token));
        if (userId === null) {
            return null;
        }
        const active = await new AuthRepository(this.pool).getActiveUserTokenVersion(userId);
        if (!active || active.activeVaultId === null) {
            return null;
        }
        return {userId, vaultId: active.activeVaultId};
    }

    /**
     * Looks up one ebook file's bytes, throwing NotFoundError if it isn't in the vault.
     * @param bookId Book id.
     * @param fileId File id.
     * @param vaultId Vault id.
     */
    public async getFile(bookId: number, fileId: number, vaultId: number): Promise<BookFileForDownload> {
        const file = await new BookRepository(this.pool).findFileForDownload(bookId, fileId, vaultId);
        if (!file) {
            throw new NotFoundError("File not found");
        }
        return file;
    }

    /** MIME type for a stored file type. */
    public static mimeFor(fileType: string): string {
        return OpdsService.MIME[fileType] ?? "application/octet-stream";
    }

    /**
     * Escapes text for XML content/attributes.
     * @param s Raw text.
     */
    private static esc(s: string): string {
        return s.replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"}[c] as string));
    }

    /**
     * Wraps entries in an Atom feed document.
     * @param base Feed root URL path (`/opds/<token>`), used for self/start links.
     * @param id Feed id.
     * @param title Feed title.
     * @param kind "navigation" or "acquisition" (sets the self link's profile).
     * @param selfHref Path of this feed.
     * @param extraLinks Pre-built extra <link> elements (search, paging).
     * @param entries Pre-built <entry> elements.
     */
    private static feed(base: string, id: string, title: string, kind: string, selfHref: string, extraLinks: string[], entries: string[]): string {
        return `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:os="http://a9.com/-/spec/opensearch/1.1/">\n` +
            `<id>${OpdsService.esc(id)}</id>\n<title>${OpdsService.esc(title)}</title>\n<updated>${new Date().toISOString()}</updated>\n` +
            `<link rel="self" href="${OpdsService.esc(selfHref)}" type="application/atom+xml;profile=opds-catalog;kind=${kind}"/>\n` +
            `<link rel="start" href="${OpdsService.esc(base)}" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>\n` +
            `<link rel="search" href="${OpdsService.esc(base)}/opensearch.xml" type="application/opensearchdescription+xml"/>\n` +
            extraLinks.join("\n") + "\n" + entries.join("\n") + `\n</feed>\n`;
    }

    /**
     * Root navigation feed.
     * @param base Feed root URL path.
     */
    public rootFeed(base: string): string {
        const entry = `<entry><id>${OpdsService.esc(base)}/all</id><title>All books</title><updated>${new Date().toISOString()}</updated>` +
            `<content type="text">Every book with a digital file</content>` +
            `<link rel="subsection" href="${OpdsService.esc(base)}/all" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/></entry>`;
        return OpdsService.feed(base, base, "Vaultisse", "navigation", base, [], [entry]);
    }

    /**
     * OpenSearch description pointing at the search route.
     * @param base Feed root URL path.
     */
    public openSearch(base: string): string {
        return `<?xml version="1.0" encoding="UTF-8"?>\n<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">` +
            `<ShortName>Vaultisse</ShortName><Description>Search the library</Description>` +
            `<Url type="application/atom+xml;profile=opds-catalog" template="${OpdsService.esc(base)}/all?q={searchTerms}"/></OpenSearchDescription>\n`;
    }

    /**
     * Acquisition feed for one page of digital books.
     * @param base Feed root URL path.
     * @param vaultId Vault id.
     * @param search Optional search text.
     * @param page 1-based page.
     */
    public async booksFeed(base: string, vaultId: number, search: string | null, page: number): Promise<string> {
        const {total, books} = await new OpdsRepository(this.pool).listDigitalBooks(vaultId, search, OPDS_PAGE_SIZE, (page - 1) * OPDS_PAGE_SIZE);
        const q = search ? `q=${encodeURIComponent(search)}&` : "";
        const href = (p: number) => `${base}/all?${q}page=${p}`;
        const links: string[] = [];
        const type = "application/atom+xml;profile=opds-catalog;kind=acquisition";
        if (page > 1) {
            links.push(`<link rel="previous" href="${OpdsService.esc(href(page - 1))}" type="${type}"/>`);
        }
        if (page * OPDS_PAGE_SIZE < total) {
            links.push(`<link rel="next" href="${OpdsService.esc(href(page + 1))}" type="${type}"/>`);
        }
        links.push(`<os:totalResults>${total}</os:totalResults>`, `<os:itemsPerPage>${OPDS_PAGE_SIZE}</os:itemsPerPage>`);
        return OpdsService.feed(base, `${base}/all`, search ? `Search: ${search}` : "All books", "acquisition", href(page), links,
            books.map((b) => OpdsService.entry(base, b)));
    }

    /**
     * OPDS 2.0 (JSON) root feed: a navigation link to the book list plus the search template.
     * @param base Feed root URL path (`/opds/<token>`).
     */
    public rootFeedV2(base: string): object {
        const type = "application/opds+json";
        return {
            metadata: {title: "Vaultisse"},
            links: [
                {rel: "self", href: `${base}/v2`, type},
                {rel: "search", href: `${base}/v2/all{?q}`, type, templated: true},
            ],
            navigation: [{href: `${base}/v2/all`, title: "All books", type, rel: "current"}],
        };
    }

    /**
     * OPDS 2.0 (JSON) feed for one page of digital books.
     * @param base Feed root URL path (`/opds/<token>`).
     * @param vaultId Vault id.
     * @param search Optional search text.
     * @param page 1-based page.
     */
    public async booksFeedV2(base: string, vaultId: number, search: string | null, page: number): Promise<object> {
        const {total, books} = await new OpdsRepository(this.pool).listDigitalBooks(vaultId, search, OPDS_PAGE_SIZE, (page - 1) * OPDS_PAGE_SIZE);
        const type = "application/opds+json";
        const q = search ? `q=${encodeURIComponent(search)}&` : "";
        const href = (p: number) => `${base}/v2/all?${q}page=${p}`;
        const links: object[] = [
            {rel: "self", href: href(page), type},
            {rel: "start", href: `${base}/v2`, type},
            {rel: "search", href: `${base}/v2/all{?q}`, type, templated: true},
        ];
        if (page > 1) {
            links.push({rel: "previous", href: href(page - 1), type});
        }
        if (page * OPDS_PAGE_SIZE < total) {
            links.push({rel: "next", href: href(page + 1), type});
        }
        return {
            metadata: {title: search ? `Search: ${search}` : "All books", numberOfItems: total, itemsPerPage: OPDS_PAGE_SIZE, currentPage: page},
            links,
            publications: books.map((b) => OpdsService.publication(base, b)),
        };
    }

    /**
     * One OPDS 2.0 publication.
     * @param base Feed root URL path.
     * @param b The book.
     */
    private static publication(base: string, b: OpdsBook): object {
        const metadata: Record<string, unknown> = {
            "@type": "http://schema.org/Book",
            title: b.name,
            modified: new Date(b.date_updated).toISOString(),
        };
        if (b.authors.length > 0) {
            metadata.author = b.authors.map((name) => ({name}));
        }
        if (b.isbn) {
            metadata.identifier = `urn:isbn:${b.isbn}`;
        }
        if (b.publisher) {
            metadata.publisher = b.publisher;
        }
        if (b.language_code) {
            metadata.language = b.language_code.trim();
        }
        if (b.description) {
            metadata.description = b.description;
        }
        const pub: Record<string, unknown> = {
            metadata,
            links: b.files.map((f) => ({
                rel: "http://opds-spec.org/acquisition",
                href: `${base}/book/${b.id}/file/${f.id}`,
                type: OpdsService.mimeFor(f.file_type),
                title: f.file_type,
                properties: {},
            })),
        };
        if (b.image_url && /^https?:\/\//i.test(b.image_url)) {
            pub.images = [{href: b.image_url, type: "image/jpeg"}];
        }
        return pub;
    }

    /**
     * One acquisition <entry>.
     * @param base Feed root URL path.
     * @param b The book.
     */
    private static entry(base: string, b: OpdsBook): string {
        const e = OpdsService.esc;
        const parts = [`<entry>`, `<id>urn:vaultisse:book:${b.id}</id>`, `<title>${e(b.name)}</title>`,
            `<updated>${new Date(b.date_updated).toISOString()}</updated>`];
        for (const a of b.authors) {
            parts.push(`<author><name>${e(a)}</name></author>`);
        }
        if (b.isbn) {
            parts.push(`<dc:identifier>urn:isbn:${e(b.isbn)}</dc:identifier>`);
        }
        if (b.publisher) {
            parts.push(`<dc:publisher>${e(b.publisher)}</dc:publisher>`);
        }
        if (b.language_code) {
            parts.push(`<dc:language>${e(b.language_code.trim())}</dc:language>`);
        }
        if (b.description) {
            parts.push(`<content type="text">${e(b.description)}</content>`);
        }
        if (b.image_url && /^https?:\/\//i.test(b.image_url)) {
            parts.push(`<link rel="http://opds-spec.org/image" href="${e(b.image_url)}"/>`);
        }
        for (const f of b.files) {
            parts.push(`<link rel="http://opds-spec.org/acquisition" href="${e(`${base}/book/${b.id}/file/${f.id}`)}" type="${OpdsService.mimeFor(f.file_type)}" length="${f.file_size}" title="${e(f.file_type)}"/>`);
        }
        parts.push(`</entry>`);
        return parts.join("");
    }
}
