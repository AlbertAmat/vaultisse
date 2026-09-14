import {FileSignature} from "../../src/utils/FileSignature";

describe("isValidPdf", () => {
    it("accepts a buffer starting with the PDF header", () => {
        expect(FileSignature.isValidPdf(Buffer.from("%PDF-1.4\n...rest of file..."))).toBe(true);
    });

    it("accepts a PDF header preceded by a small preamble", () => {
        const buffer = Buffer.concat([Buffer.alloc(10), Buffer.from("%PDF-1.7")]);
        expect(FileSignature.isValidPdf(buffer)).toBe(true);
    });

    it("rejects a file with no PDF header", () => {
        expect(FileSignature.isValidPdf(Buffer.from("just some random text"))).toBe(false);
    });

    it("rejects the PDF header appearing after the search window", () => {
        const buffer = Buffer.concat([Buffer.alloc(2000), Buffer.from("%PDF-1.4")]);
        expect(FileSignature.isValidPdf(buffer)).toBe(false);
    });
});

/** Builds a minimal single-entry ZIP local file header, as `isValidEpub` expects to find at offset 0. */
function buildZipEntry(fileName: string, content: string, compressionMethod = 0): Buffer {
    const fileNameBuf = Buffer.from(fileName, "ascii");
    const contentBuf = Buffer.from(content, "ascii");

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // local file header signature
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(compressionMethod, 8);
    header.writeUInt16LE(0, 10); // mod time
    header.writeUInt16LE(0, 12); // mod date
    header.writeUInt32LE(0, 14); // crc32 (unchecked)
    header.writeUInt32LE(contentBuf.length, 18); // compressed size
    header.writeUInt32LE(contentBuf.length, 22); // uncompressed size
    header.writeUInt16LE(fileNameBuf.length, 26);
    header.writeUInt16LE(0, 28); // extra field length

    return Buffer.concat([header, fileNameBuf, contentBuf]);
}

describe("isValidEpub", () => {
    it("accepts a zip whose first entry is a stored 'mimetype' file with the epub content type", () => {
        const buffer = buildZipEntry("mimetype", "application/epub+zip");
        expect(FileSignature.isValidEpub(buffer)).toBe(true);
    });

    it("rejects a zip whose mimetype entry is compressed (not stored)", () => {
        const buffer = buildZipEntry("mimetype", "application/epub+zip", /* deflate */ 8);
        expect(FileSignature.isValidEpub(buffer)).toBe(false);
    });

    it("rejects a zip whose first entry isn't named 'mimetype'", () => {
        const buffer = buildZipEntry("META-INF/container.xml", "application/epub+zip");
        expect(FileSignature.isValidEpub(buffer)).toBe(false);
    });

    it("rejects a zip whose mimetype content isn't the epub type (e.g. a renamed .docx/.jar)", () => {
        const buffer = buildZipEntry("mimetype", "application/vnd.other+zip");
        expect(FileSignature.isValidEpub(buffer)).toBe(false);
    });

    it("rejects a non-zip buffer", () => {
        expect(FileSignature.isValidEpub(Buffer.from("not a zip file at all"))).toBe(false);
    });

    it("rejects a truncated/corrupt buffer without throwing", () => {
        expect(FileSignature.isValidEpub(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
    });
});

describe("isValidMobi", () => {
    it("accepts a buffer with the BOOKMOBI identifier at offset 60", () => {
        const buffer = Buffer.alloc(68);
        buffer.write("BOOKMOBI", 60, "ascii");
        expect(FileSignature.isValidMobi(buffer)).toBe(true);
    });

    it("rejects a buffer too short to contain the identifier", () => {
        expect(FileSignature.isValidMobi(Buffer.alloc(50))).toBe(false);
    });

    it("rejects a buffer with unrelated bytes at offset 60", () => {
        const buffer = Buffer.alloc(68);
        buffer.write("NOTAMOBI", 60, "ascii");
        expect(FileSignature.isValidMobi(buffer)).toBe(false);
    });
});
