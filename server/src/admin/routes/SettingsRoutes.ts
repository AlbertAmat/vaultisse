/**
 * Settings and system information (mounted at `/api/admin`).
 *
 *  GET  /settings          every editable setting, grouped; secrets are only reported as set/unset
 *  PUT  /settings         `{changes: {KEY: "value" | null}}`; null goes back to the env var / default
 *  POST /settings/test-email  sends a test message with the current mail settings
 *  GET  /system           version, uptime, database, and the bootstrap (env-only) configuration
 */
import {Request, Router} from "express";
import {ValidationError} from "../../errors/DomainError";
import {appService, AppService} from "../../AppService";
import {handle} from "../http";
import {requireFreshAuth, requireSuperadmin} from "../middleware";
import {AdminAuditService} from "../services/AdminAuditService";
import {MailService} from "../../services/MailService";
import {ApiKeyTester} from "../services/ApiKeyTester";
import {findSetting} from "../services/settingsCatalog";

/**
 * @param audit Admin audit trail.
 * @returns The router.
 */
export function settingsRoutes(audit: AdminAuditService): Router {
    const router = Router();

    router.get("/settings", handle(async (_req, res) => {
        res.json({groups: appService.getSettings().describe()});
    }));

    router.put("/settings", requireSuperadmin, (req, res, next) => {
        // Touching a secret or the single sign-on setup needs a fresh verification: that is how an
        // attacker with a stolen session would redirect logins or read mail.
        const changes = req.body?.changes;
        const sensitive = changes && typeof changes === "object" && Object.keys(changes).some((key) => {
            const definition = findSetting(key);
            return definition?.type === "secret" || key.startsWith("OIDC_") || key === "SSO_ONLY";
        });
        return sensitive ? requireFreshAuth(req, res, next) : next();
    }, handle(async (req: Request, res) => {
        const changes = req.body?.changes;
        if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length === 0) {
            throw new ValidationError("Nothing to change.");
        }
        const keys = await appService.getSettings().update(changes, req.admin!.id, (env, touched) => AppService.validateEnv(env, touched));
        await appService.applyPortalSettings();
        // Names only, never values: secrets must not end up in the audit trail.
        await audit.record(req, "settings.update", {entityType: "settings", metadata: {keys}});
        res.json({groups: appService.getSettings().describe()});
    }));

    // Checks an API key against its provider: the typed value, or the saved one when none is given.
    router.post("/settings/test-key", requireSuperadmin, handle(async (req, res) => {
        const key = typeof req.body?.key === "string" ? req.body.key : "";
        if (!ApiKeyTester.supports(key)) {
            throw new ValidationError("That setting can't be tested.");
        }
        const typed = typeof req.body?.value === "string" ? req.body.value.trim() : "";
        const value = typed || (appService.getSettings().get(key) ?? "").trim();
        if (!value) {
            throw new ValidationError("Enter a key first.");
        }
        const result = await ApiKeyTester.test(key, value);
        // The key itself is never audited or logged, only which one was tried and the outcome.
        await audit.record(req, "settings.test_key", {entityType: "settings", entityLabel: key, metadata: {ok: result.ok, unsaved: !!typed}});
        res.json(result);
    }));

    router.post("/settings/test-email", requireSuperadmin, handle(async (req, res) => {
        const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
            throw new ValidationError("Enter a valid email address.");
        }
        // Optional unsaved SMTP_* values from the form: test what is typed in before saving it. A
        // secret left empty keeps the saved one.
        const typed = req.body?.settings;
        let mail = appService.getMailService();
        if (typed && typeof typed === "object") {
            const overrides = new Map<string, string>();
            for (const [key, value] of Object.entries(typed)) {
                if (key.startsWith("SMTP_") && typeof value === "string" && !(findSetting(key)?.type === "secret" && value === "")) {
                    overrides.set(key, value.trim());
                }
            }
            try {
                mail = new MailService(MailService.readConfig(appService.getSettings().effectiveEnv(new Map([...appService.getSettings().overrides(), ...overrides]))), appService.getLogger());
                mail.setRecorder(appService.getMailService().getRecorder());
            } catch (error) {
                throw new ValidationError(error instanceof Error ? error.message : String(error));
            }
        }
        if (!mail.isEnabled()) {
            throw new ValidationError("Email isn't configured: set the SMTP host and sender address first.");
        }
        const error = await mail.sendReportingError(to, "Vaultisse test email", "This is a test email from the Vaultisse admin portal. If you can read it, your email settings work.");
        await audit.record(req, "settings.test_email", {entityType: "settings", metadata: {ok: error === null, unsaved: !!typed}});
        res.json({ok: error === null, error});
    }));

    router.get("/system", handle(async (_req, res) => {
        const started = Date.now();
        let database = "ok";
        try {
            await appService.getDatabasePool().query("SELECT 1");
        } catch {
            database = "unreachable";
        }
        const memory = process.memoryUsage();
        const admin = appService.getAdminConfig();
        res.json({
            instanceUuid: appService.getInstanceUuid(),
            version: process.env.APP_VERSION || "dev",
            node: process.version,
            uptimeSeconds: Math.floor(process.uptime()),
            database,
            databaseLatencyMs: Date.now() - started,
            memoryMb: Math.round(memory.rss / 1024 / 1024),
            // The configuration that comes from env vars only (needed before the database is reachable
            // or only takes effect at start-up). Shown for reference, not editable here.
            bootstrap: {
                apiPort: Number(process.env.API_PORT) || null,
                adminPort: admin.port,
                adminUrl: admin.url,
                adminAllowedIps: admin.allowedIps.length,
                frontEndUrl: process.env.FRONT_END_URL ?? null,
                trustProxy: process.env.TRUST_PROXY === "true",
                allowHttp: process.env.ALLOW_HTTP === "true",
                demoMode: process.env.DEMO_MODE === "true",
                debugLogging: process.env.DEBUG_LOGGING === "true",
                encryptionKeySeparate: !!process.env.SETTINGS_ENCRYPTION_KEY?.trim(),
            },
            features: {
                mail: appService.getMailService().isEnabled(),
                sso: appService.isOidcEnabled(),
                registration: appService.isRegistrationEnabled(),
                approvalRequired: appService.requiresRegistrationApproval(),
            },
        });
    }));

    return router;
}
