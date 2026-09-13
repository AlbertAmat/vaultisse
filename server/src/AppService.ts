import express, {Express, Request} from "express"; // Express framework for building APIs
import bodyParser from "body-parser"; // Middleware to parse incoming request bodies
import http, {Server} from "http"; // Node HTTP module to create server
import pg from 'pg'; // PostgreSQL client
import {routes} from "./routes/Routes"; // Import all application routes
import {Logger} from "./utils/Logger"; // Custom logger utility
import AuthRoute from "./routes/AuthRoute"; // Auth-related routes
import cors from "cors"; // Cross-Origin Resource Sharing middleware
import cookieParser from "cookie-parser"; // Middleware to parse cookies
import jwt from "jsonwebtoken"; // JSON Web Token library for authentication
import dotenv from "dotenv"; // Load environment variables from .env
import bcrypt from "bcrypt"; // Library for password hashing
import helmet from "helmet"; // Middleware to set secure HTTP headers
import rateLimit from "express-rate-limit";
import path from "path"; // Middleware to limit repeated requests
import {blockWritesInDemo} from "./middlewares/DemoModeMiddleware"; // Rejects writes when DEMO_MODE=true
import "./types/express"; // Request.sessionId/sessionKey ambient augmentation - imported for its side effect, see that file's comment

interface DatabaseConf {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
}

/** Present only when every required OIDC env var is set. See isOidcEnabled(). */
export interface OidcConfig {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string;
    buttonLabel: string;
}

function readOidcConfig(): OidcConfig | null {
    const issuer = (process.env.OIDC_ISSUER ?? "").trim();
    const clientId = (process.env.OIDC_CLIENT_ID ?? "").trim();
    const clientSecret = (process.env.OIDC_CLIENT_SECRET ?? "").trim();
    const redirectUri = (process.env.OIDC_REDIRECT_URI ?? "").trim();
    if (!issuer || !clientId || !clientSecret || !redirectUri) {
        return null;
    }

    const scopes = (process.env.OIDC_SCOPES ?? "").trim() || "openid profile email";
    const buttonLabel = (process.env.OIDC_BUTTON_LABEL ?? "").trim() || "Sign in with SSO";

    return {issuer, clientId, clientSecret, redirectUri, scopes, buttonLabel};
}

export class AppService {
    /**
     * Prefix for all API routes
     * @private
     */
    private static ROUTE_PREFIX = "/api/rest";

    /**
     * Express application instance
     * @private
     */
    private readonly m_app: Express;

    /**
     * Port on which the server runs
     * @private
     */
    private readonly m_port: number;

    /**
     * HTTP server instance
     * @private
     */
    private m_server: Server<any, any> | null;

    /**
     * Database configuration
     * @private
     */
    private readonly m_databaseConf: DatabaseConf;

    /**
     * PostgreSQL connection pool
     * @private
     */
    private readonly m_databasePool: pg.Pool;

    /**
     * Custom logger instance
     * @private
     */
    private readonly m_logger: Logger;

    /**
     * Secret key for JWT
     * @private
     */
    private readonly m_jwtSecret: string;

    /**
     * Session expiration time in seconds
     * @private
     */
    private readonly m_sessionTime: number;

    /**
     * Flag to allow development authentication
     * @private
     */
    private readonly m_allowDevAuth: boolean;

    /**
     * The google books PI key, if not present, it will use open library
     * @private
     */
    private readonly m_googleApiKey: string | undefined;

    /**
     * Max size (in MB) accepted for a library import CSV (see ImportRoute.ts),
     * configurable via MAX_IMPORT_FILE_SIZE_MB. Defaults to 10MB when unset
     * or not a valid positive number.
     * @private
     */
    private readonly m_maxImportFileSizeMb: number;

    /**
     * OIDC client config, or null when the required env vars are unset.
     * Presence alone does not mean SSO is offered - see isOidcEnabled().
     * @private
     */
    private readonly m_oidcConfig: OidcConfig | null;

    /**
     * Application constructor
     * Initializes environment variables, database, middleware, and logging
     */
    public constructor() {
        dotenv.config(); // Load environment variables from .env

        const frontEndUrl = String(process.env.FRONT_END_URL);

        this.m_port = Number(process.env.API_PORT); // API port

        this.m_app = express(); // Initialize Express app

        // Only trust X-Forwarded-* headers when this instance is actually
        // sitting behind a reverse proxy/tunnel (Cloudflare Tunnel, Nginx,
        // Caddy, ...). Enabling this without a real proxy in front lets any
        // client spoof its IP and bypass the rate limiters below.
        if (process.env.TRUST_PROXY === "true") {
            this.m_app.set("trust proxy", 1);
        }

        this.m_app.use(bodyParser.json()); // Parse JSON request bodies
        this.m_app.use(bodyParser.urlencoded({extended: true})); // Parse URL-encoded bodies
        this.m_app.use(cookieParser()); // Parse cookies

        // Reject state-changing requests when DEMO_MODE=true - must run
        // before routes are mounted so it covers AuthRoute (at "/") too.
        this.m_app.use(blockWritesInDemo);

        // use static from compiled app in /assets/app
        this.m_app.use(express.static(path.join(__dirname,  "assets", "app")));

        // Secure HTTP headers
        this.m_app.use(helmet({
            contentSecurityPolicy: {
                useDefaults: true,
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", frontEndUrl, "'unsafe-inline'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    frameSrc: ["'self'", "data:", "blob:"],
                    // Book covers are either our own uploads (data: URIs) or fetched
                    // from these two ISBN metadata providers - kept in sync with the
                    // isAllowedImageUrl() allowlist in BooksRoute.ts.
                    imgSrc: ["'self'", "data:", "https://books.google.com", "http://books.google.com", "https://covers.openlibrary.org"],
                    "script-src-attr": ["'unsafe-inline'"],
                    "script-src-elem": ["'unsafe-inline'", "'self'", frontEndUrl, "'unsafe-inline'"]
                },
            },
        }));

