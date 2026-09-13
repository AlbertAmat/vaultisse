import axios from "axios";
import {
    fetchBookMetadata,
    fetchOpenLibraryCover,
    mergeVolume,
    normalizeGoogleApiKey,
    normalizeLanguageCode,
    parseIsbnStoreHtml,
    resolveBookCover,
    wikipediaTitleScore,
} from "../../src/utils/BookMetadata";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("normalizeLanguageCode", () => {
    it("keeps a 2-letter code", () => {
        expect(normalizeLanguageCode("en")).toBe("en");
        expect(normalizeLanguageCode("CA")).toBe("ca");
    });

    it("maps ISO 639-2 and Open Library /languages/ keys", () => {
        expect(normalizeLanguageCode("eng")).toBe("en");
        expect(normalizeLanguageCode("/languages/spa")).toBe("es");
        expect(normalizeLanguageCode("cat")).toBe("ca");
        expect(normalizeLanguageCode("ger")).toBe("de");
        expect(normalizeLanguageCode("fre")).toBe("fr");
    });

    it("accepts a regional tag's primary subtag", () => {
        expect(normalizeLanguageCode("en-US")).toBe("en");
    });

    it("drops codes it cannot store in CHAR(2)", () => {
        expect(normalizeLanguageCode("unknown")).toBeNull();
        expect(normalizeLanguageCode("")).toBeNull();
        expect(normalizeLanguageCode(undefined)).toBeNull();
    });
});

describe("normalizeGoogleApiKey", () => {
    it("treats empty and the string 'undefined' as missing", () => {
        expect(normalizeGoogleApiKey("")).toBeUndefined();
        expect(normalizeGoogleApiKey("   ")).toBeUndefined();
        expect(normalizeGoogleApiKey("undefined")).toBeUndefined();
        expect(normalizeGoogleApiKey(undefined)).toBeUndefined();
    });

    it("keeps a real key", () => {
        expect(normalizeGoogleApiKey(" abc ")).toBe("abc");
    });
});

describe("wikipediaTitleScore", () => {
    it("matches an exact title and a 'The … (novel)' hit", () => {
        expect(wikipediaTitleScore("The Midnight Library", "The Midnight Library")).toBe(100);
        expect(wikipediaTitleScore("Eight Mountains", "The Eight Mountains (novel)")).toBe(100);
    });

    it("scores a subtitle page high enough for Wikipedia extras (>= 70)", () => {
        expect(wikipediaTitleScore("The Midnight Library", "The Midnight Library: a novel")).toBe(80);
    });

    it("rejects an author page for a novel title", () => {
        expect(wikipediaTitleScore("32 de març", "Xavier Bosch i Sancho")).toBe(0);
    });
});

describe("parseIsbnStoreHtml", () => {
    const html = `
        <title>32 DE MARÇ - XAVIER BOSCH | paquebote.com</title>
        <a href="/CAT/libros-en-catalan/listado/">Libros en catalán</a>
        <p>ISBN: <b itemprop="isbn">9791387800000</b></p>
        <h1 itemprop="name">32 DE MARÇ</h1>
        <h3 itemprop="author"><b>XAVIER BOSCH</b></h3>
        Editorial: <span itemprop="publisher"><b>LA COLLECTIVA</b></span>
        <span itemprop="datePublished">2025-09-09</span>
    `;

    it("reads schema.org Book fields and Catalan section language", () => {
        expect(parseIsbnStoreHtml(html, "9791387800000")).toEqual({
            title: "32 DE MARÇ",
            authors: ["XAVIER BOSCH"],
            publisher: "LA COLLECTIVA",
            publishedDate: "2025-09-09",
            language: "ca",
        });
    });

    it("rejects a page that does not mention the requested ISBN", () => {
        expect(parseIsbnStoreHtml(html, "9781786892737")).toBeNull();
    });

    it("rejects a 404 title", () => {
        expect(parseIsbnStoreHtml("<title>Página no encontrada | paquebote.com</title>", "9791387800000")).toBeNull();
    });
});

