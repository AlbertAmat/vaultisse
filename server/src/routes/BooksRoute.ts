/**
 * =============================================================================
 * BooksRoute
 * =============================================================================
 * Mounted at `/api/rest/book` (see server/src/routes/Routes.ts).
 *
 * Owns everything related to a user's book catalog:
 *  - searching/listing/reading/updating/deleting `books`
 *  - creating books either manually or automatically from an ISBN lookup
 *    (Open Library, optional Google Books, Wikipedia, ISBN store fallback)
 *  - managing physical copies of a book ("book stocks": add/update/remove,
 *    and bulk "return" of loaned/sold copies)
 *
 * Every route in this file requires a valid session - see `requireAuth` in
 * server/src/middlewares/AuthMiddleware.ts. All queries are additionally
 * scoped by `user_id` so one user can never read/modify another user's data.
 *
 * See BookController/BookService/BookRepository (+ BookMetadataRepository
 * for the external ISBN lookup) for the actual request handling, business
 * rules, and SQL/external-API access respectively.
 */
import {Request, Response, Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import {handleUploadError} from "../middlewares/UploadErrorMiddleware";
import {BookController, upload, fileUpload, maxCoverImageSizeMb, maxEbookFileSizeMb} from "../controllers/BookController";
import {lazy} from "./lazySingleton";

const router: Router = Router();
const getBookController = lazy(() => new BookController(appService.getDatabasePool()));

router.get('/search', requireAuth, (req, res) => getBookController().search(req, res));
router.get('/counters', requireAuth, (req, res) => getBookController().counters(req, res));
router.get('/:id', requireAuth, (req, res) => getBookController().getById(req, res));
router.put('/:id', requireAuth, (req, res) => getBookController().update(req, res));
router.delete('/:id', requireAuth, (req, res) => getBookController().remove(req, res));
router.post('/:id/image', requireAuth, upload.single("image"), handleUploadError(maxCoverImageSizeMb), (req: Request, res: Response) => getBookController().updateImage(req, res));
router.post('/:id/cover/find', requireAuth, (req, res) => getBookController().findCover(req, res));
router.post('/:id/file', requireAuth, fileUpload.single("file"), handleUploadError(maxEbookFileSizeMb), (req: Request, res: Response) => getBookController().uploadFile(req, res));
router.get('/:id/file/:fileId/download', requireAuth, (req, res) => getBookController().downloadFile(req, res));
router.delete('/:id/file/:fileId', requireAuth, (req, res) => getBookController().deleteFile(req, res));
router.post('', requireAuth, upload.single("image"), handleUploadError(maxCoverImageSizeMb), (req: Request, res: Response) => getBookController().create(req, res));
router.post('/isbn/:isbn', requireAuth, (req, res) => getBookController().createFromIsbn(req, res));
router.post('/:id/stock', requireAuth, (req, res) => getBookController().addStock(req, res));
router.delete('/:id/stock/:stock_id', requireAuth, (req, res) => getBookController().deleteStock(req, res));
router.put('/:id/stock/:stock_id', requireAuth, (req, res) => getBookController().updateStock(req, res));
router.get('/:bookCode/add/md', requireAuth, (req, res) => getBookController().getAddMetadata(req, res));
router.post('/return', requireAuth, upload.single("image"), handleUploadError(maxCoverImageSizeMb), (req: Request, res: Response) => getBookController().bulkReturn(req, res));

export default router;
