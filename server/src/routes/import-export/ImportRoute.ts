/**
 * =============================================================================
 * ImportRoute
 * =============================================================================
 * Mounted at `/api/rest/import` (see server/src/routes/Routes.ts). Bulk-loads
 * books into the caller's catalog from a file exported by some other
 * service, instead of adding them one by one through `BooksRoute.ts`.
 *
 * Deliberately split out of `UserRoute.ts`/`BooksRoute.ts` into its own
 * folder (`routes/import-export/`) since "import" and "export" are one
 * feature with room to grow (more origins now, an export endpoint later),
 * not a couple of one-off endpoints belonging to an existing router.
 *
 * Every origin's file format is reduced to `IImportedBook[]` by its own
 * parser (see `parsers/`) before this ever touches the database - adding an
 * origin means adding a parser and a line in ImportService's `PARSERS`, the
 * route itself doesn't change. See
 * ImportController/ImportService/ImportRepository (+ ImportEnrichmentService
 * for the deferred post-import metadata fill) for the actual request
 * handling, business rules, and SQL respectively.
 */
import {Request, Response, Router} from 'express';
import {appService} from "../../AppService";
import {requireAuth} from "../../middlewares/AuthMiddleware";
import {requireVaultPermission} from "../../middlewares/VaultPermissionMiddleware";
import {ImportController, uploadCsv, handleImportUploadError} from "../../controllers/ImportController";
import {lazy} from "../lazySingleton";

const router = Router();
const getImportController = lazy(() => new ImportController(appService.getDatabasePool()));

/**
 * GET /import/template/:origin
 * --------------------------------
 * Downloads the starting-point CSV template for an origin that has no export of its own to convert
 * (currently only "vaultisse" - "goodreads" is exported directly from Goodreads, never hand-authored).
 *
 * Auth: required.
 *
 * Response (200): `text/csv`, `Content-Disposition: attachment` - the header row plus one filled-in example row.
 * Responses: 404 { "error": "No template available for this origin" }.
 */
router.get('/template/:origin', requireAuth, (req, res) => getImportController().downloadTemplate(req, res));

/**
 * POST /import/library
 * -----------------------
 * Parses and imports an uploaded CSV (origin "goodreads" or "vaultisse"), then schedules background
 * metadata enrichment (cover/description/publisher/... fill from Open Library etc.) for the imported rows.
 *
 * Auth: required. Body: multipart/form-data, field `file` (.csv, max size configurable via
 * `MAX_IMPORT_FILE_SIZE_MB`), plus a `origin` form field ("goodreads" | "vaultisse").
 *
 * Example response (200): { "imported": 40, "skipped": 2, "failed": 1, "errors": [{ "row": 5, "title": "...", "reason": "..." }] }
 * Responses: 400 { "error": "No CSV file provided" } / missing or unsupported `origin` / invalid CSV.
 */
router.post('/library', requireAuth, requireVaultPermission("canEditCatalog"), uploadCsv, handleImportUploadError, (req: Request, res: Response) => getImportController().importLibrary(req, res));

export default router;