describe("mergeVolume", () => {
    it("fills empty fields and prefers a mixed-case title over ALL CAPS", () => {
        const target = {title: "32 DE MARÇ", authors: ["XAVIER BOSCH"]};
        mergeVolume(target, {
            title: "32 de març",
            publisher: "La Col·lectiva",
            imageLinks: {thumbnail: "http://covers.openlibrary.org/b/id/1-M.jpg"},
        });
        expect(target.title).toBe("32 de març");
        expect(target.publisher).toBe("La Col·lectiva");
        expect(target.imageLinks?.thumbnail).toBe("https://covers.openlibrary.org/b/id/1-M.jpg");
    });

    it("keeps a longer description when the current one is still a stub", () => {
        const target = {description: "Short blurb."};
        mergeVolume(target, {description: "A".repeat(200)});
        expect(target.description?.length).toBe(200);
    });
});

describe("fetchBookMetadata", () => {
    beforeEach(() => {
        mockedAxios.get.mockReset();
    });

    it("uses the Open Library edition + work, not only search.json", async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes("/api/books")) {
                return Promise.resolve({
                    status: 200,
                    data: {
                        "ISBN:9781786892737": {
                            title: "The Midnight Library",
                            authors: [{name: "Matt Haig"}],
                            cover: {medium: "https://covers.openlibrary.org/b/id/10627687-M.jpg"},
                        },
                    },
                });
            }
            if (url.includes("/isbn/")) {
                return Promise.resolve({
                    status: 200,
                    data: {title: "The Midnight Library", works: [{key: "/works/OL20965973W"}]},
                });
            }
            if (url.includes("/works/OL20965973W.json")) {
                return Promise.resolve({
                    status: 200,
                    data: {description: {value: "Between life and death there is a library. ".repeat(8)}},
                });
            }
            if (url.includes("search.json")) {
                return Promise.resolve({
                    status: 200,
                    data: {
                        docs: [{
                            title: "The Midnight Library",
                            author_name: ["Matt Haig"],
                            first_publish_year: 2020,
                            language: ["rum", "eng", "spa"],
                            key: "/works/OL20965973W",
                        }],
                    },
                });
            }
            return Promise.resolve({status: 200, data: {}});
        });

        const book = await fetchBookMetadata("9781786892737");
        expect(book).toMatchObject({
            title: "The Midnight Library",
            authors: ["Matt Haig"],
            publishedDate: "2020",
            language: "en",
        });
        expect(book?.publisher).toBeUndefined();
        expect(book?.description).toContain("Between life and death");
        expect(book?.imageLinks?.thumbnail).toContain("10627687");
        expect(mockedAxios.get.mock.calls.some(([url]) => String(url).includes("googleapis.com"))).toBe(false);
    });

    it("falls back to an ISBN store page when catalogs are empty", async () => {
        mockedAxios.get.mockImplementation((url: string, config?: {params?: Record<string, string>}) => {
            if (url.includes("paquebote.com")) {
                return Promise.resolve({
                    status: 200,
                    data: `
                        <title>32 DE MARÇ - XAVIER BOSCH | paquebote.com</title>
                        <a href="/CAT/libros-en-catalan/listado/">Libros en catalán</a>
                        <b itemprop="isbn">9791387800000</b>
                        <h1 itemprop="name">32 DE MARÇ</h1>
                        <h3 itemprop="author"><b>XAVIER BOSCH</b></h3>
                        <span itemprop="publisher"><b>LA COLLECTIVA</b></span>
                        <span itemprop="datePublished">2025-09-09</span>
                    `,
                });
            }
            if (url.includes("search.json") && config?.params?.title) {
                return Promise.resolve({
                    status: 200,
                    data: {
                        docs: [{
                            title: "32 de març",
                            author_name: ["XAVIER BOSCH SANCHO"],
                            cover_i: 14026394,
                            key: "/works/OL35055265W",
                            first_publish_year: 2023,
                        }],
                    },
                });
            }
            return Promise.resolve({status: 200, data: {}});
        });

        const book = await fetchBookMetadata("9791387800000");
        expect(book).toMatchObject({
            title: "32 de març",
            authors: ["XAVIER BOSCH"],
            publisher: "LA COLLECTIVA",
            publishedDate: "2025-09-09",
            language: "ca",
        });
        expect(book?.imageLinks?.thumbnail).toContain("14026394");
    });

    it("returns null when every source is empty", async () => {
        mockedAxios.get.mockResolvedValue({status: 200, data: {}});
        expect(await fetchBookMetadata("9780261102217")).toBeNull();
    });

    it("fills a missing ISBN cover from another Open Library edition", async () => {
        mockedAxios.get.mockImplementation((url: string, config?: {params?: Record<string, string>}) => {
            if (url.includes("/api/books") || url.includes("/isbn/")) {
                return Promise.resolve({
                    status: 200,
                    data: url.includes("/isbn/")
                        ? {title: "Eight Mountains", works: []}
                        : {"ISBN:9781784707064": {title: "Eight Mountains", authors: [{name: "Paolo Cognetti"}]}},
                });
            }
            if (url.includes("search.json") && config?.params?.isbn) {
                return Promise.resolve({status: 200, data: {docs: [{title: "Eight Mountains", author_name: ["Paolo Cognetti"]}]}});
            }
            if (url.includes("search.json") && config?.params?.q) {
                return Promise.resolve({
                    status: 200,
                    data: {
                        docs: [{
                            title: "Las Ocho Montañas / the Eight Mountains",
                            author_name: ["Paolo Cognetti"],
                            cover_i: 14856954,
                        }],
                    },
                });
            }
            if (url.includes("covers.openlibrary.org")) {
                if (url.includes("/isbn/")) {
                    return Promise.resolve({status: 404, data: Buffer.alloc(0), headers: {"content-type": "text/html"}});
                }
                return Promise.resolve({
                    status: 200,
                    headers: {"content-type": "image/jpeg"},
                    data: Buffer.alloc(1000, 1),
                });
            }
            return Promise.resolve({status: 200, data: {}});
        });

        const book = await fetchBookMetadata("9781784707064");
        expect(book?.title).toBe("Eight Mountains");
        expect(book?.imageLinks?.thumbnail).toContain("14856954");
    });
});

