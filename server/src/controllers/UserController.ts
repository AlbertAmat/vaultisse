import {Pool} from "pg";
import {Request, Response} from "express";
import {appService} from "../AppService";
import {DomainError, NotFoundError, UnauthorizedError, ValidationError} from "../errors/DomainError";
import {DEV_SESSION_KEY} from "../middlewares/AuthMiddleware";
import {SessionCookie} from "../utils/SessionCookie";
import {UserService, WeakPasswordError} from "../services/UserService";

/** Thin HTTP<->service glue for the User resource. Constructed once per process (see UserRoute.ts) and reused across requests. */
export class UserController {
    /**
     * @param pool Database connection pool, forwarded to a fresh UserService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * POST /user/image - uploads the caller's profile image.
     * @param req Express request.
     * @param res Express response.
     */
    public async uploadImage(req: Request, res: Response): Promise<void> {
        try {
            if (!req.file) {
                res.status(400).json({error: "No PNG file uploaded"});
                return;
            }

            await new UserService(this.pool).updateImage(appService.getSessionUser(req), req.file.buffer);
            res.status(200).json({message: "Image uploaded successfully"});
        } catch (err: any) {
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * DELETE /user/image - clears the caller's profile image.
     * @param req Express request.
     * @param res Express response.
     */
    public async removeImage(req: Request, res: Response): Promise<void> {
        try {
            await new UserService(this.pool).removeImage(appService.getSessionUser(req));
            res.status(200).json({message: "Image removed successfully"});
        } catch (err: any) {
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * PUT /user - updates the caller's profile fields.
     * @param req Express request.
     * @param res Express response.
     */
    public async updateProfile(req: Request, res: Response): Promise<void> {
        try {
            const {name, email, language, region} = req.body;
            await new UserService(this.pool).updateProfile(appService.getSessionUser(req), {name, email, language, region});
            res.status(200).json({message: "User updated successfully"});
        } catch (err: any) {
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * PATCH /user/theme - updates the caller's UI theme preference.
     * @param req Express request.
     * @param res Express response.
     */
    public async updateTheme(req: Request, res: Response): Promise<void> {
        try {
            await new UserService(this.pool).updateTheme(appService.getSessionUser(req), req.body.theme);
            res.status(200).json({message: "Theme updated successfully"});
        } catch (err: any) {
            if (err instanceof ValidationError) {
                res.status(err.httpStatus).json({error: err.message});
                return;
            }
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * PATCH /user/sidebar-rail - updates the caller's sidebar-rail preference.
     * @param req Express request.
     * @param res Express response.
     */
    public async updateSidebarRail(req: Request, res: Response): Promise<void> {
        try {
            await new UserService(this.pool).updateSidebarRail(appService.getSessionUser(req), req.body.sidebarRail);
            res.status(200).json({message: "Sidebar preference updated successfully"});
        } catch (err: any) {
            if (err instanceof ValidationError) {
                res.status(err.httpStatus).json({error: err.message});
                return;
            }
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * PATCH /user/leasing - updates the caller's leasing-enabled preference.
     * @param req Express request.
     * @param res Express response.
     */
    public async updateLeasing(req: Request, res: Response): Promise<void> {
        try {
            await new UserService(this.pool).updateLeasing(appService.getSessionUser(req), req.body.leasingEnabled);
            res.status(200).json({message: "Leasing preference updated successfully"});
        } catch (err: any) {
            if (err instanceof ValidationError) {
                res.status(err.httpStatus).json({error: err.message});
                return;
            }
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * DELETE /user - deletes the caller's account after re-verifying their password.
     * @param req Express request.
     * @param res Express response.
     */
    public async deleteAccount(req: Request, res: Response): Promise<void> {
        const {password} = req.body;
        if (!password) {
            res.status(400).json({message: "Missing password"});
            return;
        }

        try {
            await new UserService(this.pool).deleteAccount(appService.getSessionUser(req), password);
            res.redirect("/login"); // Redirect to login page if user is not logged in
        } catch (err: any) {
            if (err instanceof UnauthorizedError) {
                res.status(err.httpStatus).json({message: err.message});
                return;
            }
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * POST /user/password - changes the caller's password and reissues their session token.
     * @param req Express request.
     * @param res Express response.
     */
    public async changePassword(req: Request, res: Response): Promise<void> {
        const {currentPassword, newPassword} = req.body;

        try {
            const {newToken} = await new UserService(this.pool).changePassword(
                appService.getSessionUser(req),
                currentPassword,
                newPassword,
                req.sessionId,
                req.sessionKey ?? DEV_SESSION_KEY,
                req.ip
            );

            // Reuses the same session_key (req.sessionKey) so this device's
            // user_sessions row - deliberately left un-revoked - still matches
            // the reissued token's `sid` claim.
            SessionCookie.setSessionCookie(res, newToken);

            res.json({success: true, message: "Password updated successfully"});
        } catch (err: any) {
            if (err instanceof WeakPasswordError) {
                res.status(err.httpStatus).json({success: false, message: err.message, missing: err.missing});
                return;
            }
            if (err instanceof UnauthorizedError) {
                res.status(err.httpStatus).json({message: err.message});
                return;
            }
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * GET /user/sessions - lists the caller's active sessions.
     * @param req Express request.
     * @param res Express response.
     */
    public async listSessions(req: Request, res: Response): Promise<void> {
        if (process.env.DEMO_MODE === "true") {
            res.status(200).json([]);
            return;
        }

        try {
            const sessions = await new UserService(this.pool).listSessions(appService.getSessionUser(req), req.sessionId);
            res.status(200).json(sessions);
        } catch (err: any) {
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * DELETE /user/sessions/:id - revokes one of the caller's own sessions.
     * @param req Express request.
     * @param res Express response.
     */
    public async revokeSession(req: Request, res: Response): Promise<void> {
        const sessionId = Number(req.params.id);
        if (!Number.isInteger(sessionId)) {
            res.status(400).json({error: "Invalid session id"});
            return;
        }

        try {
            await new UserService(this.pool).revokeSession(appService.getSessionUser(req), sessionId, req.ip);

            if (sessionId === req.sessionId) {
                SessionCookie.clearSessionCookie(res);
            }

            res.status(200).json({message: "Session revoked successfully"});
        } catch (err: any) {
            if (err instanceof NotFoundError) {
                res.status(err.httpStatus).json({error: err.message});
                return;
            }
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * GET /user/activity - lists the caller's recent auth activity.
     * @param req Express request.
     * @param res Express response.
     */
    public async listActivity(req: Request, res: Response): Promise<void> {
        if (process.env.DEMO_MODE === "true") {
            res.status(200).json([]);
            return;
        }

        try {
            const limit = Number(req.query.limit) || 20;
            const activity = await new UserService(this.pool).listActivity(appService.getSessionUser(req), limit);
            res.status(200).json(activity);
        } catch (err: any) {
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * POST /user/security-notice/accept - records explicit acceptance of the security notice.
     * @param req Express request.
     * @param res Express response.
     */
    public async acceptSecurityNotice(req: Request, res: Response): Promise<void> {
        try {
            await new UserService(this.pool).acceptSecurityNotice(appService.getSessionUser(req));
            res.status(200).json({message: "Security notice accepted"});
        } catch (err: any) {
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * POST /user/terms-of-service/accept - records explicit acceptance of the Terms of Service.
     * @param req Express request.
     * @param res Express response.
     */
    public async acceptTermsOfService(req: Request, res: Response): Promise<void> {
        try {
            await new UserService(this.pool).acceptTermsOfService(appService.getSessionUser(req));
            res.status(200).json({message: "Terms of service accepted"});
        } catch (err: any) {
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * POST /user/2fa/setup - starts (or restarts) two-factor auth setup.
     * @param req Express request.
     * @param res Express response.
     */
    public async setupTwoFactor(req: Request, res: Response): Promise<void> {
        try {
            const setup = await new UserService(this.pool).setupTwoFactor(appService.getSessionUser(req));
            res.status(200).json(setup);
        } catch (err: any) {
            if (err instanceof NotFoundError) {
                res.status(err.httpStatus).json({message: err.message});
                return;
            }
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * POST /user/2fa/enable - confirms setup and turns two-factor auth on.
     * @param req Express request.
     * @param res Express response.
     */
    public async enableTwoFactor(req: Request, res: Response): Promise<void> {
        const {code} = req.body;
        if (!code) {
            res.status(400).json({message: "Missing verification code"});
            return;
        }

        try {
            const backupCodes = await new UserService(this.pool).enableTwoFactor(appService.getSessionUser(req), code);
            res.status(200).json({success: true, backupCodes});
        } catch (err: any) {
            if (err instanceof DomainError) {
                res.status(err.httpStatus).json({message: err.message});
                return;
            }
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }

    /**
     * POST /user/2fa/disable - turns two-factor auth off after re-verifying the caller's password.
     * @param req Express request.
     * @param res Express response.
     */
    public async disableTwoFactor(req: Request, res: Response): Promise<void> {
        const {password} = req.body;
        if (!password) {
            res.status(400).json({message: "Missing password"});
            return;
        }

        try {
            await new UserService(this.pool).disableTwoFactor(appService.getSessionUser(req), password);
            res.status(200).json({success: true, message: "Two-factor authentication disabled"});
        } catch (err: any) {
            if (err instanceof UnauthorizedError) {
                res.status(err.httpStatus).json({message: err.message});
                return;
            }
            console.error("Error executing query", err.stack);
            res.status(500).send("Internal Server Error");
        }
    }
}
