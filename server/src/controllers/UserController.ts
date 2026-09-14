import {Request, Response} from "express";
import {appService} from "../AppService";
import {DomainError, NotFoundError, UnauthorizedError, ValidationError} from "../errors/DomainError";
import {DEV_SESSION_KEY} from "../middlewares/AuthMiddleware";
import {clearSessionCookie, setSessionCookie} from "../utils/SessionCookie";
import * as UserService from "../services/UserService";
import {WeakPasswordError} from "../services/UserService";

export async function uploadImage(req: Request, res: Response): Promise<void> {
    try {
        if (!req.file) {
            res.status(400).json({error: "No PNG file uploaded"});
            return;
        }

        await UserService.updateImage(appService.getDatabasePool(), appService.getSessionUser(req), req.file.buffer);
        res.status(200).json({message: "Image uploaded successfully"});
    } catch (err: any) {
        console.error("Error executing query", err.stack);
        res.status(500).send("Internal Server Error");
    }
}

export async function removeImage(req: Request, res: Response): Promise<void> {
    try {
        await UserService.removeImage(appService.getDatabasePool(), appService.getSessionUser(req));
        res.status(200).json({message: "Image removed successfully"});
    } catch (err: any) {
        console.error("Error executing query", err.stack);
        res.status(500).send("Internal Server Error");
    }
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
    try {
        const {name, email, language, region} = req.body;
        await UserService.updateProfile(appService.getDatabasePool(), appService.getSessionUser(req), {name, email, language, region});
        res.status(200).json({message: "User updated successfully"});
    } catch (err: any) {
        console.error("Error executing query", err.stack);
        res.status(500).send("Internal Server Error");
    }
}

export async function updateTheme(req: Request, res: Response): Promise<void> {
    try {
        await UserService.updateTheme(appService.getDatabasePool(), appService.getSessionUser(req), req.body.theme);
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

export async function updateSidebarRail(req: Request, res: Response): Promise<void> {
    try {
        await UserService.updateSidebarRail(appService.getDatabasePool(), appService.getSessionUser(req), req.body.sidebarRail);
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

export async function updateLeasing(req: Request, res: Response): Promise<void> {
    try {
        await UserService.updateLeasing(appService.getDatabasePool(), appService.getSessionUser(req), req.body.leasingEnabled);
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

export async function deleteAccount(req: Request, res: Response): Promise<void> {
    const {password} = req.body;
    if (!password) {
        res.status(400).json({message: "Missing password"});
        return;
    }

    try {
        await UserService.deleteAccount(appService.getDatabasePool(), appService.getSessionUser(req), password);
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

export async function changePassword(req: Request, res: Response): Promise<void> {
    const {currentPassword, newPassword} = req.body;

    try {
        const {newToken} = await UserService.changePassword(
            appService.getDatabasePool(),
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
        setSessionCookie(res, newToken);

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

export async function listSessions(req: Request, res: Response): Promise<void> {
    if (process.env.DEMO_MODE === "true") {
        res.status(200).json([]);
        return;
    }

    try {
        const sessions = await UserService.listSessions(appService.getDatabasePool(), appService.getSessionUser(req), req.sessionId);
        res.status(200).json(sessions);
    } catch (err: any) {
        console.error("Error executing query", err.stack);
        res.status(500).send("Internal Server Error");
    }
}

export async function revokeSession(req: Request, res: Response): Promise<void> {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId)) {
        res.status(400).json({error: "Invalid session id"});
        return;
    }

    try {
        await UserService.revokeSession(appService.getDatabasePool(), appService.getSessionUser(req), sessionId, req.ip);

        if (sessionId === req.sessionId) {
            clearSessionCookie(res);
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

export async function listActivity(req: Request, res: Response): Promise<void> {
    if (process.env.DEMO_MODE === "true") {
        res.status(200).json([]);
        return;
    }

    try {
        const limit = Number(req.query.limit) || 20;
        const activity = await UserService.listActivity(appService.getDatabasePool(), appService.getSessionUser(req), limit);
        res.status(200).json(activity);
    } catch (err: any) {
        console.error("Error executing query", err.stack);
        res.status(500).send("Internal Server Error");
    }
}

export async function acceptSecurityNotice(req: Request, res: Response): Promise<void> {
    try {
        await UserService.acceptSecurityNotice(appService.getDatabasePool(), appService.getSessionUser(req));
        res.status(200).json({message: "Security notice accepted"});
    } catch (err: any) {
        console.error("Error executing query", err.stack);
        res.status(500).send("Internal Server Error");
    }
}

export async function acceptTermsOfService(req: Request, res: Response): Promise<void> {
    try {
        await UserService.acceptTermsOfService(appService.getDatabasePool(), appService.getSessionUser(req));
        res.status(200).json({message: "Terms of service accepted"});
    } catch (err: any) {
        console.error("Error executing query", err.stack);
        res.status(500).send("Internal Server Error");
    }
}

export async function setupTwoFactor(req: Request, res: Response): Promise<void> {
    try {
        const setup = await UserService.setupTwoFactor(appService.getDatabasePool(), appService.getSessionUser(req));
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

export async function enableTwoFactor(req: Request, res: Response): Promise<void> {
    const {code} = req.body;
    if (!code) {
        res.status(400).json({message: "Missing verification code"});
        return;
    }

    try {
        const backupCodes = await UserService.enableTwoFactor(appService.getDatabasePool(), appService.getSessionUser(req), code);
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

export async function disableTwoFactor(req: Request, res: Response): Promise<void> {
    const {password} = req.body;
    if (!password) {
        res.status(400).json({message: "Missing password"});
        return;
    }

    try {
        await UserService.disableTwoFactor(appService.getDatabasePool(), appService.getSessionUser(req), password);
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
