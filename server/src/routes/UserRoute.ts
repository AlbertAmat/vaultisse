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

/**
 * POST /user/image
 * ------------------
 * Upload/replace the current user's profile picture.
 *
 * Auth: required. Body: multipart/form-data, field `image` (PNG/JPEG, max 2MB).
 * Stored as raw bytes in `users.image` (converted to a base64 data: URL on read).
 *
 * Example request (curl): curl -X POST /api/rest/user/image -F "image=@avatar.png"
 *
 * Example response (200): { "message": "Image uploaded successfully" }
 * Responses: 200 success | 400 { "error": "No PNG file uploaded" } |
 *            413 { "error": "File exceeds the maximum allowed upload size of 2MB" }.
 */
router.post("/image", requireAuth, upload.single("image"), handleUploadError(maxProfileImageSizeMb, "json"), (req: Request, res: Response) => getUserController().uploadImage(req, res));

/**
 * DELETE /user/image
 * ---------------------
 * Remove the current user's profile picture (sets `users.image` to NULL).
 *
 * Auth: required.
 *
 * Example response (200): { "message": "Image removed successfully" }
 */
router.delete("/image", requireAuth, (req, res) => getUserController().removeImage(req, res));

/**
 * PUT /user
 * ----------
 * Update the current user's profile fields.
 *
 * Auth: required. Body: { "name": "Jane Doe", "email": "jane@example.com", "language": "en", "region": "US" }
 *
 * Example response (200): { "message": "User updated successfully" }
 */
router.put("", requireAuth, (req, res) => getUserController().updateProfile(req, res));

/**
 * PATCH /user/theme
 * -------------------
 * Update the current user's UI theme preference ("beige" or "library"), persisted so it's restored
 * on next login (applied immediately client-side for instant feedback).
 *
 * Auth: required. Body: { "theme": "beige" | "library" }
 *
 * Example response (200): { "message": "Theme updated successfully" }
 * Responses: 200 success | 400 { "error": "Invalid theme" }.
 */
router.patch("/theme", requireAuth, (req, res) => getUserController().updateTheme(req, res));

/**
 * PATCH /user/sidebar-rail
 * --------------------------
 * Update whether the current user's left nav collapses to icon-only "rail" mode (expanding on hover)
 * instead of staying fully expanded.
 *
 * Auth: required. Body: { "sidebarRail": true | false }
 *
 * Example response (200): { "message": "Sidebar preference updated successfully" }
 * Responses: 200 success | 400 { "error": "Invalid sidebarRail" }.
 */
router.patch("/sidebar-rail", requireAuth, (req, res) => getUserController().updateSidebarRail(req, res));

/**
 * PATCH /user/leasing
 * ----------------------
 * Update whether the current user's Loans and Customers pages (and their nav items) are shown - off
 * by default, since most accounts just track a personal collection and don't lend books out.
 *
 * Auth: required. Body: { "leasingEnabled": true | false }
 *
 * Example response (200): { "message": "Leasing preference updated successfully" }
 * Responses: 200 success | 400 { "error": "Invalid leasingEnabled" }.
 */
router.patch("/leasing", requireAuth, (req, res) => getUserController().updateLeasing(req, res));

/**
 * DELETE /user
 * -------------
 * Permanently delete the current user's account (and, via DB foreign keys, all of their
 * books/locations/customers/etc.), then redirect to `/login`.
 *
 * Rate limited: 5 requests / 5 minutes (see `passwordChangeLimiter`), same as password change and
 * 2FA-disable - all three require re-entering the current password before acting on a stolen/short-lived
 * session cookie.
 * Auth: required. Body: { "password": "S3cret!123" }
 *
 * Response: 302 redirect to `/login` on success.
 * Responses: 400 { "message": "Missing password" } | 401 { "message": "Invalid password." }.
 */
router.delete("", requireAuth, passwordChangeLimiter, (req, res) => getUserController().deleteAccount(req, res));

/**
 * POST /user/password
 * ----------------------
 * Change the current user's password.
 *
 * Rate limited: 5 requests / 5 minutes (see `passwordChangeLimiter`), to prevent using a stolen session
 * token to brute-force the current password.
 * Auth: required. Body: { "currentPassword": "OldS3cret!", "newPassword": "NewS3cret!456" }
 * (`newPassword` needs 8+ chars, an uppercase letter, a digit, a special char).
 *
 * On success, `users.token_version` is incremented (invalidating every other previously issued session
 * token for this user), every other `user_sessions` row is explicitly revoked, and a fresh token for
 * *this* session is issued immediately, so the caller isn't logged out.
 *
 * Example response (200): { "success": true, "message": "Password updated successfully" }
 * Responses: 200 success | 400 { "success": false, "message": "...", "missing": [...] } (weak password) |
 *            401 { "message": "Invalid current password." }.
 */
router.post("/password", requireAuth, passwordChangeLimiter, (req, res) => getUserController().changePassword(req, res));

