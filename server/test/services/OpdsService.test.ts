import {Pool} from "pg";
import {OpdsService} from "../../src/services/OpdsService";

describe("OpdsService", () => {
    const service = new OpdsService({} as Pool);

    it("builds a root navigation feed pointing at /all", () => {
        const xml = service.rootFeed("/opds/abc");
        expect(xml).toContain('href="/opds/abc/all"');
        expect(xml).toContain("kind=navigation");
    });

    it("describes search through the OpenSearch template", () => {
        expect(service.openSearch("/opds/abc")).toContain("/opds/abc/all?q={searchTerms}");
    });

    it("maps file types to MIME types", () => {
        expect(OpdsService.mimeFor("epub")).toBe("application/epub+zip");
        expect(OpdsService.mimeFor("pdf")).toBe("application/pdf");
        expect(OpdsService.mimeFor("other")).toBe("application/octet-stream");
    });

    it("rejects malformed tokens without touching the database", async () => {
        await expect(service.resolve("not-a-token")).resolves.toBeNull();
    });

    it("builds an OPDS 2.0 root with a templated search link", () => {
        const feed = service.rootFeedV2("/opds/abc") as any;
        expect(feed.navigation[0].href).toBe("/opds/abc/v2/all");
        expect(feed.links.find((l: any) => l.rel === "search")).toMatchObject({templated: true, href: "/opds/abc/v2/all{?q}"});
    });
});
