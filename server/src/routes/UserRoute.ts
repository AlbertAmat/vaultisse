/**
 * =============================================================================
 * UserRoute
 * =============================================================================
 * Mounted at `/api/rest/user`. Self-service account management for the
 * currently logged-in user: profile picture, profile fields, password
 * change, two-factor auth setup/enable/disable, and account deletion. All
 * routes require auth and act on the caller's own account only (id taken
 * from the session, never from params). See UserController/UserService/
 * UserRepository (+ UserSessionRepository, ActivityLogRepository) for the
 * actual request handling, business rules, and SQL respectively.
 */
import {Request, Response, Router} from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";
import multer from "multer";
import rateLimit from "express-rate-limit";
import {handleUploadError} from "../middlewares/UploadErrorMiddleware";
import {UserController} from "../controllers/UserController";
import {lazy} from "./lazySingleton";

const router = Router();
const getUserController = lazy(() => new UserController(appService.getDatabasePool()));

// Strict limiter for the current-password check, same shape as the
// login/register limiter - without it, a stolen/short-lived session token
// could be used to brute-force the account's current password.
const passwordChangeLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5,
    message: "Too many attempts, please try again later.",
});

// Same shape, dedicated to the 2FA enable code check - a stolen session
// token shouldn't be able to brute-force a 6-digit TOTP code either.
const twoFaLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5,
    message: "Too many attempts, please try again later.",
});

// Multer setup - store in memory
const storage = multer.memoryStorage();
const maxProfileImageSizeMb = 2;
const upload = multer({
    storage,
    limits: {fileSize: maxProfileImageSizeMb * 1024 * 1024},
    fileFilter: (req: Request, file: Express.Multer.File, cb: (error: any, acceptFile: boolean) => void) => {
        // @ts-ignore
        if (file.mimetype !== "image/png" && file.mimetype !== "image/jpeg") {
            return cb(new Error("Only PNG or JPG images are allowed"), false);
        }
        cb(null, true);
    }
});

router.post("/image", requireAuth, upload.single("image"), handleUploadError(maxProfileImageSizeMb, "json"), (req: Request, res: Response) => getUserController().uploadImage(req, res));
router.delete("/image", requireAuth, (req, res) => getUserController().removeImage(req, res));
router.put("", requireAuth, (req, res) => getUserController().updateProfile(req, res));
router.patch("/theme", requireAuth, (req, res) => getUserController().updateTheme(req, res));
router.patch("/sidebar-rail", requireAuth, (req, res) => getUserController().updateSidebarRail(req, res));
router.patch("/leasing", requireAuth, (req, res) => getUserController().updateLeasing(req, res));
router.delete("", requireAuth, passwordChangeLimiter, (req, res) => getUserController().deleteAccount(req, res));
router.post("/password", requireAuth, passwordChangeLimiter, (req, res) => getUserController().changePassword(req, res));
router.get("/sessions", requireAuth, (req, res) => getUserController().listSessions(req, res));
router.delete("/sessions/:id", requireAuth, (req, res) => getUserController().revokeSession(req, res));
router.get("/activity", requireAuth, (req, res) => getUserController().listActivity(req, res));
router.post("/security-notice/accept", requireAuth, (req, res) => getUserController().acceptSecurityNotice(req, res));
router.post("/terms-of-service/accept", requireAuth, (req, res) => getUserController().acceptTermsOfService(req, res));
router.post("/2fa/setup", requireAuth, (req, res) => getUserController().setupTwoFactor(req, res));
router.post("/2fa/enable", requireAuth, twoFaLimiter, (req: Request, res) => getUserController().enableTwoFactor(req, res));
router.post("/2fa/disable", requireAuth, passwordChangeLimiter, (req, res) => getUserController().disableTwoFactor(req, res));

export default router;