/**
 * GET /user/sessions
 * ---------------------
 * List the current user's active login sessions, for Settings > Security's "Active sessions" list.
 * "Active" means not explicitly revoked (logout, "log out this device", or a password change) and seen
 * within the current session lifetime, so a session whose JWT simply expired naturally drops off.
 *
 * Auth: required. In DEMO_MODE, always returns [] rather than real session/IP data for the demo account.
 *
 * Example response (200):
 *  [{ "id": 12, "userAgent": "Mozilla/5.0 (...) Chrome/128.0", "ipAddress": "203.0.113.4",
 *     "createdDate": "2026-09-01T10:00:00.000Z", "lastSeenDate": "2026-09-03T18:05:00.000Z",
 *     "isCurrent": true }]
 */
router.get("/sessions", requireAuth, (req, res) => getUserController().listSessions(req, res));

/**
 * DELETE /user/sessions/:id
 * ----------------------------
 * Revoke one of the current user's own sessions ("Log out" next to a device in Settings > Active sessions).
 * Scoped to the caller's own sessions only. Revoking the *current* session also clears the caller's own
 * cookie, so the browser doesn't keep sending a token `requireAuth` would now reject.
 *
 * Auth: required.
 *
 * Example response (200): { "message": "Session revoked successfully" }
 * Responses: 200 success | 400 { "error": "Invalid session id" } | 404 { "error": "Session not found" }.
 */
router.delete("/sessions/:id", requireAuth, (req, res) => getUserController().revokeSession(req, res));

/**
 * GET /user/activity
 * ---------------------
 * List the current user's recent auth activity (sign-ins, failed sign-ins, sign-outs, password changes),
 * for Settings > Security's "Recent logins" list. Scoped to auth events only.
 *
 * Auth: required. Query: `?limit=20` (default 20, capped at 50). In DEMO_MODE, always returns [] rather
 * than real login/IP history for the demo account.
 *
 * Example response (200):
 *  [{ "id": 42, "action": "login", "metadata": { "ip": "203.0.113.4" },
 *     "createdDate": "2026-09-03T18:05:00.000Z" }]
 */
router.get("/activity", requireAuth, (req, res) => getUserController().listActivity(req, res));

/**
 * POST /user/security-notice/accept
 * ------------------------------------
 * Acknowledge the security-measures notice shown after login to accounts flagged as a public institution
 * (see `GET /app/policy`'s `user.securityNoticeAccepted`).
 *
 * Auth: required. Idempotent - accepting more than once just refreshes the acceptance timestamp.
 *
 * Example response (200): { "message": "Security notice accepted" }
 */
router.post("/security-notice/accept", requireAuth, (req, res) => getUserController().acceptSecurityNotice(req, res));

/**
 * POST /user/terms-of-service/accept
 * -------------------------------------
 * Accept the Terms of Service, required from every account on first login (see `GET /app/policy`'s
 * `user.termsOfServiceAccepted`).
 *
 * Auth: required. Idempotent - accepting more than once just refreshes the acceptance timestamp.
 *
 * Example response (200): { "message": "Terms of service accepted" }
 */
router.post("/terms-of-service/accept", requireAuth, (req, res) => getUserController().acceptTermsOfService(req, res));

/**
 * POST /user/2fa/setup
 * ----------------------
 * Start (or restart) two-factor auth setup: generates a new TOTP secret, stores it on the account
 * (leaving `totp_enabled` untouched), and returns it plus a scannable QR code. Calling this again
 * before enabling discards whatever secret was generated by a previous call.
 *
 * Auth: required.
 *
 * Example response (200): { "secret": "JBSWY3DPEHPK3PXP", "qrCodeDataUrl": "data:image/png;base64,..." }
 */
router.post("/2fa/setup", requireAuth, (req, res) => getUserController().setupTwoFactor(req, res));

/**
 * POST /user/2fa/enable
 * ------------------------
 * Confirm setup and turn two-factor auth on: verifies a code against the secret stored by
 * `POST /user/2fa/setup`, then flips `totp_enabled` and generates a fresh set of one-time backup codes
 * (any previous set is discarded).
 *
 * Rate limited: 5 requests / 5 minutes (see `twoFaLimiter`).
 * Auth: required. Body: { "code": "123456" }
 *
 * Example response (200): { "success": true, "backupCodes": ["A1B2C3D4-E5F6G7H8", ...] }
 * (shown to the user exactly once - only hashes are stored).
 * Responses: 200 success | 400 { "message": "..." } (no pending setup) | 401 { "message": "Invalid verification code." }.
 */
router.post("/2fa/enable", requireAuth, twoFaLimiter, (req: Request, res) => getUserController().enableTwoFactor(req, res));

/**
 * POST /user/2fa/disable
 * -------------------------
 * Turn two-factor auth off: requires the account password (not the TOTP code) as re-auth, since this
 * removes a security layer rather than adding one. Clears the stored secret and every backup code.
 *
 * Rate limited: 5 requests / 5 minutes (see `passwordChangeLimiter`).
 * Auth: required. Body: { "password": "S3cret!123" }
 *
 * Example response (200): { "success": true, "message": "Two-factor authentication disabled" }
 * Responses: 200 success | 401 { "message": "Invalid password." }.
 */
router.post("/2fa/disable", requireAuth, passwordChangeLimiter, (req, res) => getUserController().disableTwoFactor(req, res));

export default router;
