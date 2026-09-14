import {Pool} from "pg";
import {Request, Response} from "express";
import path from "path";
import {appService} from "../AppService";
import {AuthService, PendingLoginExpiredError} from "../services/AuthService";
import {UnauthorizedError, ValidationError} from "../errors/DomainError";
import {SessionCookie} from "../utils/SessionCookie";

// Compiled Vue app: alongside the server in production (Docker image),
// under client/dist during local development.
export const clientDistPath = process.env.NODE_ENV === "production" ? path.join(__dirname, "../../../client") : path.join(__dirname, '../../../client/dist')

/** Thin HTTP<->service glue for the Auth resource (password login/2FA/register/logout, SSO, and serving the SPA shell). Constructed once per process (see AuthRoute.ts) and reused across requests. */
export class AuthController {
    /**
     * @param pool Database connection pool, forwarded to a fresh AuthService on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * GET /app, GET /app/* - serves the SPA's `index.html` entry point.
     * @param req Express request.
     * @param res Express response.
     */
    public async serveApp(req: Request, res: Response): Promise<void> {
        const appPath = path.join(clientDistPath, "index.html");
        appService.getLogger().debug(`serving ${req.path} index: ${appPath}`);
        res.sendFile(appPath);
    }

    /**
     * GET / - redirects to `/app` if a session cookie is present, otherwise to `/login`.
     * @param req Express request.
     * @param res Express response.
     */
    public redirectRoot(req: Request, res: Response): void {
        // @ts-ignore
        if (req.cookies.token) {
            appService.getLogger().debug("User already logged in, redirecting to /app...");
            res.redirect("/app");
            return;
        }
        appService.getLogger().debug("User not logged in, redirecting to /login...");
        res.redirect("/login");
    }

    /**
     * GET /login - serves the static login page and clears any existing session cookie.
     * @param req Express request.
     * @param res Express response.
     */
    public showLogin(req: Request, res: Response): void {
        // If user goes to login page, clear the current token.
        // we can improve it, by checking if the token is valid, etc ad redirect to app
        // at the moment, we will clear the token
        SessionCookie.clearSessionCookie(res);
        SessionCookie.clearPending2faCookie(res);
        SessionCookie.clearOidcPendingCookie(res);
        res.sendFile(path.join(__dirname, "..", "assets", "login.html"));
    }

    /**
     * POST /login - authenticates with username/email + password, issues a session cookie.
     * @param req Express request.
     * @param res Express response.
     */
    public async login(req: Request, res: Response): Promise<void> {
        appService.getLogger().debug("Handle login authentication");
        const username = typeof req.body.username === "string" ? req.body.username.trim() : req.body.username;
        const {password} = req.body;
        if (!username || !password) {
            res.status(400).json({message: "Missing username or password"});
            return;
        }

        try {
            const outcome = await new AuthService(this.pool).login(username, password, req.get("user-agent"), req.ip);

            if (outcome.kind === "twoFactorRequired") {
                SessionCookie.setPending2faCookie(res, outcome.pendingToken);
                res.json({success: true, twoFactorRequired: true, message: "Enter your verification code"});
                return;
            }

            SessionCookie.setSessionCookie(res, outcome.token);
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

    /**
     * POST /login/2fa - second step of login for 2FA-enabled accounts.
     * @param req Express request.
     * @param res Express response.
     */
    public async loginTwoFactor(req: Request, res: Response): Promise<void> {
        const {code} = req.body;
        // @ts-ignore
        const pendingToken = req.cookies.pending_2fa_token;

        if (!code) {
            res.status(400).json({message: "Missing verification code"});
            return;
        }

        try {
            const {token} = await new AuthService(this.pool).completeTwoFactorLogin(pendingToken, code, req.get("user-agent"), req.ip);

            SessionCookie.clearPending2faCookie(res);
            SessionCookie.setSessionCookie(res, token);
            res.json({success: true, message: "Login successful", redirectUrl: "/app"});
        } catch (err) {
            if (err instanceof PendingLoginExpiredError) {
                SessionCookie.clearPending2faCookie(res);
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

    /**
     * GET /auth/oidc/status - whether SSO is offered on the login page.
     * @param req Express request.
     * @param res Express response.
     */
    public oidcStatus(req: Request, res: Response): void {
        const config = appService.getOidcConfig();
        res.json({
            enabled: appService.isOidcEnabled(),
            label: config?.buttonLabel ?? "Sign in with SSO",
        });
    }

    /**
     * GET /auth/oidc/start - begins the OIDC authorization-code + PKCE flow.
     * @param req Express request.
     * @param res Express response.
     */
    public async oidcStart(req: Request, res: Response): Promise<void> {
        if (!appService.isOidcEnabled()) {
            res.status(404).json({message: "SSO is not configured"});
            return;
        }

        try {
            const {url, pendingToken} = await new AuthService(this.pool).beginSso();
            SessionCookie.clearSessionCookie(res);
            SessionCookie.setOidcPendingCookie(res, pendingToken);
            res.redirect(url);
        } catch (error) {
            appService.getLogger().error("OIDC start failed: " + error);
            SessionCookie.clearOidcPendingCookie(res);
            res.redirect("/login?error=sso");
        }
    }

    /**
     * GET /auth/oidc/callback - IdP return: exchanges the code, finds/links/JIT-creates the user, issues a session.
     * @param req Express request.
     * @param res Express response.
     */
    public async oidcCallback(req: Request, res: Response): Promise<void> {
        const fail = () => {
            SessionCookie.clearOidcPendingCookie(res);
            res.redirect("/login?error=sso");
        };

        if (!appService.isOidcEnabled()) {
            fail();
            return;
        }

        const queryVal = (name: string): string | undefined =>
            typeof req.query[name] === "string" ? req.query[name] as string : undefined;

        try {
            const {token} = await new AuthService(this.pool).completeSso(
                {
                    code: queryVal("code"),
                    state: queryVal("state"),
                    error: queryVal("error"),
                    error_description: queryVal("error_description"),
                },
                req.cookies[SessionCookie.OIDC_PENDING_COOKIE],
                req.get("user-agent"),
                req.ip
            );

            SessionCookie.clearOidcPendingCookie(res);
            SessionCookie.setSessionCookie(res, token);
            res.redirect("/app");
        } catch (error) {
            appService.getLogger().error("OIDC callback failed: " + error);
            fail();
        }
    }

    /**
     * GET /register - serves the static registration page, or redirects to `/app` if a session cookie is already present.
     * @param req Express request.
     * @param res Express response.
     */
    public showRegister(req: Request, res: Response): void {
        // @ts-ignore
        if (req.cookies.token) {
            res.redirect("/app");
            return;
        }
        res.sendFile(path.join(__dirname, "..", "assets", "register.html"));
    }

    /**
     * POST /register - creates a new user account.
     * @param req Express request.
     * @param res Express response.
     */
    public async register(req: Request, res: Response): Promise<void> {
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
            const {requiresApproval} = await new AuthService(this.pool).register({userName, email, name, password});

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

    /**
     * GET /logout - clears the session cookie and best-effort revokes the matching session, then redirects to `/login`.
     * @param req Express request.
     * @param res Express response.
     */
    public async logout(req: Request, res: Response): Promise<void> {
        appService.getLogger().debug("Logout user");

        // @ts-ignore
        const token = req.cookies.token;
        await new AuthService(this.pool).logout(token, req.ip);

        SessionCookie.clearSessionCookie(res);
        res.redirect("/login"); // Redirect to login;
    }
}
