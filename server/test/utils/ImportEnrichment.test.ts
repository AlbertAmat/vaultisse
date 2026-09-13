import axios from "axios";
import {appService} from "../../src/AppService";
import {enrichImportedBooks} from "../../src/utils/ImportEnrichment";
import {createAuthenticatedUser} from "../helpers/auth";
import {setupTestApp} from "../helpers/testApp";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const app = setupTestApp();

describe("enrichImportedBooks", () => {
    beforeEach(() => {
        mockedAxios.get.mockReset();
        mockedAxios.get.mockImplementation((url: string) => {
            if (String(url).includes("/isbn/") || String(url).includes("/api/books")) {
                return Promise.resolve({
                    status: 200,
                    data: {
                        title: "Steve Jobs",
                        description: "A biography. ".repeat(20),
                        publishers: ["Simon & Schuster"],
                        number_of_pages: 630,
                        languages: [{key: "/languages/eng"}],
                    },
                });
            }
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

    it("fills empty cover and description after a thin ISBN insert", async () => {
        const user = await createAuthenticatedUser(app);
        const pool = appService.getDatabasePool();
        const inserted = await pool.query(
            `INSERT INTO books (name, isbn, user_id)
             VALUES ($1, $2, $3)
             RETURNING id`,
            ["Steve Jobs", "9781451648539", user.userId]
        );
        const bookId = inserted.rows[0].id;

        await enrichImportedBooks(pool, user.userId, [bookId]);

        const row = await pool.query(
            "SELECT description, image_url, publisher, pages, language_code FROM books WHERE id = $1",
            [bookId]
        );
        expect(row.rows[0].description).toContain("biography");
        expect(row.rows[0].image_url).toContain("covers.openlibrary.org");
        expect(row.rows[0].publisher).toBe("Simon & Schuster");
        expect(row.rows[0].pages).toBe(630);
        expect(row.rows[0].language_code).toBe("en");
    });

    it("does not overwrite fields the CSV already filled", async () => {
        const user = await createAuthenticatedUser(app);
        const pool = appService.getDatabasePool();
        const inserted = await pool.query(
            `INSERT INTO books (name, isbn, description, publisher, pages, user_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            ["Steve Jobs", "9781451648539", "My review from Goodreads", "CSV Publisher", 12, user.userId]
        );
        const bookId = inserted.rows[0].id;

        await enrichImportedBooks(pool, user.userId, [bookId]);

        const row = await pool.query(
            "SELECT description, publisher, pages FROM books WHERE id = $1",
            [bookId]
        );
        expect(row.rows[0].description).toBe("My review from Goodreads");
        expect(row.rows[0].publisher).toBe("CSV Publisher");
        expect(row.rows[0].pages).toBe(12);
    });
});
