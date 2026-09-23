import {Pool} from "pg";
import {ErrorRequestHandler, NextFunction, Request, RequestHandler, Response} from "express";
import multer from "multer";
import {appService} from "../AppService";
import {handleUploadError} from "../middlewares/UploadErrorMiddleware";
import {ImportService} from "../services/ImportService";
import {ImportEnrichmentService} from "../services/ImportEnrichmentService";
import {DomainError} from "../errors/DomainError";

/**
 * Built lazily, on the first request, rather than at module load: this
 * controller is required (via Routes.ts) from inside AppService's own
 * constructor chain, before `export const appService = new AppService()`
 * at the bottom of AppService.ts has run - calling
 * `appService.getMaxImportFileSizeMb()` at the top level here would hit it
 * while still `undefined`. By request time the whole module graph (and
 * `appService`) is long since ready. Same underlying circular-import timing
 * issue `routes/lazySingleton.ts` exists for, kept as its own local variable
 * here since this builds a `RequestHandler`, not a controller instance.
 */
let uploadCsvMiddleware: RequestHandler | null = null;

/**
 * Multer middleware for the CSV upload field - builds the multer instance lazily (see `uploadCsvMiddleware` above), then delegates to it.
 * @param req Express request.
 * @param res Express response.
 * @param next Express next-middleware callback.
 */
export function uploadCsv(req: Request, res: Response, next: NextFunction) {
    if (!uploadCsvMiddleware) {
        uploadCsvMiddleware = multer({
            storage: multer.memoryStorage(),
            limits: {fileSize: appService.getMaxImportFileSizeMb() * 1024 * 1024},
            fileFilter: (fileFilterReq: Request, file: Express.Multer.File, cb: (error: any, acceptFile: boolean) => void) => {
                if (!file.originalname.toLowerCase().endsWith(".csv")) {
                    return cb(new Error("Only CSV files are allowed"), false);
                }
                cb(null, true);
            }
        }).single("file");
    }
    uploadCsvMiddleware(req, res, next);
}

/** Same lazy-evaluation reasoning as `uploadCsv` above - read the limit at request time, not module load time. */
export const handleImportUploadError: ErrorRequestHandler = (err, req, res, next) =>
    handleUploadError(appService.getMaxImportFileSizeMb(), "json")(err, req, res, next);

/** Thin HTTP<->service glue for the Import resource. Constructed once per process (see ImportRoute.ts) and reused across requests. The multer middleware above stays module-level, not on the class, for the same reason BookController's `upload`/`fileUpload` do - it's Express middleware wiring consumed directly by ImportRoute.ts, not request-handling logic. */
export class ImportController {
    /**
     * @param pool Database connection pool, forwarded to fresh services on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * GET /import/template/:origin - downloads the starting-point CSV template for an origin.
     * @param req Express request.
     * @param res Express response.
     */
    public downloadTemplate(req: Request, res: Response): void {
        const origin = String(req.params.origin ?? "").trim().toLowerCase();

        try {
            const template = new ImportService(this.pool).getTemplate(origin);
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename="import-template-${origin}.csv"`);
            res.status(200).send(template);
        } catch (err) {
            if (err instanceof DomainError) {
                res.status(err.httpStatus).json({error: err.message});
                return;
            }
            res.status(500).json({error: "Internal Server Error"});
        }
    }

    /**
     * POST /import/library - parses and imports an uploaded CSV, then schedules background metadata enrichment.
     * @param req Express request.
     * @param res Express response.
     */
    public async importLibrary(req: Request, res: Response): Promise<void> {
        if (!req.file) {
            res.status(400).json({error: "No CSV file provided"});
            return;
        }

        const origin = String(req.body.origin ?? "").trim().toLowerCase();
        const importService = new ImportService(this.pool);

        let books;
        try {
            books = importService.parseImportFile(origin, req.file.buffer.toString("utf-8"));
        } catch (err) {
            if (err instanceof DomainError) {
                appService.getLogger().debug(`Failed to parse ${origin} import file: ${err.message}`);
                res.status(err.httpStatus).json({error: err.message});
                return;
            }
            res.status(500).json({error: "Internal Server Error"});
            return;
        }

        const vaultId = appService.getSessionVault(req);

        const {result, importedIds} = await importService.importBooks(vaultId, books);

        res.status(200).json(result);
        new ImportEnrichmentService(this.pool).scheduleEnrichment(
            vaultId,
            importedIds,
            appService.getGoogleApiKey(),
            appService.getLibraryThingApiKey()
        );
    }
}
