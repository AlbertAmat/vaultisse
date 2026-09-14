/**
 * Content-based validation for the book ebook-file upload (see BooksRoute.ts
 * `POST /:id/file`). The client and multer's `fileFilter` only check the
 * uploaded file's *name* - trivially spoofed by renaming any file to end in
 * `.pdf`/`.epub`. These checks look at the actual bytes instead, so an
 * unrelated (or malicious) file can't ride in disguised as a book.
 */

/** Bytes to scan for the `%PDF-` header - real-world PDFs occasionally have a small preamble before it. */
const PDF_HEADER_SEARCH_WINDOW = 1024;

/** Byte offset, into a PalmDOC/MOBI file, of the 8-byte type/creator identifier. */
const MOBI_MAGIC_OFFSET = 60;

/** The identifier value shared by classic MOBI and AZW3/KF8 files - AZW3 still wraps a MOBI6 header for backward compatibility. */
const MOBI_MAGIC = "BOOKMOBI";

/** Content-based (not filename-based) validation for uploaded ebook files. A static-only utility class - stateless, no DB access, same treatment as BookMetadataRepository.ts. */
export class FileSignature {
    /** Static-only utility class, never instantiated. */
    private constructor() {
    }

    /**
     * Checks whether a buffer starts with a PDF header.
     * @param buffer Uploaded file bytes.
     * @returns Whether `buffer` starts with a PDF header within the first {@link PDF_HEADER_SEARCH_WINDOW} bytes.
     */
    public static isValidPdf(buffer: Buffer): boolean {
        return buffer.subarray(0, PDF_HEADER_SEARCH_WINDOW).includes("%PDF-");
    }

    /**
     * An epub is a zip archive whose *first* entry must be a stored (uncompressed)
     * file named `mimetype` containing exactly `application/epub+zip` (EPUB OCF
     * spec). Checking this - rather than just the zip signature - rejects any
     * other zip-based format (docx, jar, apk, a plain zip, ...) riding in as a
     * fake epub.
     * @param buffer Uploaded file bytes.
     * @returns Whether `buffer` looks like a valid EPUB.
     */
    public static isValidEpub(buffer: Buffer): boolean {
        try {
            // Local file header signature "PK\x03\x04".
            if (buffer.length < 30 || buffer.readUInt32LE(0) !== 0x04034b50) {
                return false;
            }

            const compressionMethod = buffer.readUInt16LE(8);
            const compressedSize = buffer.readUInt32LE(18);
            const fileNameLength = buffer.readUInt16LE(26);
            const extraFieldLength = buffer.readUInt16LE(28);

            const fileName = buffer.subarray(30, 30 + fileNameLength).toString("ascii");
            if (fileName !== "mimetype" || compressionMethod !== 0) {
                return false;
            }

            const contentStart = 30 + fileNameLength + extraFieldLength;
            const content = buffer.subarray(contentStart, contentStart + compressedSize).toString("ascii");
            return content === "application/epub+zip";
        } catch {
            return false;
        }
    }

    /**
     * A Kindle ebook file (.mobi or .azw3): both are PalmDOC-container formats
     * that carry the ASCII identifier `BOOKMOBI` at a fixed offset.
     * @param buffer Uploaded file bytes.
     * @returns Whether `buffer` looks like a valid MOBI/AZW3 file.
     */
    public static isValidMobi(buffer: Buffer): boolean {
        if (buffer.length < MOBI_MAGIC_OFFSET + MOBI_MAGIC.length) {
            return false;
        }
        return buffer.subarray(MOBI_MAGIC_OFFSET, MOBI_MAGIC_OFFSET + MOBI_MAGIC.length).toString("ascii") === MOBI_MAGIC;
    }
}
