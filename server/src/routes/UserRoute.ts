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
import {Request, Router} from 'express';
import {requireAuth} from "../middlewares/AuthMiddleware";
import multer from "multer";
import rateLimit from "express-rate-limit";
import {handleUploadError} from "../middlewares/UploadErrorMiddleware";
import * as UserController from "../controllers/UserController";

const router = Router();

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

router.post("/image", requireAuth, upload.single("image"), handleUploadError(maxProfileImageSizeMb, "json"), UserController.uploadImage);
router.delete("/image", requireAuth, UserController.removeImage);
router.put("", requireAuth, UserController.updateProfile);
router.patch("/theme", requireAuth, UserController.updateTheme);
router.patch("/sidebar-rail", requireAuth, UserController.updateSidebarRail);
router.patch("/leasing", requireAuth, UserController.updateLeasing);
router.delete("", requireAuth, passwordChangeLimiter, UserController.deleteAccount);
router.post("/password", requireAuth, passwordChangeLimiter, UserController.changePassword);
router.get("/sessions", requireAuth, UserController.listSessions);
router.delete("/sessions/:id", requireAuth, UserController.revokeSession);
router.get("/activity", requireAuth, UserController.listActivity);
router.post("/security-notice/accept", requireAuth, UserController.acceptSecurityNotice);
router.post("/terms-of-service/accept", requireAuth, UserController.acceptTermsOfService);
router.post("/2fa/setup", requireAuth, UserController.setupTwoFactor);
router.post("/2fa/enable", requireAuth, twoFaLimiter, UserController.enableTwoFactor);
router.post("/2fa/disable", requireAuth, passwordChangeLimiter, UserController.disableTwoFactor);

export default router;
