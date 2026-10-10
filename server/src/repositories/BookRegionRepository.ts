import axios from "axios";
import {XMLParser} from "fast-xml-parser";
import {spawn} from "node:child_process";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */

/* -------------------------------------------------------------------------- */
export interface BookMetadata {
	isbn: string;                 // ISBN-13, digits only
	title: string;
	subtitle?: string;
	authors: string[];
	publisher?: string;
	publishedYear?: string;
	language?: string;
}

/* -------------------------------------------------------------------------- */
/*  Repository                                                                */

/* -------------------------------------------------------------------------- */
/**
 * Given a region ("ES", "IT", "DE") and isbn code, try to search in the specific book region repository
 */
export class BookRegionRepository {

	/**
	 *
	 * @private
	 */
	private SUPPORTED_REGIONS = ["ES", "IT", "DE"]

	private static readonly TIMEOUT_MS = 8000;
	private static readonly USER_AGENT = "Vaultisse/1.0 (+https://github.com/AlbertAmat/vaultisse)";

	private static readonly DNB_SRU = "https://services.dnb.de/sru/dnb";
	private static readonly BNE_SPARQL = "http://datos.bne.es/sparql";
	private static readonly SBN_Z3950 = {host: "opac.sbn.it:2100", database: "nopac"};

	/**
	 * VERIFY THESE IN http://datos.bne.es/sparql BEFORE RELYING ON THEM.
	 * I could not confirm the exact property URIs for ISBN/title/etc.
	 */
	private static readonly BNE_PROPS = {
		isbn: "http://datos.bne.es/def/P3013",
		title: "http://datos.bne.es/def/P3002",
		author: "http://datos.bne.es/def/P3004",
		publisher: "http://datos.bne.es/def/P3006",
		date: "http://datos.bne.es/def/P3003",
	};

