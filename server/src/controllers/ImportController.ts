import {ErrorRequestHandler, NextFunction, Request, RequestHandler, Response} from "express";
import multer from "multer";
import {appService} from "../AppService";
import {handleUploadError} from "../middlewares/UploadErrorMiddleware";
import * as ImportService from "../services/ImportService";
import * as ImportEnrichmentService from "../services/ImportEnrichmentService";
import {DomainError} from "../errors/DomainError";

/**
 * Built lazily, on the first request, rather than at module load: this
 * controller is required (via Routes.ts) from inside AppService's own
 * constructor chain, before `export const appService = new AppService()`
 * at the bottom of AppService.ts has run - calling
 * `appService.getMaxImportFileSizeMb()` at the top level here would hit it
 * while still `undefined`. By request time the whole module graph (and
 * `appService`) is long since ready.
 */
let uploadCsvMiddleware: RequestHandler | null = null;

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

export function downloadTemplate(req: Request, res: Response): void {
    const origin = String(req.params.origin ?? "").trim().toLowerCase();

    try {
        const template = ImportService.getTemplate(origin);
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

export async function importLibrary(req: Request, res: Response): Promise<void> {
    if (!req.file) {
        res.status(400).json({error: "No CSV file provided"});
        return;
    }

    const origin = String(req.body.origin ?? "").trim().toLowerCase();

    let books;
    try {
        books = ImportService.parseImportFile(origin, req.file.buffer.toString("utf-8"));
    } catch (err) {
        if (err instanceof DomainError) {
            appService.getLogger().debug(`Failed to parse ${origin} import file: ${err.message}`);
            res.status(err.httpStatus).json({error: err.message});
            return;
        }
        res.status(500).json({error: "Internal Server Error"});
        return;
    }

    const userId = appService.getSessionUser(req);
    const pool = appService.getDatabasePool();

    const {result, importedIds} = await ImportService.importBooks(pool, userId, books);

    res.status(200).json(result);
    ImportEnrichmentService.scheduleEnrichment(
        pool,
        userId,
        importedIds,
        appService.getGoogleApiKey(),
        appService.getLibraryThingApiKey()
    );
}
