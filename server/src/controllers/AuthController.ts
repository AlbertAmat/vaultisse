import {Request, Response} from "express";
import path from "path";
import {appService} from "../AppService";
import * as AuthService from "../services/AuthService";
import {PendingLoginExpiredError} from "../services/AuthService";
import {UnauthorizedError, ValidationError} from "../errors/DomainError";
import {OIDC_PENDING_COOKIE} from "../repositories/OidcRepository";
import {
    clearOidcPendingCookie,
    clearPending2faCookie,
    clearSessionCookie,
    setOidcPendingCookie,
    setPending2faCookie,
    setSessionCookie,
} from "../utils/SessionCookie";

// Compiled Vue app: alongside the server in production (Docker image),
// under client/dist during local development.
export const clientDistPath = process.env.NODE_ENV === "production" ? path.join(__dirname, "../../../client") : path.join(__dirname, '../../../client/dist')

export async function serveApp(req: Request, res: Response): Promise<void> {
    const appPath = path.join(clientDistPath, "index.html");
    appService.getLogger().debug(`serving ${req.path} index: ${appPath}`);
    res.sendFile(appPath);
}

export function redirectRoot(req: Request, res: Response): void {
    // @ts-ignore
    if (req.cookies.token) {
        appService.getLogger().debug("User already logged in, redirecting to /app...");
        res.redirect("/app");
        return;
    }
    appService.getLogger().debug("User not logged in, redirecting to /login...");
    res.redirect("/login");
}

export function showLogin(req: Request, res: Response): void {
    // If user goes to login page, clear the current token.
    // we can improve it, by checking if the token is valid, etc ad redirect to app
    // at the moment, we will clear the token
    clearSessionCookie(res);
    clearPending2faCookie(res);
    clearOidcPendingCookie(res);
    res.sendFile(path.join(__dirname, "..", "assets", "login.html"));
}

export async function login(req: Request, res: Response): Promise<void> {
    appService.getLogger().debug("Handle login authentication");
    const username = typeof req.body.username === "string" ? req.body.username.trim() : req.body.username;
    const {password} = req.body;
    if (!username || !password) {
        res.status(400).json({message: "Missing username or password"});
        return;
    }

    try {
        const outcome = await AuthService.login(appService.getDatabasePool(), username, password, req.get("user-agent"), req.ip);

        if (outcome.kind === "twoFactorRequired") {
            setPending2faCookie(res, outcome.pendingToken);
            res.json({success: true, twoFactorRequired: true, message: "Enter your verification code"});
            return;
        }

        setSessionCookie(res, outcome.token);
        res.json({success: true, message: "Login successful", redirectUrl: "/app"});
    } catch (err) {
        if (err instanceof UnauthorizedError) {
            res.status(err.httpStatus).json({message: err.message});
            return;
        }
        console.error("Login error:", err);
        res.status(500).json({message: "Internal server error"});
    }
}

export async function loginTwoFactor(req: Request, res: Response): Promise<void> {
    const {code} = req.body;
    // @ts-ignore
    const pendingToken = req.cookies.pending_2fa_token;

    if (!code) {
        res.status(400).json({message: "Missing verification code"});
        return;
    }

    try {
        const {token} = await AuthService.completeTwoFactorLogin(appService.getDatabasePool(), pendingToken, code, req.get("user-agent"), req.ip);

        clearPending2faCookie(res);
        setSessionCookie(res, token);
        res.json({success: true, message: "Login successful", redirectUrl: "/app"});
    } catch (err) {
        if (err instanceof PendingLoginExpiredError) {
            clearPending2faCookie(res);
            res.status(err.httpStatus).json({message: err.message});
            return;
        }
        if (err instanceof UnauthorizedError) {
            res.status(err.httpStatus).json({message: err.message});
            return;
        }
        console.error("2FA verification error:", err);
        res.status(500).json({message: "Internal server error"});
    }
}

export function oidcStatus(req: Request, res: Response): void {
    const config = appService.getOidcConfig();
    res.json({
        enabled: appService.isOidcEnabled(),
        label: config?.buttonLabel ?? "Sign in with SSO",
    });
}

export async function oidcStart(req: Request, res: Response): Promise<void> {
    if (!appService.isOidcEnabled()) {
        res.status(404).json({message: "SSO is not configured"});
        return;
    }

    try {
        const {url, pendingToken} = await AuthService.beginSso();
        clearSessionCookie(res);
        setOidcPendingCookie(res, pendingToken);
        res.redirect(url);
    } catch (error) {
        appService.getLogger().error("OIDC start failed: " + error);
        clearOidcPendingCookie(res);
        res.redirect("/login?error=sso");
    }
}

export async function oidcCallback(req: Request, res: Response): Promise<void> {
    const fail = () => {
        clearOidcPendingCookie(res);
        res.redirect("/login?error=sso");
    };

    if (!appService.isOidcEnabled()) {
        fail();
        return;
    }

    const queryVal = (name: string): string | undefined =>
        typeof req.query[name] === "string" ? req.query[name] as string : undefined;

    try {
        const {token} = await AuthService.completeSso(
            appService.getDatabasePool(),
            {
                code: queryVal("code"),
                state: queryVal("state"),
                error: queryVal("error"),
                error_description: queryVal("error_description"),
            },
            req.cookies[OIDC_PENDING_COOKIE],
            req.get("user-agent"),
            req.ip
        );

        clearOidcPendingCookie(res);
        setSessionCookie(res, token);
        res.redirect("/app");
    } catch (error) {
        appService.getLogger().error("OIDC callback failed: " + error);
        fail();
    }
}

export function showRegister(req: Request, res: Response): void {
    // @ts-ignore
    if (req.cookies.token) {
        res.redirect("/app");
        return;
    }
    res.sendFile(path.join(__dirname, "..", "assets", "register.html"));
}

export async function register(req: Request, res: Response): Promise<void> {
    const {password} = req.body;
    const userName = typeof req.body.userName === "string" ? req.body.userName.trim() : req.body.userName;
    const email = typeof req.body.email === "string" ? req.body.email.trim() : req.body.email;
    const name = typeof req.body.name === "string" ? req.body.name.trim() : req.body.name;

    // Basic input validation
    if (!email || !userName || !name || !password) {
        res.status(400).json({message: "Missing required fields."});
        return;
    }

    try {
        const {requiresApproval} = await AuthService.register(appService.getDatabasePool(), {userName, email, name, password});

        res.status(201).json({
            success: true,
            message: requiresApproval
                ? "Registration successful. An administrator needs to review and approve your account before you can log in."
                : "Registration successful. You can now log in.",
            requiresApproval,
            redirectUrl: "/login",
        });
    } catch (err) {
        if (err instanceof ValidationError) {
            res.status(err.httpStatus).json({message: err.message});
            return;
        }
        console.error("Register error:", err);
        res.status(500).json({message: "Internal server error"});
    }
}

export async function logout(req: Request, res: Response): Promise<void> {
    appService.getLogger().debug("Logout user");

    // @ts-ignore
    const token = req.cookies.token;
    await AuthService.logout(appService.getDatabasePool(), token, req.ip);

    clearSessionCookie(res);
    res.redirect("/login"); // Redirect to login;
}
