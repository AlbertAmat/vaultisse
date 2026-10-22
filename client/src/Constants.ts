/** Base path every backend REST call is prefixed with (see server/src/AppService.ts's `ROUTE_PREFIX`); defined once in `@vaultisse/api-client`. */
export {API_PATH_PREFIX as PATH_PREFIX} from "@vaultisse/api-client";

/** The `formats.name` value that marks a book as a digital/ebook edition (see `Book.isElectronic()`). */
export const ELECTRONIC_FORMAT_NAME = "Electronic";
