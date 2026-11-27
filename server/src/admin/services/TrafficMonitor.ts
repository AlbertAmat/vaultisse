/**
 * Live request counters for the security page: requests, 4xx/5xx and rate-limited responses per minute
 * for the last hour, and the busiest client addresses of the last ten minutes. Kept in memory only (it is
 * a "what is happening now" view, resets on restart) so it costs almost nothing per request.
 *
 * It can't stop a DDoS - that has to happen in front of the app (reverse proxy / CDN) - but it shows
 * one in progress and who is behind it, and the IP blocklist can then refuse them.
 */
import {NextFunction, Request, Response} from "express";

interface Bucket {
    minute: number;
    total: number;
    clientErrors: number;
    serverErrors: number;
    rateLimited: number;
    ips: Map<string, number>;
}

export interface TrafficPoint {
    minute: string;
    total: number;
    clientErrors: number;
    serverErrors: number;
    rateLimited: number;
}

const HISTORY_MINUTES = 60;
const TOP_WINDOW_MINUTES = 10;
/** Distinct addresses tracked per minute; beyond this only already-seen ones are counted. */
const MAX_IPS_PER_MINUTE = 5000;

/** In-memory request statistics. */
export class TrafficMonitor {
    private readonly buckets = new Map<number, Bucket>();

    /** Express middleware counting every response. Register it before the routes. */
    public middleware = (req: Request, res: Response, next: NextFunction): void => {
        res.on("finish", () => this.count(req.ip ?? "unknown", res.statusCode));
        next();
    };

    private count(ip: string, status: number): void {
        const bucket = this.current();
        bucket.total++;
        if (status === 429) {
            bucket.rateLimited++;
        } else if (status >= 500) {
            bucket.serverErrors++;
        } else if (status >= 400) {
            bucket.clientErrors++;
        }
        const seen = bucket.ips.get(ip);
        if (seen !== undefined) {
            bucket.ips.set(ip, seen + 1);
        } else if (bucket.ips.size < MAX_IPS_PER_MINUTE) {
            bucket.ips.set(ip, 1);
        }
    }

    private current(): Bucket {
        const minute = Math.floor(Date.now() / 60000);
        let bucket = this.buckets.get(minute);
        if (!bucket) {
            bucket = {minute, total: 0, clientErrors: 0, serverErrors: 0, rateLimited: 0, ips: new Map()};
            this.buckets.set(minute, bucket);
            for (const old of this.buckets.keys()) {
                if (old < minute - HISTORY_MINUTES) {
                    this.buckets.delete(old);
                }
            }
        }
        return bucket;
    }

    /**
     * @returns One point per minute for the last hour (empty minutes included, so a chart has no gaps).
     */
    public series(): TrafficPoint[] {
        const now = Math.floor(Date.now() / 60000);
        const points: TrafficPoint[] = [];
        for (let minute = now - HISTORY_MINUTES + 1; minute <= now; minute++) {
            const bucket = this.buckets.get(minute);
            points.push({
                minute: new Date(minute * 60000).toISOString(),
                total: bucket?.total ?? 0,
                clientErrors: bucket?.clientErrors ?? 0,
                serverErrors: bucket?.serverErrors ?? 0,
                rateLimited: bucket?.rateLimited ?? 0,
            });
        }
        return points;
    }

    /**
     * @param limit Number of addresses.
     * @returns The addresses with most requests in the last ten minutes.
     */
    public topIps(limit: number): {ipAddress: string; requests: number}[] {
        const now = Math.floor(Date.now() / 60000);
        const totals = new Map<string, number>();
        for (let minute = now - TOP_WINDOW_MINUTES + 1; minute <= now; minute++) {
            for (const [ip, count] of this.buckets.get(minute)?.ips ?? []) {
                totals.set(ip, (totals.get(ip) ?? 0) + count);
            }
        }
        return [...totals.entries()]
            .map(([ipAddress, requests]) => ({ipAddress, requests}))
            .sort((a, b) => b.requests - a.requests)
            .slice(0, limit);
    }
}
