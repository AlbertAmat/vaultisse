import axios from "axios";
import {setupTestApp} from "../helpers/testApp";
import {createAuthenticatedUser, ITestUser} from "../helpers/auth";
import {scheduleEnrichment} from "../../src/services/ImportEnrichmentService";

jest.mock("../../src/services/ImportEnrichmentService", () => ({
    scheduleEnrichment: jest.fn(),
}));
const mockedSchedule = scheduleEnrichment as jest.MockedFunction<typeof scheduleEnrichment>;

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const app = setupTestApp();

let user: ITestUser;

beforeEach(async () => {
    user = await createAuthenticatedUser(app);
    mockedSchedule.mockClear();
    mockedAxios.get.mockReset();
    // Default: every cover lookup "succeeds" with a plausible image response,
    // unless a specific test overrides this to simulate a miss.
    mockedAxios.get.mockImplementation((url: string) => {
        if (String(url).includes("covers.openlibrary.org")) {
            return Promise.resolve({
                status: 200,
                headers: {"content-type": "image/jpeg"},
                data: Buffer.alloc(1000, 1),
            });
        }
        return Promise.resolve({status: 200, data: {}});
    });
});

const GOODREADS_CSV = [
    "Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies",
    `1,Steve Jobs,Walter Isaacson,"Isaacson, Walter",,"=""1451648537""","=""9781451648539""",0,Simon & Schuster,Hardcover,630,2011,2011,,2026/09/11,"to-read","to-read (#1)",to-read,,,,0,0`,
    `2,No ISBN Book,Anne Frank,"Frank, Anne",,"=""""","=""""",2.0,Bantam Books,Mass Market Paperback,256,1994,1947,,2026/09/11,to-read,"to-read (#2)",to-read,,,,0,0`,
].join("\n");

const GOODREADS_SHELVES_CSV = [
    "Title,Author,ISBN,ISBN13,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Exclusive Shelf",
    'To Read Book,Someone,"=""""","=""""",Pub,Paperback,100,2000,2000,to-read',
    'Reading Now Book,Someone,"=""""","=""""",Pub,Paperback,100,2000,2000,currently-reading',
    'Finished Book,Someone,"=""""","=""""",Pub,Paperback,100,2000,2000,read',
    'Unknown Shelf Book,Someone,"=""""","=""""",Pub,Paperback,100,2000,2000,some-custom-shelf',
].join("\n");

describe("GET /import/template/:origin", () => {
    it("downloads the vaultisse template as a CSV attachment", async () => {
        const res = await user.agent.get("/api/rest/import/template/vaultisse");
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/text\/csv/);
        expect(res.headers["content-disposition"]).toMatch(/attachment/);
        expect(res.text.split("\n")[0]).toContain("Title");
        expect(res.text.split("\n")[0]).toContain("Cover");
    });

    it("404s for an origin with no template (e.g. goodreads)", async () => {
        const res = await user.agent.get("/api/rest/import/template/goodreads");
        expect(res.status).toBe(404);
    });
});

describe("POST /import/library - validation", () => {
    it("400s with no file", async () => {
        const res = await user.agent.post("/api/rest/import/library").field("origin", "goodreads");
        expect(res.status).toBe(400);
    });

    it("400s with no origin", async () => {
        const res = await user.agent.post("/api/rest/import/library").attach("file", Buffer.from(GOODREADS_CSV), "lib.csv");
        expect(res.status).toBe(400);
    });

    it("400s for an unsupported origin", async () => {
        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "calibre")
            .attach("file", Buffer.from(GOODREADS_CSV), "lib.csv");
        expect(res.status).toBe(400);
    });

    it("400s for a non-.csv file", async () => {
        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "goodreads")
            .attach("file", Buffer.from(GOODREADS_CSV), "lib.txt");
        expect(res.status).toBe(400);
    });
});