describe("resolveBookCover", () => {
    beforeEach(() => {
        mockedAxios.get.mockReset();
    });

    it("rejects Open Library's missing-cover placeholder", async () => {
        mockedAxios.get.mockResolvedValue({
            status: 200,
            headers: {"content-type": "image/gif"},
            data: Buffer.alloc(40, 1),
        });
        expect(await fetchOpenLibraryCover("9781784707064")).toBeNull();
    });

    it("returns the ISBN cover URL when the JPEG is real", async () => {
        mockedAxios.get.mockResolvedValue({
            status: 200,
            headers: {"content-type": "image/jpeg"},
            data: Buffer.alloc(1000, 1),
        });
        expect(await fetchOpenLibraryCover("9781786892737")).toBe(
            "https://covers.openlibrary.org/b/isbn/9781786892737-M.jpg"
        );
    });

    it("falls back to a title+author edition when the ISBN has no cover", async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes("/isbn/9781784707064")) {
                return Promise.resolve({status: 404, headers: {"content-type": "text/html"}, data: Buffer.alloc(0)});
            }
            if (url.includes("search.json")) {
                return Promise.resolve({
                    status: 200,
                    data: {
                        docs: [{
                            title: "Las Ocho Montañas / the Eight Mountains",
                            author_name: ["Paolo Cognetti"],
                            cover_i: 14856954,
                        }],
                    },
                });
            }
            if (url.includes("/b/id/14856954")) {
                return Promise.resolve({
                    status: 200,
                    headers: {"content-type": "image/jpeg"},
                    data: Buffer.alloc(1000, 1),
                });
            }
            return Promise.resolve({status: 200, data: {}});
        });

        const cover = await resolveBookCover({
            isbn: "9781784707064",
            title: "Eight Mountains",
            authors: ["Paolo Cognetti"],
        });
        expect(cover).toContain("14856954");
    });
});
