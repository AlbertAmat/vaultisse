import axios from "axios";
import {BookRegionRepository} from "../../src/repositories/BookRegionRepository";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

/* -------------------------------------------------------------------------- */
/*  Fixtures (fake bibliographic data, real ISBN check digits)                */
/* -------------------------------------------------------------------------- */

const DE_ISBN = "9783864932496";   // 978-3864932496
const ES_ISBN = "9788437604947";   // 978-84-376-0494-7
const IT_ISBN = "9788800000000";   // valid check digit, made up for the test

const dnbXml = (isbn: string) => `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/">
  <version>1.1</version>
  <numberOfRecords>1</numberOfRecords>
  <records>
    <record>
      <recordSchema>MARC21-xml</recordSchema>
      <recordPacking>xml</recordPacking>
      <recordData>
        <record xmlns="http://www.loc.gov/MARC21/slim">
          <leader>00000nam a22000003c 4500</leader>
          <controlfield tag="001">123456789</controlfield>
          <datafield tag="020" ind1=" " ind2=" "><subfield code="a">${isbn}</subfield></datafield>
          <datafield tag="041" ind1=" " ind2=" "><subfield code="a">ger</subfield></datafield>
          <datafield tag="100" ind1="1" ind2=" "><subfield code="a">Mustermann, Max</subfield></datafield>
          <datafield tag="245" ind1="1" ind2="0">
            <subfield code="a">Testbuch :</subfield>
            <subfield code="b">ein Roman /</subfield>
          </datafield>
          <datafield tag="264" ind1=" " ind2="1">
            <subfield code="a">Berlin :</subfield>
            <subfield code="b">Beispielverlag,</subfield>
            <subfield code="c">2023</subfield>
          </datafield>
          <datafield tag="700" ind1="1" ind2=" "><subfield code="a">Musterfrau, Erika</subfield></datafield>
        </record>
      </recordData>
    </record>
  </records>
</searchRetrieveResponse>`;

const dnbEmptyXml = `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/">
  <version>1.1</version>
  <numberOfRecords>0</numberOfRecords>
</searchRetrieveResponse>`;

/* -------------------------------------------------------------------------- */
/*  Tests                                                                     */
/* -------------------------------------------------------------------------- */

