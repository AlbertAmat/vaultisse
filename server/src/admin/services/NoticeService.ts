/**
 * What every user of the app is told: announcement banners and maintenance mode.
 *
 * Maintenance mode makes the app read-only: every request that would change something is answered
 * with 503 and the maintenance message, while reading, signing in and out keep working. It is a plain row
 * in `app_settings` (not an editable setting, so a configuration reset doesn't end it) and is cached in
 * memory, so the check on each request costs nothing.
 *
 * Everything is inert while the admin portal is off.
 */
import {NextFunction, Request, Response} from "express";
import {Pool} from "pg";
import {Logger} from "../../utils/Logger";
import {AnnouncementRepository, AnnouncementRow} from "../repositories/AnnouncementRepository";
import {SettingsRepository} from "../repositories/SettingsRepository";

const REFRESH_MS = 30 * 1000;
export const DEFAULT_MAINTENANCE_MESSAGE = "The app is in maintenance mode. You can read your library, but changes are disabled for now.";

/** Writes that stay possible during maintenance: signing in (the session is bookkeeping, not library data). */
const ALLOWED_WRITE_PATHS = new Set(["/login", "/login/2fa"]);

export interface MaintenanceState {
    enabled: boolean;
    message: string;
    since: string | null;
}

/** What the app shows its users. */
export interface PublicNotice {
    announcements: {id: number; message: string; level: string}[];
    maintenance: {message: string} | null;
}

/** Announcements and maintenance mode. */
export class NoticeService {
    private readonly announcements: AnnouncementRepository;
    private readonly plain: SettingsRepository;
    private active: AnnouncementRow[] = [];
    private maintenanceState: MaintenanceState = {enabled: false, message: DEFAULT_MAINTENANCE_MESSAGE, since: null};
    private timer: NodeJS.Timeout | null = null;

    /**
     * @param pool Database pool.
     * @param logger Server logger.
     * @param enabled Whether the admin portal is on.
     */
    public constructor(pool: Pool, private readonly logger: Logger, private readonly enabled: boolean) {
        this.announcements = new AnnouncementRepository(pool);
        this.plain = new SettingsRepository(pool);
    }

    /** Express middleware: in maintenance mode, refuses everything that would change data. */
    public blockWrites = (req: Request, res: Response, next: NextFunction): void => {
        if (!this.enabled || !this.maintenanceState.enabled) {
            next();
            return;
        }
        const safe = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
        if (safe || ALLOWED_WRITE_PATHS.has(req.path)) {
            next();
            return;
        }
        res.status(503).json({message: this.maintenanceState.message, maintenance: true});
    };

    /** Loads the current state and keeps it fresh. */
    public async start(): Promise<void> {
        if (!this.enabled) {
            return;
        }
        await this.refresh();
        this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
        this.timer.unref();
    }

    /** Stops refreshing. */
    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** Reloads announcements and maintenance state from the database. */
    public async refresh(): Promise<void> {
        try {
            this.active = await this.announcements.active();
            const [flag, message, since] = await Promise.all([
                this.plain.getPlain("MAINTENANCE_ENABLED"), this.plain.getPlain("MAINTENANCE_MESSAGE"), this.plain.getPlain("MAINTENANCE_SINCE"),
            ]);
            this.maintenanceState = {enabled: flag === "true", message: message || DEFAULT_MAINTENANCE_MESSAGE, since};
        } catch (error) {
            this.logger.error(`Loading announcements failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** @returns The maintenance state. */
    public maintenance(): MaintenanceState {
        return this.maintenanceState;
    }

    /**
     * Turns maintenance mode on or off.
     * @param enabled New state.
     * @param message What users are told (default text when empty).
     */
    public async setMaintenance(enabled: boolean, message: string): Promise<void> {
        await this.plain.putPlain("MAINTENANCE_ENABLED", enabled ? "true" : "false");
        await this.plain.putPlain("MAINTENANCE_MESSAGE", message);
        if (enabled && !this.maintenanceState.enabled) {
            await this.plain.putPlain("MAINTENANCE_SINCE", new Date().toISOString());
        }
        await this.refresh();
    }

    /** @returns What the app shows its users right now (empty while the portal is off). */
    public publicNotice(): PublicNotice {
        if (!this.enabled) {
            return {announcements: [], maintenance: null};
        }
        return {
            announcements: this.active.slice(0, 3).map((row) => ({id: row.id, message: row.message, level: row.level})),
            maintenance: this.maintenanceState.enabled ? {message: this.maintenanceState.message} : null,
        };
    }
}
