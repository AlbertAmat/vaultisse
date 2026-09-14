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
import {ImportController, uploadCsv, handleImportUploadError} from "../../controllers/ImportController";
import {lazy} from "../lazySingleton";

const router = Router();
const getImportController = lazy(() => new ImportController(appService.getDatabasePool()));

router.get('/template/:origin', requireAuth, (req, res) => getImportController().downloadTemplate(req, res));
router.post('/library', requireAuth, uploadCsv, handleImportUploadError, (req: Request, res: Response) => getImportController().importLibrary(req, res));

export default router;
