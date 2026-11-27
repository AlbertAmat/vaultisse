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
import os from "os";
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
import {MailLogRepository} from "./repositories/MailLogRepository";
import {blockUntilPasswordChanged, ipAllowlist, requireAdmin, sameOriginOnly} from "./middleware";
import {authRoutes} from "./routes/AuthRoutes";
import {deletionsRoutes} from "./routes/DeletionsRoutes";
import {logsRoutes} from "./routes/LogsRoutes";
import {inactivityRoutes} from "./routes/InactivityRoutes";
import {termsRoutes} from "./routes/TermsRoutes";
import {broadcastRoutes} from "./routes/BroadcastRoutes";
import {BroadcastService} from "./services/BroadcastService";
import {jobsRoutes} from "./routes/JobsRoutes";
import {retentionRoutes} from "./routes/RetentionRoutes";
import {dataRequestsRoutes} from "./routes/DataRequestsRoutes";
import {webhooksRoutes} from "./routes/WebhooksRoutes";
import {RetentionService} from "./services/RetentionService";
import {AnomalyService} from "./services/AnomalyService";
import {DataRequestService} from "./services/DataRequestService";
import {complianceRoutes} from "./routes/ComplianceRoutes";
import {mapRoutes} from "./routes/MapRoutes";
import {announcementsRoutes} from "./routes/AnnouncementsRoutes";
import {notificationsRoutes} from "./routes/NotificationsRoutes";
import {systemRoutes} from "./routes/SystemRoutes";
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
    private readonly anomalies: AnomalyService;
    public readonly retention: RetentionService;
    public readonly dataRequests: DataRequestService;
    private readonly audit: AdminAuditService;
    private readonly deletions: DeletionService;
    private readonly broadcasts: BroadcastService;

    /**
     * @param config Admin bootstrap config.
     * @param pool Database pool shared with the main API.
     * @param logger Server logger.
     */
    public constructor(private readonly config: AdminConfig, private readonly pool: Pool, private readonly logger: Logger) {
        this.app = express();
        this.audit = new AdminAuditService(pool);
        this.auth = new AdminAuthService(pool, logger, appService.getJwtSecret());
        this.anomalies = new AnomalyService(pool, logger);
        this.retention = new RetentionService(pool);
        this.auth.setSignInObserver((admin, ip, startedAt) => void this.anomalies.adminSignedIn(admin, ip, startedAt));
        this.deletions = new DeletionService(pool, this.audit, logger, () => {
            const days = Number(appService.getSettings().get("ADMIN_DELETION_GRACE_DAYS"));
            return Number.isFinite(days) && days >= 0 ? days : 7;
        });
        this.dataRequests = new DataRequestService(pool, this.deletions);
        this.broadcasts = new BroadcastService(pool, logger);
        this.registerJobs();
        this.configure();
    }

    /** Tells the job registry what the portal runs in the background (and how to run each by hand). */
    private registerJobs(): void {
        const HOUR = 60 * 60 * 1000;
        const jobs = appService.getJobs();
        jobs.register({
            id: "health-checks", name: "Health checks and alerts", schedule: "Every 5 minutes", everyMs: 5 * 60 * 1000,
            description: "Checks the database, failed sign-ins, email failures and new versions, and alerts the admins when something is wrong.",
            run: async () => {
                await appService.getNotifier().runChecks();
                return "Checked";
            },
        });
        jobs.register({
            id: "deletions", name: "Scheduled deletions", schedule: "Every hour", everyMs: HOUR, dangerous: true,
            description: "Carries out the account and vault deletions whose grace period is over.",
            run: async () => {
                const done = await this.deletions.executeDue();
                return done > 0 ? `${done} deleted` : "Nothing was due";
            },
        });
        jobs.register({
            id: "retention", name: "Purge old records", schedule: "Every hour", everyMs: HOUR, dangerous: true,
            description: "Deletes logs older than the periods set on the Data retention page, and expired admin sessions.",
            run: async () => {
                const removed = await this.retention.purge();
                await this.auth.purgeSessions();
                const total = Object.values(removed).reduce((sum, n) => sum + n, 0);
                const parts = Object.entries(removed).filter(([, n]) => n > 0).map(([id, n]) => `${n} from ${id.replace(/_/g, " ")}`);
                return total === 0 ? "Nothing to remove" : `Removed ${parts.join(", ")}`;
            },
        });
        jobs.register({
            id: "data-requests", name: "Data request reminders", schedule: "Every hour", everyMs: HOUR,
            description: "Emails the admins about data requests that are close to their deadline or past it.",
            run: async () => {
                await this.dataRequests.remind();
                return "Checked";
            },
        });
        jobs.register({
            id: "anomalies", name: "Anomaly checks", schedule: "Every hour", everyMs: HOUR,
            description: "Looks for sign-ins from a country nobody used before and for a burst of new accounts.",
            run: async () => {
                await this.anomalies.check();
                return "Checked";
            },
        });
        jobs.register({
            id: "update-check", name: "Update check", schedule: "Every day", everyMs: 24 * HOUR,
            description: "Asks GitHub for the latest release, so the console and the admins' emails can say when a new version is out.",
            run: async () => {
                const status = await appService.getUpdateChecker().status(true);
                if (!status.checkEnabled) return "Switched off (Settings > Admin portal)";
                if (status.error) return `Could not reach GitHub: ${status.error}`;
                return status.updateAvailable ? `Version ${status.latest} is available` : "Up to date";
            },
        });
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
                    // OpenStreetMap tiles for the login map.
                    imgSrc: ["'self'", "data:", "https://tile.openstreetmap.org"],
                    fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
                    connectSrc: ["'self'", ...(this.config.url ? [this.config.url] : [])],
                    frameAncestors: ["'none'"],
                    ...(process.env.ALLOW_HTTP === "true" ? {upgradeInsecureRequests: null} : {}),
                },
            },
        }));

        // Nothing the console shows (accounts, logs, exports) may be kept by a browser or a proxy cache, and the console
        // never needs the camera, microphone, location or payment APIs.
        app.use((_req, res, next) => {
            res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
            next();
        });
        app.use("/api/admin", (_req, res, next) => {
            res.setHeader("Cache-Control", "no-store, max-age=0");
            res.setHeader("Pragma", "no-cache");
            next();
        });

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
        app.use("/api/admin", blockUntilPasswordChanged);
        app.use("/api/admin", overviewAndAdminsRoutes(this.pool, this.auth, this.audit));
        app.use("/api/admin", settingsRoutes(this.audit));
        app.use("/api/admin/users", usersRoutes(this.pool, this.audit, this.deletions));
        app.use("/api/admin", vaultsRoutes(this.pool, this.audit, this.deletions));
        app.use("/api/admin/deletions", deletionsRoutes(this.audit, this.deletions));
        app.use("/api/admin/security", securityRoutes(this.pool, this.audit));
        app.use("/api/admin/logs", logsRoutes(this.pool, this.audit));
        app.use("/api/admin/system", systemRoutes());
        app.use("/api/admin/announcements", announcementsRoutes(this.pool, this.audit));
        app.use("/api/admin/broadcast", broadcastRoutes(this.broadcasts, this.audit));
        app.use("/api/admin/inactivity", inactivityRoutes(this.pool, this.audit));
        app.use("/api/admin/terms", termsRoutes(this.pool));
        app.use("/api/admin/compliance", complianceRoutes(this.pool, this.audit));
        app.use("/api/admin/data-requests", dataRequestsRoutes(this.pool, this.audit, this.dataRequests));
        app.use("/api/admin/webhooks", webhooksRoutes(this.audit));
        app.use("/api/admin/jobs", jobsRoutes(this.audit));
        app.use("/api/admin/retention", retentionRoutes(this.retention));
        app.use("/api/admin/map", mapRoutes(this.pool));
        app.use("/api/admin/notifications", notificationsRoutes(this.pool, this.audit));
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

        await this.ensureFirstAdmin(port);
        // A broadcast that was still sending when the server stopped can't continue: say so.
        await this.broadcasts.markInterrupted().catch((error) => this.logger.error(`Updating broadcasts failed: ${error}`));

        if (!process.env.SETTINGS_ENCRYPTION_KEY?.trim()) {
            this.logger.warn("SETTINGS_ENCRYPTION_KEY is not set: secrets saved in the admin portal are encrypted with a key derived from JWT_SECRET. Set a dedicated SETTINGS_ENCRYPTION_KEY (and keep it stable).");
        }

        const first = setTimeout(() => void this.maintain(), 2 * 60 * 1000);
        const hourly = setInterval(() => void this.maintain(), MAINTENANCE_INTERVAL_MS);
        const daily = setInterval(() => void appService.getJobs().runScheduled("update-check"), 24 * 60 * 60 * 1000);
        const firstCheck = setTimeout(() => void appService.getJobs().runScheduled("update-check"), 5 * 60 * 1000);
        [first, hourly, daily, firstCheck].forEach((timer) => timer.unref());
        this.timers.push(first, hourly, daily, firstCheck);
    }

    /**
     * The first time the portal runs there is nobody who could sign in, so one admin is created with a generated
     * password, printed once in the container's output (not in the log file the portal can display). That
     * admin must change the password at first login.
     * @param port Port the portal listens on, for the sign-in address in the message.
     * @returns The generated login, or null when an admin already existed.
     */
    public async ensureFirstAdmin(port: number): Promise<{email: string; password: string} | null> {
        const created = await this.auth.bootstrapFirstAdmin();
        if (created) {
            const line = "=".repeat(68);
            const addresses = AdminApp.reachableAddresses(port, this.config.url);
            const docker = fs.existsSync("/.dockerenv");
            console.log([
                "",
                line,
                "  ADMIN PORTAL - first start",
                "",
                "  The portal is on and had no administrator, so one was created:",
                "",
                `      username: ${created.email}`,
                `      password: ${created.password}`,
                "",
                `  The admin portal is listening on port ${port}. Open it at:`,
                "",
                ...addresses.map((address) => `      ${address}`),
                ...(docker ? [
                    "",
                    "  (Running in Docker: use the host's address with the PUBLISHED port. The compose",
                    `   file publishes ${port} on 127.0.0.1 only, so from another machine use a reverse`,
                    "   proxy, an SSH tunnel, or change the published address.)",
                ] : []),
                "",
                "  CHANGE THIS PASSWORD AFTER THE FIRST LOGIN: you will be asked to.",
                "  It is shown only this once. If you lose it, run:",
                "    node index.js admin:reset --email " + created.email,
                line,
                "",
            ].join("\n"));
            this.logger.warn("Admin portal: the first administrator was created; its generated password was printed to the container output.");
        }
        return created;
    }

    /**
     * @param port Port the portal listens on.
     * @param publicUrl ADMIN_URL, if set.
     * @returns Addresses to open it at: the public URL, localhost, and every IPv4 address of this machine.
     */
    public static reachableAddresses(port: number, publicUrl: string | null): string[] {
        const addresses: string[] = [];
        if (publicUrl) {
            addresses.push(`${publicUrl}   (ADMIN_URL)`);
        }
        if (publicUrl !== `http://localhost:${port}`) {
            addresses.push(`http://localhost:${port}`);
        }
        for (const list of Object.values(os.networkInterfaces())) {
            for (const entry of list ?? []) {
                if (entry.family === "IPv4" && !entry.internal) {
                    addresses.push(`http://${entry.address}:${port}`);
                }
            }
        }
        return addresses;
    }

    /** Hourly housekeeping: runs the hourly background jobs (deletions, purge of old records, reminders, anomaly checks). */
    public async maintain(): Promise<void> {
        const jobs = appService.getJobs();
        // One after the other: each is recorded, and one failing doesn't stop the rest.
        for (const id of ["deletions", "retention", "data-requests", "anomalies"]) {
            await jobs.runScheduled(id);
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