        // Rate limiting to prevent brute force attacks / DDoS
        const limiter = rateLimit({
            windowMs: 10 * 60 * 1000, // 10 minutes
            max: 500, // max 300 requests per IP in the window
        });
        this.m_app.use(limiter);

        // CORS configuration to allow requests from frontend
        this.m_app.use(cors({
            origin: frontEndUrl,
            credentials: true,
        }));

        // Setup database configuration
        this.m_databaseConf = {
            host: String(process.env.DB_HOST),
            port: Number(process.env.DB_PORT),
            name: String(process.env.DB_NAME),
            user: String(process.env.DB_USER),
            password: String(process.env.DB_PASSWORD),
        };

        // Initialize PostgreSQL connection pool
        this.m_databasePool = new pg.Pool({
            host: this.m_databaseConf.host,
            port: this.m_databaseConf.port,
            database: this.m_databaseConf.name,
            user: this.m_databaseConf.user,
            password: this.m_databaseConf.password,
            max: 20, // max connections
            idleTimeoutMillis: 30000, // idle timeout
            connectionTimeoutMillis: 2000, // connection timeout
        });

        // JWT secret and session configuration
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET environment variable is required");
        }
        this.m_jwtSecret    = process.env.JWT_SECRET;
        this.m_sessionTime  = Number(process.env.SESSION_TIME);
        this.m_allowDevAuth = process.env.ALLOW_DEV_AUTH == "true";

        this.m_googleApiKey = String(process.env.GOOGLE_BOOKS_API_KEY)

        const parsedMaxImportFileSizeMb = Number(process.env.MAX_IMPORT_FILE_SIZE_MB);
        this.m_maxImportFileSizeMb = Number.isFinite(parsedMaxImportFileSizeMb) && parsedMaxImportFileSizeMb > 0
            ? parsedMaxImportFileSizeMb
            : 10;

        this.m_oidcConfig = readOidcConfig();

        this.m_server       = null;

        // Initialize logger
        this.m_logger       = new Logger(String(process.env.LOGGER_PATH));
    }

    /**
     * Initialize the API server
     */
    public init() {
        AppService.__printBanner();

        const server = http.createServer(this.m_app);

        // Load all routes into Express
        this.__loadRoutes();

        // Start listening on the configured port
        server.listen(this.m_port, () => {
            console.log(`API started at http://localhost:${this.m_port}. Date: [${new Date().toString()}]`);
        });

        this.m_server = server;

        // Log server start
        this.m_logger.info(`Server running on port ${this.m_port};`)
    }

    /** Get Express application instance */
    public getApp(): Express {
        return this.m_app;
    }

    /** Get server port */
    public getPort(): number {
        return this.m_port;
    }

    /** Get HTTP server instance */
    public getServer(): Server<any, any> | null {
        return this.m_server;
    }

    /** Get JWT secret */
    public getJwtSecret(): string {
        return this.m_jwtSecret;
    }

    /** Get the configured Google Books API key (undefined falls back to Open Library, see BooksRoute.ts). */
    public getGoogleApiKey(): string | undefined {
        return this.m_googleApiKey;
    }

    /** Max size (in MB) accepted for a library import CSV, see ImportRoute.ts and GET /app/policy. */
    public getMaxImportFileSizeMb(): number {
        return this.m_maxImportFileSizeMb;
    }

    /** Get session expiration time */
    public getSessionTime(): number {
        return this.m_sessionTime;
    }

    /** Get database connection pool */
    public getDatabasePool(): pg.Pool {
        return this.m_databasePool;
    }

    /**
     * Print the startup ASCII banner to the console.
     * @private
     */
    private static __printBanner() {
        const banner = String.raw`
██╗   ██╗ █████╗ ██╗   ██╗██╗  ████████╗██╗███████╗███████╗███████╗
██║   ██║██╔══██╗██║   ██║██║  ╚══██╔══╝██║██╔════╝██╔════╝██╔════╝
██║   ██║███████║██║   ██║██║     ██║   ██║███████╗███████╗█████╗
╚██╗ ██╔╝██╔══██║██║   ██║██║     ██║   ██║╚════██║╚════██║██╔══╝
 ╚████╔╝ ██║  ██║╚██████╔╝███████╗██║   ██║███████║███████║███████╗
  ╚═══╝  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝   ╚═╝╚══════╝╚══════╝╚══════╝
`;
        console.log(banner);
        console.log("  This project is open source — contributions and issues welcome!");
        console.log("  https://github.com/AlbertAmat/vaultisse");
        console.log("");
    }

    /**
     * Load application routes
     * @private
     */
    private __loadRoutes() {
        console.log("")
        console.log("Routes:")

        const consoleRoutesArr = ["/"]; // Array to display registered routes

        // Root route for authentication/session handling
        this.m_app.use("/", AuthRoute);

        // Register all routes with API prefix
        for (const route in routes) {
            const fullRoute = AppService.ROUTE_PREFIX + route;
            this.m_app.use(fullRoute, routes[route]);
            consoleRoutesArr.push(fullRoute)
        }

        console.table(consoleRoutesArr) // Display routes in console
    }

    /** Get instance of logger */
    public getLogger(): Logger {
        return this.m_logger;
    }

    /** Check if development authentication is allowed */
    public allowDevAuth(): boolean {
        return this.m_allowDevAuth;
    }

    /**
     * SSO is offered only when OIDC is fully configured and this is not a
     * public demo (JIT on a shared demo catalog would create real accounts).
     */
    public isOidcEnabled(): boolean {
        return this.m_oidcConfig !== null && process.env.DEMO_MODE !== "true";
    }

    /** Configured OIDC client, or null when the required env vars are unset. */
    public getOidcConfig(): OidcConfig | null {
        return this.m_oidcConfig;
    }

    /**
     * Get user ID from session cookie
     * @param request Express request
     */
    public getSessionUser(req: Request) {
        const token = req.cookies.token;
        if (!token) {
            throw Error("No session")
        }

        let decoded;
        try {
            decoded = jwt.verify(token, this.getJwtSecret(), {
                algorithms: ["HS256"],
                audience: "vaultisse",
                issuer: "vaultisse.com"
            }) as { user_id: number; exp: number };
        } catch (err) {
            throw new Error("Error while getting session user");
        }

        return decoded.user_id;
    }

    /**
     * Create a signed JWT session token. tokenVersion must match the user's
     * current users.token_version at verification time (see requireAuth) -
     * bumping the DB column invalidates every previously issued token for
     * that user, e.g. on password change. sessionKey identifies the
     * specific `user_sessions` row this token belongs to (its `session_key`
     * column, see utils/UserSessions.ts) - carried as the `sid` claim so
     * requireAuth can look up that one session (device/IP, revocation)
     * instead of just the account as a whole.
     * @param userId
     * @param tokenVersion
     * @param sessionKey
     */
    public createSessionToken(userId: number, tokenVersion: number, sessionKey: string): string {
        return jwt.sign(
            {user_id: userId, token_version: tokenVersion, sid: sessionKey},
            this.getJwtSecret(),
            {
                expiresIn: Math.floor(this.getSessionTime() / 1000),
                audience: "vaultisse",
                issuer: "vaultisse.com"
            }
        );
    }

    /**
     * Create a short-lived pending-2FA token: proves the caller already
     * passed the password check for `userId`, but is NOT a session token -
     * it carries no `token_version` claim and uses a distinct `audience`,
     * so even if it ended up in the `token` cookie by mistake, requireAuth
     * (which checks for audience "vaultisse") would reject it. Kept in a
     * separate `pending_2fa_token` cookie, never `token` (see AuthRoute.ts).
     * @param userId
     */
    public createPending2faToken(userId: number): string {
        return jwt.sign(
            {user_id: userId},
            this.getJwtSecret(),
            {
                expiresIn: 5 * 60, // 5 minutes - just long enough to type a code
                audience: "vaultisse-2fa-pending",
                issuer: "vaultisse.com"
            }
        );
    }

    /**
     * Verifies a pending-2FA token (see `createPending2faToken`).
     * @param token
     * @returns The user id it was issued for, or `null` if missing/invalid/expired.
     */
    public verifyPending2faToken(token: string | undefined): number | null {
        if (!token) {
            return null;
        }

        try {
            const decoded = jwt.verify(token, this.getJwtSecret(), {
                algorithms: ["HS256"],
                audience: "vaultisse-2fa-pending",
                issuer: "vaultisse.com"
            }) as { user_id: number };
            return decoded.user_id;
        } catch {
            return null;
        }
    }

    /**
     * Hash a plain text password
     * @param plainPassword User's password
     */
    public hashPassword(plainPassword: string): Promise<string> {
        const saltRounds = 12; // good balance between security and speed
        return bcrypt.hash(plainPassword, saltRounds);
    }

    /**
     * Compare a plain text password with a hashed password
     * @param plainPassword Plain text password
     * @param hashedPassword Hashed password from DB
     */
    public async comparePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
        return bcrypt.compare(plainPassword, hashedPassword);
    }
}

// Export singleton instance of AppService
export const appService = new AppService();