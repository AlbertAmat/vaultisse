/**
 * =============================================================================
 * OpdsRoute
 * =============================================================================
 * Mounted at `/opds` (not under `/api/rest`, and not behind `requireAuth`:
 * OPDS readers such as KOReader can't use the session cookie, and 2FA/OIDC
 * accounts have no password to give them). Instead the URL itself carries a
 * per-user secret token, `/opds/<token>/...`, created from Settings via
 * `POST /api/rest/user/opds` (see UserRoute.ts) and revocable at any time.
 * Read-only: lists the token owner's active vault's books that have an
 * ebook file, with download links, as OPDS 1.2 (Atom) at the root and OPDS 2.0 (JSON) under `/v2`. See OpdsController/OpdsService/OpdsRepository.
 */
import {Router} from "express";
import {appService} from "../AppService";
import {OpdsController} from "../controllers/OpdsController";
import {lazy} from "./lazySingleton";

const router = Router();
const getOpdsController = lazy(() => new OpdsController(appService.getDatabasePool()));

/** GET /opds/:token - root navigation feed (OPDS 1.2 Atom). 401 for an unknown token. */
router.get("/:token", (req, res) => getOpdsController().root(req, res));

/** GET /opds/:token/opensearch.xml - OpenSearch description for client-side search. */
router.get("/:token/opensearch.xml", (req, res) => getOpdsController().openSearch(req, res));

/** GET /opds/:token/all?q=<text>&page=<n> - acquisition feed, 50 books per page, optionally filtered by title/author/ISBN. */
router.get("/:token/all", (req, res) => getOpdsController().all(req, res));

/** GET /opds/:token/v2 - OPDS 2.0 (JSON, application/opds+json) root feed. */
router.get("/:token/v2", (req, res) => getOpdsController().rootV2(req, res));

/** GET /opds/:token/v2/all?q=<text>&page=<n> - OPDS 2.0 books feed; same paging/search as the 1.x /all. */
router.get("/:token/v2/all", (req, res) => getOpdsController().allV2(req, res));

/** GET /opds/:token/book/:id/file/:fileId - the raw ebook file. 404 if it isn't in the token owner's vault. */
router.get("/:token/book/:id/file/:fileId", (req, res) => getOpdsController().download(req, res));

export default router;
