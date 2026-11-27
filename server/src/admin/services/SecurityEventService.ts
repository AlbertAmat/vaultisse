/**
 * Records security-relevant events (rate-limit hits, failed logins, blocked requests) for the portal's
 * security page. Events are aggregated in memory per (type, ip, minute) and flushed in batches, so a
 * flood of requests costs a handful of rows instead of a database write per request - recording must
 * never become the thing that makes an attack hurt more.
 *
 * Does nothing while the admin portal is off (nobody could read the events).
 */
import {Request} from "express";
import {Pool} from "pg";
import {Logger} from "../../utils/Logger";
import {SecurityEventType, SecurityRepository} from "../repositories/SecurityRepository";

interface Pending {
    type: SecurityEventType;
    ip: string;
    bucket: Date;
    count: number;
    userAgent: string | null;
    path: string | null;
    detail: string | null;
}

const FLUSH_INTERVAL_MS = 15 * 1000;
/** Upper bound on distinct pending rows, so a spoofed-address flood can't grow memory without limit. */
const MAX_PENDING = 5000;
const RETENTION_DAYS = 30;

/** Buffers and persists security events. */
export class SecurityEventService {
    private pending = new Map<string, Pending>();
    private observer: ((type: SecurityEventType, ip: string | undefined, detail?: string) => void) | null = null;
    private timer: NodeJS.Timeout | null = null;
    private readonly repo: SecurityRepository;

    /**
     * @param pool Database pool.
     * @param logger Server logger.
     * @param enabled Whether the admin portal is on.
     */
    public constructor(pool: Pool, private readonly logger: Logger, private readonly enabled: boolean) {
        this.repo = new SecurityRepository(pool);
    }

    /** @param observer Told about every event as it happens (the automatic IP blocker). */
    public setObserver(observer: (type: SecurityEventType, ip: string | undefined, detail?: string) => void): void {
        this.observer = observer;
    }

    /**
     * Notes one event.
     * @param type What happened.
     * @param req The request it happened on.
     * @param detail Short extra context (e.g. which limiter).
     */
    public record(type: SecurityEventType, req: {ip?: string; headers?: Request["headers"]; originalUrl?: string}, detail?: string): void {
        if (!this.enabled) {
            return;
        }
        const ip = req.ip ?? "unknown";
        this.observer?.(type, req.ip, detail);
        const bucket = new Date(Math.floor(Date.now() / 60000) * 60000);
        const key = `${type}|${ip}|${bucket.getTime()}`;
        const existing = this.pending.get(key);
        if (existing) {
            existing.count++;
            return;
        }
        if (this.pending.size >= MAX_PENDING) {
            return;
        }
        this.pending.set(key, {
            type,
            ip,
            bucket,
            count: 1,
            userAgent: typeof req.headers?.["user-agent"] === "string" ? req.headers["user-agent"] : null,
            path: req.originalUrl ? req.originalUrl.split("?")[0] : null,
            detail: detail ?? null,
        });
    }

    /** Starts the periodic flush (and daily purge of old events). */
    public start(): void {
        if (!this.enabled || this.timer) {
            return;
        }
        this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
        this.timer.unref();
    }

    /** Stops the periodic flush and writes what is pending. */
    public async stop(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        await this.flush();
    }

    /** Writes pending events to the database. Failures are logged and the events dropped. */
    public async flush(): Promise<void> {
        if (this.pending.size === 0) {
            return;
        }
        const rows = [...this.pending.values()];
        this.pending = new Map();
        try {
            await this.repo.addEvents(rows);
        } catch (error) {
            this.logger.error(`Saving security events failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** Deletes events past the retention window. */
    public async purgeOld(): Promise<void> {
        try {
            await this.repo.purgeEvents(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000));
        } catch (error) {
            this.logger.error(`Purging security events failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
