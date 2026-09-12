import {PATH_PREFIX} from "@/Constants";
import axiosInstance from "@/plugins/axiosInstance";
import {IImportResult, ImportOrigin} from "@/types/import/IImportResult";

/**
 * Thin HTTP client for `/api/rest/import` (see `server/src/routes/import-export/ImportRoute.ts`):
 * bulk-importing a CSV library export into the caller's catalog.
 *
 * @example
 * const result = await importService.importLibrary("goodreads", file);
 */
export class ImportService {

    /**
     * Upload a CSV export and bulk-create a book for each row it parses to.
     * @param origin Which format the file follows - "vaultisse" (the app's own template) or "goodreads" (a Goodreads library export).
     * @param file The CSV file.
     * @returns Import counts and (capped) per-row errors - always resolves on a 200, even when some/all rows were skipped or failed.
     */
    public async importLibrary(origin: ImportOrigin, file: File): Promise<IImportResult> {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("origin", origin);

        const {data} = await axiosInstance.post(`${PATH_PREFIX}/import/library`, formData);
        return data;
    }
}

export const importService = new ImportService();
