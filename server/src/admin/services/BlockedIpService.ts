/**
 * The IP blocklist. Blocked addresses get a bare 403 from {@link middleware} before anything else runs.
 * The list is cached in memory (refreshed every minute and on every change) so the check costs a Set
 * lookup per request. Exact addresses only; ranges belong in the reverse proxy / firewall.
 */
import {NextFunction, Request, Response} from "express";
import {Pool} from "pg";
import {Logger} from "../../utils/Logger";
import {SecurityRepository} from "../repositories/SecurityRepository";
import {SecurityEventService} from "./SecurityEventService";

const REFRESH_INTERVAL_MS = 60 * 1000;

/** Cached blocklist plus the middleware enforcing it. */
export class BlockedIpService {
    private blocked = new Set<string>();
    private timer: NodeJS.Timeout | null = null;
    private readonly repo: SecurityRepository;

    /**
     * @param pool Database pool.
     * @param logger Server logger.
     * @param events Where blocked requests are counted.
     * @param enabled Whether the admin portal is on (the blocklist is only enforced then).
     */
    public constructor(pool: Pool, private readonly logger: Logger, private readonly events: SecurityEventService, private readonly enabled: boolean) {
        this.repo = new SecurityRepository(pool);
    }

    /** Express middleware: refuses blocked addresses. */
    public middleware = (req: Request, res: Response, next: NextFunction): void => {
        if (this.enabled && req.ip && this.blocked.has(req.ip)) {
            this.events.record("blocked_ip_hit", req);
            res.status(403).type("text/plain").send("Forbidden");
            return;
        }
        next();
    };

    /**
     * @param ip Address.
     * @returns Whether it is currently blocked.
     */
    public isBlocked(ip: string): boolean {
        return this.blocked.has(ip);
    }

    /** Reloads the cache from the database. */
    public async refresh(): Promise<void> {
        try {
            this.blocked = new Set(await this.repo.activeBlockedAddresses());
        } catch (error) {
            this.logger.error(`Loading the IP blocklist failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** Loads the list and keeps it fresh. */
    public async start(): Promise<void> {
        if (!this.enabled) {
            return;
        }
        await this.refresh();
        this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
        this.timer.unref();
    }

    /** Stops refreshing. */
    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
