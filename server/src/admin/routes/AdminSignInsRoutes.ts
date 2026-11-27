/**
 * Sign-ins to the admin console (mounted at `/api/admin/admin-signins`): who tried, from where, and whether it worked.
 * Built to spot an attack on the console: a burst of failures from one address, one address trying many emails, a country
 * nobody signs in from.
 *
 *  GET /?days=1|7|30|90     summary, a timeline of successful and failed attempts, and one row per address with its place
 *  GET /attempts            ?days=&result=failed|ok&ip=&page=   the individual attempts, newest first
 *
 * Readable by every admin (the audit trail already is). To act on an address use Security > Blocked addresses
 * (`POST /api/admin/security/blocked-ips`).
 *
 * Example:
 *   GET /api/admin/admin-signins?days=7
 *     -> {"days": 7, "summary": {"ok": 4, "failed": 9, "failedIps": 2, "countries": 2, "limited": 3},
 *         "timeline": [{"bucket": "2026-11-27T00:00:00", "ok": 1, "failed": 5}, ...],
 *         "sources": [{"ip": "95.173.136.70", "country": "RU", "city": "", "failed": 5, "ok": 0, "limited": 3, "emails": 2,
 *                      "stages": ["password"], "firstSeen": "...", "lastSeen": "...", "blocked": false, "suspicious": true}],
 *         "countries": [{"country": "RU", "failed": 5, "ok": 0}]}
 */
import {Router} from "express";
import {Pool} from "pg";
import {ValidationError} from "../../errors/DomainError";
import {appService} from "../../AppService";
import {handle, paging, text} from "../http";
import {AdminSignInsRepository, SIGN_IN_PERIODS} from "../repositories/AdminSignInsRepository";
import {locate} from "../services/GeoLocator";

/** Failures from one address at which it is called suspicious (the console's own alert starts at 3 in ten minutes). */
export const SUSPICIOUS_FAILURES = 3;

function period(value: unknown): number {
    const days = value === undefined ? 7 : Number(value);
    if (!SIGN_IN_PERIODS.includes(days)) {
        throw new ValidationError(`The period must be one of ${SIGN_IN_PERIODS.join(", ")} days.`);
    }
    return days;
}

/**
 * @param pool Database pool.
 * @returns The router.
 */
export function adminSignInsRoutes(pool: Pool): Router {
    const router = Router();
    const repo = new AdminSignInsRepository(pool);

    router.get("/", handle(async (req, res) => {
        const days = period(req.query.days);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const unit = days === 1 ? "hour" : "day";
        const [timeline, rawSources, totals] = await Promise.all([repo.timeline(since, unit), repo.sources(since), repo.totals(since)]);

        const sources = rawSources.map((row) => {
            const place = locate(row.ip);
            return {
                ...row, country: place?.country ?? null, city: place?.city ?? "",
                blocked: appService.getBlockedIps().isBlocked(row.ip),
                suspicious: row.failed >= SUSPICIOUS_FAILURES || row.limited > 0 || row.emails >= 3,
            };
        });
        const byCountry = new Map<string, {failed: number; ok: number}>();
        for (const source of sources) {
            const key = source.country ?? "??";
            const entry = byCountry.get(key) ?? {failed: 0, ok: 0};
            entry.failed += source.failed;
            entry.ok += source.ok;
            byCountry.set(key, entry);
        }
        res.json({
            days, unit,
            summary: {...totals, countries: [...byCountry.keys()].filter((c) => c !== "??").length, limited: sources.reduce((sum, s) => sum + s.limited, 0)},
            timeline, sources,
            countries: [...byCountry.entries()].map(([country, value]) => ({country, ...value})).sort((a, b) => b.failed - a.failed || b.ok - a.ok),
        });
    }));

    router.get("/attempts", handle(async (req, res) => {
        const days = period(req.query.days);
        const result = text(req.query.result);
        if (result !== undefined && result !== "ok" && result !== "failed") {
            throw new ValidationError("The result is ok or failed.");
        }
        const {page, pageSize, limit, offset} = paging(req);
        const {rows, total} = await repo.attempts({since: new Date(Date.now() - days * 24 * 60 * 60 * 1000), result, ip: text(req.query.ip)}, limit, offset);
        res.json({
            items: rows.map((row) => {
                const place = row.ip ? locate(row.ip) : null;
                return {...row, country: place?.country ?? null, city: place?.city ?? ""};
            }),
            total, page, pageSize,
        });
    }));

    return router;
}