describe("BookRegionRepository", () => {
	let repo: BookRegionRepository;
	let logSpy: jest.SpyInstance;

	beforeEach(() => {
		mockedAxios.get.mockReset();
		logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
		repo = new BookRegionRepository();
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	describe("regionSupported", () => {
		it("accepts ES, IT and DE", () => {
			expect(repo.regionSupported("ES")).toBe(true);
			expect(repo.regionSupported("IT")).toBe(true);
			expect(repo.regionSupported("DE")).toBe(true);
		});

		it("rejects other regions and is case-sensitive", () => {
			expect(repo.regionSupported("FR")).toBe(false);
			expect(repo.regionSupported("de")).toBe(false);
			expect(repo.regionSupported("")).toBe(false);
		});
	});

	describe("addBook input validation", () => {
		it("rejects a region that is not 2 letters without calling any API", async () => {
			expect(await repo.addBook(DE_ISBN, "DEU")).toBeNull();
			expect(await repo.addBook(DE_ISBN, "D")).toBeNull();
			expect(mockedAxios.get).not.toHaveBeenCalled();
		});

		it("rejects an unsupported region without calling any API", async () => {
			expect(await repo.addBook(DE_ISBN, "FR")).toBeNull();
			expect(mockedAxios.get).not.toHaveBeenCalled();
		});

		it("rejects an ISBN with a wrong check digit", async () => {
			expect(await repo.addBook("9783864932497", "DE")).toBeNull();
			expect(mockedAxios.get).not.toHaveBeenCalled();
		});

		it("rejects garbage instead of an ISBN", async () => {
			expect(await repo.addBook("not-an-isbn", "DE")).toBeNull();
			expect(await repo.addBook("", "DE")).toBeNull();
			expect(mockedAxios.get).not.toHaveBeenCalled();
		});
	});

	describe("region DE (DNB)", () => {
		it("returns normalized metadata from the DNB MARC21 record", async () => {
			mockedAxios.get.mockResolvedValue({status: 200, data: dnbXml(DE_ISBN)});

			const book = await repo.addBook(DE_ISBN, "DE");

			expect(book).toMatchObject({
				isbn: DE_ISBN,
				title: "Testbuch",
				subtitle: "ein Roman",
				authors: ["Mustermann, Max", "Musterfrau, Erika"],
				publisher: "Beispielverlag",
				publishedYear: "2023",
			});
		});

		it("queries the DNB SRU endpoint by ISBN-13", async () => {
			mockedAxios.get.mockResolvedValue({status: 200, data: dnbXml(DE_ISBN)});

			await repo.addBook(DE_ISBN, "DE");

			expect(mockedAxios.get).toHaveBeenCalledTimes(1);
			const [url, config] = mockedAxios.get.mock.calls[0] as [string, any];
			expect(url).toBe("https://services.dnb.de/sru/dnb");
			expect(config.params).toMatchObject({
				version: "1.1",
				operation: "searchRetrieve",
				query: `isbn=${DE_ISBN}`,
				recordSchema: "MARC21-xml",
			});
			expect(config.timeout).toBeGreaterThan(0);
		});

		it("accepts the hyphenated form 978-3864932496", async () => {
			mockedAxios.get.mockResolvedValue({status: 200, data: dnbXml(DE_ISBN)});

			const book = await repo.addBook("978-3864932496", "DE");

			expect(book?.isbn).toBe(DE_ISBN);
			expect((mockedAxios.get.mock.calls[0][1] as any).params.query).toBe(`isbn=${DE_ISBN}`);
		});

		it("strips the invisible direction mark copied from Amazon", async () => {
			mockedAxios.get.mockResolvedValue({status: 200, data: dnbXml(DE_ISBN)});

			const book = await repo.addBook("\u200E 978-3864932496", "DE");

			expect(book?.isbn).toBe(DE_ISBN);
		});

		it("converts an ISBN-10 to ISBN-13 before querying", async () => {
			mockedAxios.get.mockResolvedValue({status: 200, data: dnbXml(DE_ISBN)});

			await repo.addBook("3-86493-249-1", "DE");

			expect((mockedAxios.get.mock.calls[0][1] as any).params.query).toBe(`isbn=${DE_ISBN}`);
		});

		it("returns null when the DNB has no record", async () => {
			mockedAxios.get.mockResolvedValue({status: 200, data: dnbEmptyXml});
			expect(await repo.addBook(DE_ISBN, "DE")).toBeNull();
		});

		it("returns null instead of throwing when the request fails", async () => {
			mockedAxios.get.mockRejectedValue(new Error("timeout of 8000ms exceeded"));
			await expect(repo.addBook(DE_ISBN, "DE")).resolves.toBeNull();
		});
	});

	describe("region ES (BNE)", () => {
		const sparql = {
			results: {
				bindings: [{
					title: {value: "Título de prueba /"},
					author: {value: "Autor, Ejemplo,"},
					publisher: {value: "Editorial Prueba :"},
					date: {value: "[1999]"},
				}],
			},
		};

		it("returns normalized metadata from the SPARQL result", async () => {
			mockedAxios.get.mockResolvedValue({status: 200, data: sparql});

			const book = await repo.addBook(ES_ISBN, "ES");

			expect(book).toEqual({
				isbn: ES_ISBN,
				title: "Título de prueba",
				authors: ["Autor, Ejemplo"],
				publisher: "Editorial Prueba",
				publishedYear: "1999",
			});
		});

		it("asks for JSON results and puts the ISBN in the query", async () => {
			mockedAxios.get.mockResolvedValue({status: 200, data: sparql});

			await repo.addBook(ES_ISBN, "ES");

			const [url, config] = mockedAxios.get.mock.calls[0] as [string, any];
			expect(url).toBe("http://datos.bne.es/sparql");
			expect(config.headers.Accept).toBe("application/sparql-results+json");
			expect(config.responseType).toBe("json");
			expect(config.params.query).toContain(ES_ISBN);
		});

		it("returns null when the SPARQL result is empty", async () => {
			mockedAxios.get.mockResolvedValue({status: 200, data: {results: {bindings: []}}});
			expect(await repo.addBook(ES_ISBN, "ES")).toBeNull();
		});
	});

	describe("region IT (SBN)", () => {
		it("returns null when no Z39.50 client was injected", async () => {
			expect(await repo.addBook(IT_ISBN, "IT")).toBeNull();
			expect(mockedAxios.get).not.toHaveBeenCalled();
		});

		it("parses the UNIMARC record returned by the injected client", async () => {
			const italyRepo = new BookRegionRepository();

			const book = await italyRepo.addBook(IT_ISBN, "IT");

			expect(book).toMatchObject({
				isbn: IT_ISBN,
				title: "Libro di prova",
				subtitle: "un sottotitolo",
				authors: ["Rossi, Mario"],
				publisher: "Editore Prova",
				publishedYear: "2021",
			});
		});

		it("returns null when the client finds nothing", async () => {
			expect(await new BookRegionRepository().addBook(IT_ISBN, "IT")).toBeNull();
		});

		it("returns null instead of throwing when the client fails", async () => {
			await expect(new BookRegionRepository().addBook(IT_ISBN, "IT")).resolves.toBeNull();
		});
	});
});