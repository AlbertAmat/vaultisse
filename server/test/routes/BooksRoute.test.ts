import axios from "axios";
import {setupTestApp} from "../helpers/testApp";
import {createAuthenticatedUser, ITestUser} from "../helpers/auth";
import {appService} from "../../src/AppService";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const app = setupTestApp();

let user: ITestUser;

beforeEach(async () => {
    user = await createAuthenticatedUser(app);
    mockedAxios.get.mockReset();
});

describe("POST /book (manual create)", () => {
    it("creates a book with just a name", async () => {
        const res = await user.agent.post("/api/rest/book").field("name", "The Hobbit");
        expect(res.status).toBe(200);
        expect(typeof res.body).toBe("number");
    });

    it("rejects a duplicate ISBN for the same user", async () => {
        await user.agent.post("/api/rest/book").field("name", "Book One").field("isbn", "9780261102217");
        const res = await user.agent.post("/api/rest/book").field("name", "Book Two").field("isbn", "9780261102217");
        expect(res.status).toBe(404);
    });

    it("allows the same ISBN across different users", async () => {
        const otherUser = await createAuthenticatedUser(app);
        await user.agent.post("/api/rest/book").field("name", "Shared ISBN Book").field("isbn", "9780261102217");
        const res = await otherUser.agent.post("/api/rest/book").field("name", "Shared ISBN Book").field("isbn", "9780261102217");
        expect(res.status).toBe(200);
    });
});

