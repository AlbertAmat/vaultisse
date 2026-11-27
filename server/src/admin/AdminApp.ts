/**
 * The admin portal's own HTTP listener, run inside the same Node process as the main API but on its own
 * port (ADMIN_PORT) - so it can be published on its own domain (e.g. adm.vaultisse.com) or kept off the
 * public internet entirely, and so a flood against the public app doesn't touch it.
 *
 * It serves two things: the admin web app (the compiled `admin/` workspace) and the `/api/admin/*` API the
 * web app talks to. It only exists when ADMIN_ENABLED=true.
 */
import fs from "fs";
import http, {Server} from "http";
import path from "path";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, {Express} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import {Pool} from "pg";
import {appService} from "../AppService";
import {rateLimited} from "../middlewares/RateLimitHandler";
import {Logger} from "../utils/Logger";
import {ADMIN_DIST_DIR} from "../utils/Paths";
import {AdminConfig} from "./AdminConfig";
import {ipAllowlist, requireAdmin, sameOriginOnly} from "./middleware";
import {authRoutes} from "./routes/AuthRoutes";
import {deletionsRoutes} from "./routes/DeletionsRoutes";
import {logsRoutes} from "./routes/LogsRoutes";
import {overviewAndAdminsRoutes} from "./routes/OverviewAndAdminsRoutes";
import {securityRoutes} from "./routes/SecurityRoutes";
import {settingsRoutes} from "./routes/SettingsRoutes";
import {usersRoutes} from "./routes/UsersRoutes";
import {vaultsRoutes} from "./routes/VaultsRoutes";
import {AdminAuditService} from "./services/AdminAuditService";
import {AdminAuthService} from "./services/AdminAuthService";
import {DeletionService} from "./services/DeletionService";

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

/** The admin portal server. */
export class AdminApp {
    private readonly app: Express;
    private server: Server | null = null;
    private timers: NodeJS.Timeout[] = [];
    private readonly auth: AdminAuthService;
    private readonly audit: AdminAuditService;
    private readonly deletions: DeletionService;

    /**
     * @param config Admin bootstrap config.
     * @param pool Database pool shared with the main API.
     * @param logger Server logger.
     */
    public constructor(private readonly config: AdminConfig, private readonly pool: Pool, private readonly logger: Logger) {
        this.app = express();
        this.audit = new AdminAuditService(pool);
        this.auth = new AdminAuthService(pool, logger, appService.getJwtSecret());
        this.deletions = new DeletionService(pool, this.audit, logger, () => {
            const days = Number(appService.getSettings().get("ADMIN_DELETION_GRACE_DAYS"));
            return Number.isFinite(days) && days >= 0 ? days : 7;
        });
        this.configure();
    }

    /** @returns The underlying HTTP server (null until started). */
    public getServer(): Server | null {
        return this.server;
    }

    /** @returns The Express app, for tests. */
    public getApp(): Express {
        return this.app;
    }

    private configure(): void {
        const app = this.app;
        if (process.env.TRUST_PROXY === "true") {
            app.set("trust proxy", 1);
        }
        app.disable("x-powered-by");

        app.use(ipAllowlist(this.config));
        app.use((req, res, next) => appService.getBlockedIps().middleware(req, res, next));

        app.use(helmet({
            contentSecurityPolicy: {
                useDefaults: true,
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'"],
                    // The same Google Fonts the client app uses, so both look alike.
                    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                    imgSrc: ["'self'", "data:"],
                    fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
                    connectSrc: ["'self'", ...(this.config.url ? [this.config.url] : [])],
                    frameAncestors: ["'none'"],
                    ...(process.env.ALLOW_HTTP === "true" ? {upgradeInsecureRequests: null} : {}),
                },
            },
        }));

        app.use(rateLimit({windowMs: 10 * 60 * 1000, max: 1500, handler: rateLimited("admin-global")}));
        if (this.config.url) {
            app.use(cors({origin: this.config.url, credentials: true}));
        }
        app.use(cookieParser());
        app.use(bodyParser.json({limit: "100kb"}));
        app.use(sameOriginOnly(this.config));

        // Unauthenticated: login and second factor. Everything else needs a valid admin session.
        app.use("/api/admin/auth", authRoutes(this.auth, this.audit));
        app.use("/api/admin", requireAdmin(this.auth));
        app.use("/api/admin", overviewAndAdminsRoutes(this.pool, this.auth, this.audit));
        app.use("/api/admin", settingsRoutes(this.audit));
        app.use("/api/admin/users", usersRoutes(this.pool, this.audit, this.deletions));
        app.use("/api/admin", vaultsRoutes(this.pool, this.audit, this.deletions));
        app.use("/api/admin/deletions", deletionsRoutes(this.audit, this.deletions));
        app.use("/api/admin/security", securityRoutes(this.pool, this.audit));
        app.use("/api/admin/logs", logsRoutes(this.pool, this.audit));
        app.use("/api/admin", (_req, res) => {
            res.status(404).json({message: "Not found"});
        });

        // The compiled admin web app, with the single-page-app fallback for client-side routes.
        const indexFile = path.join(ADMIN_DIST_DIR, "index.html");
        if (fs.existsSync(indexFile)) {
            app.use(express.static(ADMIN_DIST_DIR, {index: false}));
            app.get("*", (_req, res) => {
                res.sendFile(indexFile);
            });
        } else {
            app.get("/", (_req, res) => {
                res.status(200).type("text/plain").send("The admin web app isn't built. Run `npm run build -w @vaultisse/admin`.");
            });
        }
    }

    /** Starts listening and the hourly maintenance pass. */
    public async start(): Promise<void> {
        const server = http.createServer(this.app);
        this.server = server;
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(this.config.port, () => {
                server.off("error", reject);
                resolve();
            });
        });
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : this.config.port;
        console.log(`Admin portal started at http://localhost:${port}${this.config.url ? ` (public: ${this.config.url})` : ""}.`);
        this.logger.info(`Admin portal running on port ${port};`);

        if (!process.env.SETTINGS_ENCRYPTION_KEY?.trim()) {
            this.logger.warn("SETTINGS_ENCRYPTION_KEY is not set: secrets saved in the admin portal are encrypted with a key derived from JWT_SECRET. Set a dedicated SETTINGS_ENCRYPTION_KEY (and keep it stable).");
        }

        const first = setTimeout(() => void this.maintain(), 2 * 60 * 1000);
        const hourly = setInterval(() => void this.maintain(), MAINTENANCE_INTERVAL_MS);
        first.unref();
        hourly.unref();
        this.timers.push(first, hourly);
    }

    /** Hourly housekeeping: carry out deletions whose grace period is over, drop old events and sessions. */
    public async maintain(): Promise<void> {
        try {
            await this.deletions.executeDue();
            await appService.getSecurityEvents().purgeOld();
            await this.auth.purgeSessions();
        } catch (error) {
            this.logger.error(`Admin maintenance failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** Stops the timers and the listener. */
    public async stop(): Promise<void> {
        this.timers.forEach((timer) => clearTimeout(timer));
        this.timers = [];
        const server = this.server;
        this.server = null;
        if (server) {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    }
}
