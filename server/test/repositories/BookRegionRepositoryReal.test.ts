import {BookRegionRepository} from "../../src/repositories/BookRegionRepository";

describe("BookRegionRepositoryReal - DNB integration", () => {
    // This test performs a REAL HTTP request to DNB.
    it("fetches a real book from DNB and prints the JSON", async () => {
        const repo = new BookRegionRepository();

        const isbn = "9783864932496";

        const book = await repo.addBook(isbn, "DE");

        console.log("\n===== DNB RESPONSE =====");
        console.log(JSON.stringify(book, null, 2));
        console.log("========================\n");

        expect(book).not.toBeNull();
        expect(book?.isbn).toBe(isbn);
    }, 15000);
});

describe("BookRegionRepositoryReal - BNE integration", () => {
	// This test performs a REAL HTTP request to DNB.
	it("fetches a real book from BNE and prints the JSON", async () => {
		const repo = new BookRegionRepository();

		const isbn = "9788437604947";

		const book = await repo.addBook(isbn, "ES");

		console.log("\n===== BNE RESPONSE =====");
		console.log(JSON.stringify(book, null, 2));
		console.log("========================\n");

		expect(book).not.toBeNull();
		expect(book?.isbn).toBe(isbn);
	}, 15000);
});


describe("BookRegionRepositoryReal - SBN integration", () => {
	// This test performs a REAL HTTP request to DNB.
	it("fetches a real book from SBN and prints the JSON", async () => {
		const repo = new BookRegionRepository();

		const isbn = "9788800000000";

		const book = await repo.addBook(isbn, "IT");

		console.log("\n===== SBN RESPONSE =====");
		console.log(JSON.stringify(book, null, 2));
		console.log("========================\n");

		expect(book).not.toBeNull();
		expect(book?.isbn).toBe(isbn);
	}, 15000);
});