describe("GET /book/:id", () => {
    it("fetches a book the user owns", async () => {
        const createRes = await user.agent.post("/api/rest/book").field("name", "The Hobbit");
        const id = createRes.body;

        const res = await user.agent.get(`/api/rest/book/${id}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({id, name: "The Hobbit"});
        expect(res.body.authors).toEqual([]);
        expect(res.body.stocks).toEqual([]);
    });

    it("404s for a book belonging to another user", async () => {
        const createRes = await user.agent.post("/api/rest/book").field("name", "Private Book");
        const id = createRes.body;

        const otherUser = await createAuthenticatedUser(app);
        const res = await otherUser.agent.get(`/api/rest/book/${id}`);
        expect(res.status).toBe(404);
    });

    it("404s for a nonexistent id", async () => {
        const res = await user.agent.get("/api/rest/book/999999999");
        expect(res.status).toBe(404);
    });
});

describe("PUT /book/:id", () => {
    it("updates fields and reconciles the author list", async () => {
        const createRes = await user.agent.post("/api/rest/book").field("name", "Draft Title");
        const id = createRes.body;

        const authorRes = await user.agent.post("/api/rest/author").send({name: "Jane Author"});
        const authorId = authorRes.body.id;

        const updateRes = await user.agent.put(`/api/rest/book/${id}`).send({
            name: "Final Title",
            description: "A great book.",
            isbn: null,
            category_id: null,
            language_code: null,
            authors: [authorId],
            publisher: "Acme",
            published_date: "2020-01-01",
            pages: 42,
            format_id: null,
        });
        expect(updateRes.status).toBe(200);

        const getRes = await user.agent.get(`/api/rest/book/${id}`);
        expect(getRes.body).toMatchObject({name: "Final Title", description: "A great book.", publisher: "Acme"});
        expect(getRes.body.authors).toEqual([{id: authorId, name: "Jane Author"}]);
    });

    it("404s updating a book that doesn't exist", async () => {
        const res = await user.agent.put("/api/rest/book/999999999").send({name: "X"});
        expect(res.status).toBe(404);
    });

    it("sets and clears the reading status", async () => {
        const createRes = await user.agent.post("/api/rest/book").field("name", "Reading Status Book");
        const id = createRes.body;

        const updateRes = await user.agent.put(`/api/rest/book/${id}`).send({
            name: "Reading Status Book", authors: [], reading_status: 1,
        });
        expect(updateRes.status).toBe(200);

        const getRes = await user.agent.get(`/api/rest/book/${id}`);
        expect(getRes.body.reading_status).toBe(1);

        const clearRes = await user.agent.put(`/api/rest/book/${id}`).send({
            name: "Reading Status Book", authors: [], reading_status: null,
        });
        expect(clearRes.status).toBe(200);

        const clearedRes = await user.agent.get(`/api/rest/book/${id}`);
        expect(clearedRes.body.reading_status).toBeNull();
    });

    it("400s on an invalid reading status", async () => {
        const createRes = await user.agent.post("/api/rest/book").field("name", "Bad Reading Status Book");
        const id = createRes.body;

        const res = await user.agent.put(`/api/rest/book/${id}`).send({
            name: "Bad Reading Status Book", authors: [], reading_status: 99,
        });
        expect(res.status).toBe(400);
    });
});

describe("DELETE /book/:id", () => {
    it("deletes a book the user owns", async () => {
        const createRes = await user.agent.post("/api/rest/book").field("name", "Disposable Book");
        const id = createRes.body;

        const deleteRes = await user.agent.delete(`/api/rest/book/${id}`);
        expect(deleteRes.status).toBe(200);

        const getRes = await user.agent.get(`/api/rest/book/${id}`);
        expect(getRes.status).toBe(404);
    });

    it("404s for a nonexistent book", async () => {
        const res = await user.agent.delete("/api/rest/book/999999999");
        expect(res.status).toBe(404);
    });
});

describe("GET /book/search", () => {
    it("finds a book by (partial, case-insensitive) name", async () => {
        await user.agent.post("/api/rest/book").field("name", "The Great Gatsby");
        const res = await user.agent.get("/api/rest/book/search").query({query: "great gatsby"});
        expect(res.status).toBe(200);
        expect(res.body.books.some((b: any) => b.name === "The Great Gatsby")).toBe(true);
    });

    it("only returns the caller's own books", async () => {
        const otherUser = await createAuthenticatedUser(app);
        await otherUser.agent.post("/api/rest/book").field("name", "Someone Else's Book");

        const res = await user.agent.get("/api/rest/book/search").query({query: "Someone Else's Book"});
        expect(res.body.books).toEqual([]);
    });

    it("filters by category_id", async () => {
        const categoryRes = await user.agent.post("/api/rest/category").send({name: "Sci-Fi Search Test"});
        const categoryId = categoryRes.body.id;

        const createRes = await user.agent.post("/api/rest/book").field("name", "Categorized Book");
        await user.agent.put(`/api/rest/book/${createRes.body}`).send({
            name: "Categorized Book", category_id: categoryId, authors: [],
        });

        const res = await user.agent.get("/api/rest/book/search").query({category_id: categoryId});
        expect(res.body.books.some((b: any) => b.id === createRes.body)).toBe(true);
    });

    it("filters by WANT_TO_READ and CURRENTLY_READING reading status", async () => {
        const wantToReadRes = await user.agent.post("/api/rest/book").field("name", "Want To Read Search Book");
        await user.agent.put(`/api/rest/book/${wantToReadRes.body}`).send({
            name: "Want To Read Search Book", authors: [], reading_status: 0,
        });

        const currentlyReadingRes = await user.agent.post("/api/rest/book").field("name", "Currently Reading Search Book");
        await user.agent.put(`/api/rest/book/${currentlyReadingRes.body}`).send({
            name: "Currently Reading Search Book", authors: [], reading_status: 1,
        });

        const wantToReadSearch = await user.agent.get("/api/rest/book/search").query({filters: "WANT_TO_READ"});
        expect(wantToReadSearch.body.books.some((b: any) => b.id === wantToReadRes.body)).toBe(true);
        expect(wantToReadSearch.body.books.some((b: any) => b.id === currentlyReadingRes.body)).toBe(false);

        const currentlyReadingSearch = await user.agent.get("/api/rest/book/search").query({filters: "CURRENTLY_READING"});
        expect(currentlyReadingSearch.body.books.some((b: any) => b.id === currentlyReadingRes.body)).toBe(true);
        expect(currentlyReadingSearch.body.books.some((b: any) => b.id === wantToReadRes.body)).toBe(false);
    });
});

describe("GET /book/counters", () => {
    it("counts the caller's books", async () => {
        await user.agent.post("/api/rest/book").field("name", "Counted Book");
        const res = await user.agent.get("/api/rest/book/counters");
        expect(res.status).toBe(200);
        expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it("counts books by reading status", async () => {
        const createRes = await user.agent.post("/api/rest/book").field("name", "Counted Reading Status Book");
        await user.agent.put(`/api/rest/book/${createRes.body}`).send({
            name: "Counted Reading Status Book", authors: [], reading_status: 0,
        });

        const res = await user.agent.get("/api/rest/book/counters");
        expect(res.status).toBe(200);
        expect(res.body.wantToRead).toBeGreaterThanOrEqual(1);
        expect(res.body.currentlyReading).toBeGreaterThanOrEqual(0);
    });
});

describe("POST /book/isbn/:isbn (external metadata lookup)", () => {
    /**
     * GOOGLE_BOOKS_API_KEY is forced empty in tests (see test/setup/testEnv.js),
     * so `fetchBookData` always takes the Open Library fallback branch, never
     * the Google Books one - this mocks that branch's two calls (metadata
     * search, then the covers API) by URL, rather than assuming either
     * provider specifically. If a real key is ever configured, this
     * intentionally isn't what would run in production.
     */
    function mockOpenLibraryMetadata(overrides: {title?: string; authorName?: string[]; pages?: number} = {}) {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes("openlibrary.org/search.json")) {
                return Promise.resolve({
                    data: {
                        docs: [{
                            title: overrides.title ?? "Mocked Book Title",
                            author_name: overrides.authorName ?? ["Mock Author"],
                            subject: ["Fiction"],
                            publisher: ["Mock Publisher"],
                            first_publish_year: 1999,
                            number_of_pages_median: overrides.pages ?? 123,
                            language: ["eng"],
                        }],
                    },
                });
            }
            if (url.includes("covers.openlibrary.org")) {
                return Promise.resolve({status: 200, headers: {"content-type": "image/jpeg"}});
            }
            return Promise.resolve({data: {}});
        });
    }

    it("creates a book from a mocked Open Library response", async () => {
        mockOpenLibraryMetadata();

        const res = await user.agent.post("/api/rest/book/isbn/9780261102217");
        expect(res.status).toBe(200);
        const id = res.body;

        const getRes = await user.agent.get(`/api/rest/book/${id}`);
        expect(getRes.body).toMatchObject({name: "Mocked Book Title", publisher: "Mock Publisher", pages: 123});
        expect(getRes.body.authors).toEqual([{id: expect.any(Number), name: "Mock Author"}]);
    });

    it("reuses the existing book on a second lookup of the same ISBN (find-or-create)", async () => {
        mockOpenLibraryMetadata({title: "Repeatable Book"});

        const first = await user.agent.post("/api/rest/book/isbn/9780261102217");
        const second = await user.agent.post("/api/rest/book/isbn/9780261102217");
        expect(second.text).toBe(first.text);
    });

    it("rejects a malformed ISBN", async () => {
        const res = await user.agent.post("/api/rest/book/isbn/not-an-isbn");
        expect(res.status).toBe(400);
    });

    it("404s when no metadata is found anywhere", async () => {
        mockedAxios.get.mockResolvedValue({data: {}}); // No `docs` in the Open Library response.
        const res = await user.agent.post("/api/rest/book/isbn/9780261102217");
        expect(res.status).toBe(404);
    });

    it("falls back to Open Library when Google Books succeeds with no matching volume", async () => {
        const apiKeySpy = jest.spyOn(appService, "getGoogleApiKey").mockReturnValue("test-key");
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes("googleapis.com")) {
                return Promise.resolve({data: {items: []}}); // No error - just no match.
            }
            if (url.includes("openlibrary.org/search.json")) {
                return Promise.resolve({data: {docs: [{title: "Found Via Fallback", author_name: ["Fallback Author"]}]}});
            }
            return Promise.resolve({data: {}});
        });

        const res = await user.agent.post("/api/rest/book/isbn/9780261102217");
        expect(res.status).toBe(200);

        const getRes = await user.agent.get(`/api/rest/book/${res.body}`);
        expect(getRes.body).toMatchObject({name: "Found Via Fallback"});

        apiKeySpy.mockRestore();
    });
});

describe("book stock lifecycle", () => {
    async function createLocation(agent: ITestUser["agent"], name: string) {
        const res = await agent.post("/api/rest/location").send({name, description: ""});
        return res.body.id;
    }

    it("adds, updates (loans) and removes a stock", async () => {
        const bookRes = await user.agent.post("/api/rest/book").field("name", "Stocked Book");
        const bookId = bookRes.body;
        const locationId = await createLocation(user.agent, "Main Shelf");

        const addRes = await user.agent.post(`/api/rest/book/${bookId}/stock`).send({status: 0, location_id: locationId});
        expect(addRes.status).toBe(200);
        const stockId = addRes.body.id;
        expect(addRes.body.status).toBe(0);

        // Can't create a stock as already-booked.
        const bookedCreateRes = await user.agent.post(`/api/rest/book/${bookId}/stock`).send({status: 2, location_id: locationId});
        expect(bookedCreateRes.status).toBe(406);

        const updateRes = await user.agent
            .put(`/api/rest/book/${bookId}/stock/${stockId}`)
            .send({status: 0, location_id: locationId, customer_id: null});
        expect(updateRes.status).toBe(200);

        const deleteRes = await user.agent.delete(`/api/rest/book/${bookId}/stock/${stockId}`);
        expect(deleteRes.status).toBe(200);
        expect(deleteRes.body).toBe(true);
    });

    it("loans a stock to a customer and returns it, recording loan history both times", async () => {
        const bookRes = await user.agent.post("/api/rest/book").field("name", "Loanable Book");
        const bookId = bookRes.body;
        const locationId = await createLocation(user.agent, "Loan Shelf");
        const customerRes = await user.agent.post("/api/rest/customer").send({name: "Jane Borrower"});
        const customerId = customerRes.body.id;

        const stockRes = await user.agent.post(`/api/rest/book/${bookId}/stock`).send({status: 0, location_id: locationId});
        const stockId = stockRes.body.id;

        // Transition into "booked" (2) - this exact statement used to crash
        // with a Postgres 500 (42P08, "inconsistent types deduced for
        // parameter $1") before the $1::smallint cast fix in BooksRoute.ts.
        const loanRes = await user.agent
            .put(`/api/rest/book/${bookId}/stock/${stockId}`)
            .send({status: 2, location_id: locationId, customer_id: customerId});
        expect(loanRes.status).toBe(200);
        expect(loanRes.body).toMatchObject({status: 2, customer_id: customerId});

        const afterLoanRes = await user.agent.get(`/api/rest/book/${bookId}`);
        expect(afterLoanRes.body.stocks[0]).toMatchObject({status: 2, customer_id: customerId});

        const returnRes = await user.agent
            .put(`/api/rest/book/${bookId}/stock/${stockId}`)
            .send({status: 0, location_id: locationId, customer_id: null});
        expect(returnRes.status).toBe(200);
        expect(returnRes.body.customer_id).toBeNull();

        const today = new Date().toISOString().slice(0, 10);
        const reportRes = await user.agent
            .get("/api/rest/loans/report")
            .query({date_from: today, date_to: today});
        expect(reportRes.status).toBe(200);
        const entry = reportRes.body.rows.find((l: any) => l.stockCode === stockRes.body.code);
        expect(entry).toBeDefined();
        expect(entry.returnedAt).not.toBeNull();
    });

    it("404s adding a stock at a location that doesn't belong to the user", async () => {
        const bookRes = await user.agent.post("/api/rest/book").field("name", "Another Stocked Book");
        const otherUser = await createAuthenticatedUser(app);
        const otherLocationId = await createLocation(otherUser.agent, "Someone Else's Shelf");

        const res = await user.agent.post(`/api/rest/book/${bookRes.body}/stock`).send({status: 0, location_id: otherLocationId});
        expect(res.status).toBe(404);
    });
});