	private readonly xml = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: "@_",
		removeNSPrefix: true,
		isArray: (name) => ["record", "datafield", "subfield", "controlfield"].includes(name),
	});

	/**
	 *
	 * @param region
	 */
	public regionSupported(region: string): boolean {
		return this.SUPPORTED_REGIONS.includes(region)
	}

	/**
	 *
	 * @param isbn
	 * @param region
	 */
	public async addBook(isbn: string, region: string): Promise<BookMetadata | null> {

		region = region.trim().toUpperCase();

		if (region.length != 2) {
			console.log("Invalid region format");
			return null;
		}

		if (!this.regionSupported(region)) {
			console.log("Unsupported region");
			return null;
		}

		const isbn13 = this.__normalizeIsbn(isbn);
		if (!isbn13) {
			console.log("Invalid ISBN");
			return null;
		}

		try {
			switch (region) {
				case "DE":
					return await this.__fetchDNB(isbn13);
				case "ES":
					return await this.__fetchBNE(isbn13);
				case "IT":
					return await this.__fetchSBN(isbn13);
			}
		} catch (err) {
			console.log(`Lookup failed for ${isbn13} (${region}):`, err);
		}
		return null;
	}

	/**
	 * Germany - DNB (SRU, MARC21-xml)
	 * @param isbn
	 * @private
	 */
	private async __fetchDNB(isbn: string): Promise<BookMetadata | null> {

		const xml = await this.__get<string>(BookRegionRepository.DNB_SRU, {
			version: "1.1",
			operation: "searchRetrieve",
			query: `isbn=${isbn}`,
			recordSchema: "MARC21-xml",
			maximumRecords: 1,
		});

		return this.__parseMarc(xml, isbn);
	}

	/**
	 * Spain - BNE (datos.bne.es SPARQL)
	 * @param isbn
	 * @private
	 */
	private async __fetchBNE(isbn: string): Promise<BookMetadata | null> {

		const p = BookRegionRepository.BNE_PROPS;
		const isbn10 = this.__toIsbn10(isbn);
		const values = [isbn, isbn10].filter(Boolean).map(v => `"${v}"`).join(" ");

		const query = `
          SELECT ?title ?author ?publisher ?date WHERE {
             VALUES ?isbn { ${values} }
             ?book <${p.isbn}> ?isbn ;
                   <${p.title}> ?title .
             OPTIONAL { ?book <${p.author}> ?author }
             OPTIONAL { ?book <${p.publisher}> ?publisher }
             OPTIONAL { ?book <${p.date}> ?date }
          } LIMIT 1`;

		const json = await this.__get<any>(
			BookRegionRepository.BNE_SPARQL,
			{query},
			{Accept: "application/sparql-results+json"},
			"json",
		);
		const row = json?.results?.bindings?.[0];
		if (!row) return null;

		return {
			isbn,
			title: this.__cleanIsbd(row.title?.value ?? ""),
			authors: row.author?.value ? [this.__cleanIsbd(row.author.value)] : [],
			publisher: row.publisher?.value ? this.__cleanIsbd(row.publisher.value) : undefined,
			publishedYear: row.date?.value?.match(/\d{4}/)?.[0],
		};
	}

	/* ---------------------------------------------------------------------- */
	/*  Italy - SBN (Z39.50 via injected client)                              */

	/* ---------------------------------------------------------------------- */

	private async __fetchSBN(isbn: string): Promise<BookMetadata | null> {
		const {host, database} = BookRegionRepository.SBN_Z3950;

		const marc = await new Promise<string | null>((resolve, reject) => {
			const yaz = spawn("yaz-client", [], {
				stdio: ["pipe", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";

			const timeout = setTimeout(() => {
				yaz.kill("SIGKILL");
				reject(new Error("SBN Z39.50 request timed out"));
			}, BookRegionRepository.TIMEOUT_MS);

			yaz.stdout.setEncoding("utf8");
			yaz.stderr.setEncoding("utf8");

			yaz.stdout.on("data", (data: string) => {
				stdout += data;
			});

			yaz.stderr.on("data", (data: string) => {
				stderr += data;
			});

			yaz.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});

			yaz.on("close", (code) => {
				clearTimeout(timeout);

				if (code !== 0) {
					reject(
						new Error(
							stderr.trim() ||
							`yaz-client exited with code ${code}`
						)
					);
					return;
				}

				/*
				 * `show 1` returns the first matching record.
				 *
				 * We ask YAZ for UNIMARC because SBN natively supports
				 * UNIMARC and our parser below knows how to interpret it.
				 */
				resolve(stdout.trim() || null);
			});

			/*
			 * SBN:
			 *   host     = opac.sbn.it
			 *   port     = 2100
			 *   database = nopac
			 *
			 * BIB-1 attribute 7 = ISBN
			 */
			yaz.stdin.write(`open ${host}/${database}\n`);

			yaz.stdin.write(
				`find @attr 1=7 ${isbn}\n`
			);

			/*
			 * Request marc21.
			 *
			 * YAZ uses the record syntax selected by the "format"
			 * command. "marc21" is the format we want from SBN since Germany also uses it.
			 */
			yaz.stdin.write("format marc21\n");

			yaz.stdin.write("show 1\n");
			yaz.stdin.write("quit\n");
			yaz.stdin.end();
		});

		if (!marc) {
			return null;
		}

		// SBN's native format is UNIMARC; switch to "marc21" if your client converts it.
		return this.__parseSbnMarc21(marc, isbn);
	}

	/* ---------------------------------------------------------------------- */
	/*  MARC parsing                                                          */

	/* ---------------------------------------------------------------------- */

	/**
	 * MARC parsing
	 * @param xml
	 * @param isbn
	 * @private
	 */
	private __parseMarc(
		xml: string,
		isbn: string,
	): BookMetadata | null {

		const doc = this.xml.parse(xml);

		// SRU envelope (DNB) or a bare MARC <record> (Z39.50 client)
		const sruRecord = doc?.searchRetrieveResponse?.records?.record?.[0]?.recordData?.record?.[0];
		const record = sruRecord ?? doc?.record?.[0];
		if (!record) return null;

		const fields: any[] = record.datafield ?? [];
		const sub = (tag: string, code: string): string[] =>
			fields
				.filter(f => f["@_tag"] === tag)
				.flatMap(f => (f.subfield ?? []).filter((s: any) => s["@_code"] === code))
				.map((s: any) => String(s["#text"] ?? "").trim())
				.filter(Boolean);

		let title: string | undefined, subtitle: string | undefined;
		let authors: string[] = [];
		let publisher: string | undefined, date: string | undefined, language: string | undefined;


		title = sub("245", "a")[0];
		subtitle = sub("245", "b")[0];
		authors = [...sub("100", "a"), ...sub("700", "a")];
		publisher = sub("264", "b")[0] ?? sub("260", "b")[0];
		date = sub("264", "c")[0] ?? sub("260", "c")[0];
		language = sub("041", "a")[0];

		if (!title) return null;

		return {
			isbn,
			title: this.__cleanIsbd(title),
			subtitle: subtitle ? this.__cleanIsbd(subtitle) : undefined,
			authors: [...new Set(authors.map(a => this.__cleanIsbd(a)))],
			publisher: publisher ? this.__cleanIsbd(publisher) : undefined,
			publishedYear: date?.match(/\d{4}/)?.[0],
			language
		};
	}

	private __parseSbnMarc21(
		output: string,
		isbn: string
	): BookMetadata | null {
		// Find the actual MARC record.
		// YAZ prints a lot of protocol/debug information around it.
		const recordStart = output.indexOf("Record type: USmarc");

		if (recordStart === -1) {
			return null;
		}

		const record = output.slice(recordStart);

		const getField = (tag: string): string[] => {
			const lines = record
				.split(/\r?\n/)
				.filter(line => line.startsWith(tag));

			return lines.flatMap(line => {
				// MARC fields look like:
				//
				// 245 10 $a Title / $c Author.
				//
				// Extract each $code value.
				const matches = [...line.matchAll(/\$([a-z0-9])\s+([^$]+)/gi)];

				return matches.map(match => match[2].trim());
			});
		};

		const title = getField("245")[0];

		const publisherField = getField("260")[0];
		const dateField = getField("260")[0];

		if (!title) {
			return null;
		}

		/*
		 * More precise extraction from the actual MARC subfields.
		 */
		const getSubfield = (
			tag: string,
			code: string
		): string[] => {
			const lines = record
				.split(/\r?\n/)
				.filter(line => line.startsWith(tag));

			return lines.flatMap(line => {
				const matches = [
					...line.matchAll(
						new RegExp(`\\$${code}\\s+([^$]+)`, "gi")
					),
				];

				return matches.map(match => match[1].trim());
			});
		};

		const marcTitle = getSubfield("245", "a")[0];
		const subtitle = getSubfield("245", "b")[0];

		const marcAuthors = [
			...getSubfield("100", "a"),
			...getSubfield("700", "a"),
		];

		const publisher = getSubfield("260", "b")[0];
		const place = getSubfield("260", "a")[0];
		const date = getSubfield("260", "c")[0];

		const language = getSubfield("041", "a")[0];

		return {
			isbn,
			title: this.__cleanIsbd(marcTitle ?? title),
			subtitle: subtitle
				? this.__cleanIsbd(subtitle)
				: undefined,
			authors: [
				...new Set(
					marcAuthors.map(author =>
						this.__cleanIsbd(author)
					)
				),
			],
			publisher: publisher
				? this.__cleanIsbd(publisher)
				: undefined,
			publishedYear: date?.match(/\d{4}/)?.[0],
			language
		};
	}


	/* ---------------------------------------------------------------------- */
	/*  Helpers                                                               */

	/* ---------------------------------------------------------------------- */

	/** GET via axios. Throws on non-2xx (axios default), which addBook catches and logs. */
	private async __get<T>(
		url: string,
		params: Record<string, string | number> = {},
		headers: Record<string, string> = {},
		responseType: "text" | "json" = "text",
	): Promise<T> {
		const res = await axios.get<T>(url, {
			params,
			headers: {"User-Agent": BookRegionRepository.USER_AGENT, ...headers},
			timeout: BookRegionRepository.TIMEOUT_MS,
			responseType,
		});
		return res.data;
	}

	/** Removes trailing ISBD punctuation (" /", " :", ",", ".") that MARC data carries. */
	private __cleanIsbd(value: string): string {
		return value.replace(/\s*[\/:;,.]+\s*$/, "").replace(/\s+/g, " ").trim();
	}

	/**
	 * Accepts ISBN-10 or ISBN-13 (hyphens/spaces allowed). Returns a valid ISBN-13 or null.
	 * Also drops the invisible zero-width/direction marks (e.g. U+200E) that get copied along with an ISBN from some web pages.
	 */
	private __normalizeIsbn(raw: string): string | null {
		const s = raw.replace(/[\s\-\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "").toUpperCase();

		if (/^\d{9}[\dX]$/.test(s)) {
			const sum = [...s].reduce((acc, c, i) => acc + (c === "X" ? 10 : Number(c)) * (10 - i), 0);
			if (sum % 11 !== 0) return null;
			const core = "978" + s.slice(0, 9);
			return core + this.__isbn13CheckDigit(core);
		}

		if (/^\d{13}$/.test(s)) {
			return this.__isbn13CheckDigit(s.slice(0, 12)) === s[12] ? s : null;
		}

		return null;
	}

	private __isbn13CheckDigit(first12: string): string {
		const sum = [...first12].reduce((acc, c, i) => acc + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
		return String((10 - (sum % 10)) % 10);
	}

	/** Only 978-prefixed ISBN-13s have an ISBN-10 equivalent. */
	private __toIsbn10(isbn13: string): string | null {
		if (!isbn13.startsWith("978")) return null;
		const core = isbn13.slice(3, 12);
		const sum = [...core].reduce((acc, c, i) => acc + Number(c) * (10 - i), 0);
		const check = (11 - (sum % 11)) % 11;
		return core + (check === 10 ? "X" : String(check));
	}
}