describe("POST /import/library - goodreads origin", () => {
    it("imports rows and unwraps the Excel-escaped ISBN without a network cover lookup", async () => {
        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "goodreads")
            .attach("file", Buffer.from(GOODREADS_CSV), "lib.csv");

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({imported: 2, skipped: 0, failed: 0});

        const searchRes = await user.agent.get("/api/rest/book/search").query({query: "Steve Jobs"});
        const book = searchRes.body.books.find((b: any) => b.name === "Steve Jobs");
        expect(book).toBeDefined();
        expect(book.isbn).toBe("9781451648539");
        expect(book.image_url).toBeFalsy();
        expect(mockedSchedule).toHaveBeenCalled();
        expect(mockedAxios.get).not.toHaveBeenCalled();

        const noIsbnRes = await user.agent.get("/api/rest/book/search").query({query: "No ISBN Book"});
        const noIsbnBook = noIsbnRes.body.books.find((b: any) => b.name === "No ISBN Book");
        expect(noIsbnBook.isbn).toBeNull();
        expect(noIsbnBook.image_url).toBeFalsy();
    });

    it("stores My Review as the description", async () => {
        const csv = [
            "Title,Author,ISBN,ISBN13,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Exclusive Shelf,My Review",
            'Reviewed Book,Someone,"=""""","=""""",Pub,Paperback,100,2000,2000,read,"Loved this one."',
        ].join("\n");

        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "goodreads")
            .attach("file", Buffer.from(csv), "lib.csv");
        expect(res.body.imported).toBe(1);

        const bookRes = await user.agent.get("/api/rest/book/search").query({query: "Reviewed Book"});
        const bookId = bookRes.body.books[0].id;
        const detailRes = await user.agent.get(`/api/rest/book/${bookId}`);
        expect(detailRes.body.description).toBe("Loved this one.");
    });

    it("skips re-importing the same file as duplicates", async () => {
        await user.agent
            .post("/api/rest/import/library")
            .field("origin", "goodreads")
            .attach("file", Buffer.from(GOODREADS_CSV), "lib.csv");

        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "goodreads")
            .attach("file", Buffer.from(GOODREADS_CSV), "lib.csv");

        expect(res.body).toMatchObject({imported: 0, skipped: 2, failed: 0});
    });

    it("reports a row with no title as failed without aborting the rest of the file", async () => {
        const csv = [
            "Title,Author,ISBN,ISBN13,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Exclusive Shelf",
            ',Someone,"=""""","=""""",Pub,Paperback,100,2000,2000,to-read',
            'Valid Book,Someone,"=""""","=""""",Pub,Paperback,100,2000,2000,to-read',
        ].join("\n");

        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "goodreads")
            .attach("file", Buffer.from(csv), "lib.csv");

        expect(res.body.imported).toBe(1);
        expect(res.body.failed).toBe(1);
        expect(res.body.errors[0]).toMatchObject({reason: "Missing title"});
    });

    it("maps the Exclusive Shelf column onto reading_status, leaving an unrecognized shelf untracked", async () => {
        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "goodreads")
            .attach("file", Buffer.from(GOODREADS_SHELVES_CSV), "shelves.csv");

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({imported: 4, skipped: 0, failed: 0});

        const searchRes = await user.agent.get("/api/rest/book/search");
        const byName = (name: string) => searchRes.body.books.find((b: any) => b.name === name);

        expect(byName("To Read Book").reading_status).toBe(0);
        expect(byName("Reading Now Book").reading_status).toBe(1);
        expect(byName("Finished Book").reading_status).toBe(2);
        expect(byName("Unknown Shelf Book").reading_status).toBeNull();
    });
});

const VAULTISSE_CSV_HEADER = "Title,Authors,ISBN,Publisher,Published Year,Pages,Format,Category,Description,Language,Cover";

describe("POST /import/library - vaultisse origin", () => {
    it("imports authors (semicolon-separated), category, description, language and format", async () => {
        const csv = [
            VAULTISSE_CSV_HEADER,
            'Good Omens,"Terry Pratchett;Neil Gaiman",,Gollancz,1990,288,Paperback,Fantasy,"Angel and demon team up.",en,',
        ].join("\n");

        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "vaultisse")
            .attach("file", Buffer.from(csv), "lib.csv");

        expect(res.body).toMatchObject({imported: 1, skipped: 0, failed: 0});

        const bookRes = await user.agent.get("/api/rest/book/search").query({query: "Good Omens"});
        const bookId = bookRes.body.books[0].id;
        const detailRes = await user.agent.get(`/api/rest/book/${bookId}`);

        expect(detailRes.body).toMatchObject({name: "Good Omens", description: "Angel and demon team up.", language_code: "en"});
        expect(detailRes.body.authors.map((a: any) => a.name).sort()).toEqual(["Neil Gaiman", "Terry Pratchett"]);

        const categoriesRes = await user.agent.get("/api/rest/category");
        expect(categoriesRes.body.some((c: any) => c.name === "Fantasy" && c.id === detailRes.body.category_id)).toBe(true);
    });

    it("uses an explicit base64 cover as-is, without an ISBN lookup", async () => {
        const cover = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        const csv = [VAULTISSE_CSV_HEADER, `Base64 Cover Book,Someone,,,,,,,,,"${cover}"`].join("\n");

        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "vaultisse")
            .attach("file", Buffer.from(csv), "lib.csv");
        expect(res.body.imported).toBe(1);

        const bookRes = await user.agent.get("/api/rest/book/search").query({query: "Base64 Cover Book"});
        expect(bookRes.body.books[0].image_url).toBe(cover);
        expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("rejects a disallowed cover host and does not look one up over the network", async () => {
        const csv = [
            VAULTISSE_CSV_HEADER,
            "Disallowed Cover Book,Someone,9780261102217,,,,,,,,https://evil.example.com/tracker.png",
        ].join("\n");

        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "vaultisse")
            .attach("file", Buffer.from(csv), "lib.csv");
        expect(res.body.imported).toBe(1);

        const bookRes = await user.agent.get("/api/rest/book/search").query({query: "Disallowed Cover Book"});
        expect(bookRes.body.books[0].image_url).toBeFalsy();
        expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("leaves the cover empty when the CSV has no allowed Cover value", async () => {
        const csv = [VAULTISSE_CSV_HEADER, "No Cover Book,Someone,9780261102217,,,,,,,,"].join("\n");

        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "vaultisse")
            .attach("file", Buffer.from(csv), "lib.csv");
        expect(res.body.imported).toBe(1);

        const bookRes = await user.agent.get("/api/rest/book/search").query({query: "No Cover Book"});
        expect(bookRes.body.books[0].image_url).toBeFalsy();
        expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("maps the Reading Status column onto reading_status", async () => {
        const csv = [
            `${VAULTISSE_CSV_HEADER},Reading Status`,
            "Currently Reading Vaultisse Book,Someone,,,,,,,,,,currently-reading",
        ].join("\n");

        const res = await user.agent
            .post("/api/rest/import/library")
            .field("origin", "vaultisse")
            .attach("file", Buffer.from(csv), "lib.csv");
        expect(res.body.imported).toBe(1);

        const bookRes = await user.agent.get("/api/rest/book/search").query({query: "Currently Reading Vaultisse Book"});
        expect(bookRes.body.books[0].reading_status).toBe(1);
    });
});
