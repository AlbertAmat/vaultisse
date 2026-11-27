/**
 * Map of where people sign in from (mounted at `/api/admin/map`).
 *
 *  GET /logins   ?days=7|30|90|365
 *      The sign-ins of the regular users and the failed attempts of the period, placed on the map by IP address.
 *      Nearby addresses that resolve to the same place are merged into one point.
 *
 * Locations come from an offline database (see GeoLocator): nothing is sent to an outside service. A point shows
 * how many sign-ins and how many different accounts, never who they are. Private and local addresses (Docker, a
 * reverse proxy without TRUST_PROXY) have no place and are only counted.
 */
import {Router} from "express";
import {Pool} from "pg";
import {ValidationError} from "../../errors/DomainError";
import {handle} from "../http";
import {geoAvailable, locate} from "../services/GeoLocator";

const PERIODS = [7, 30, 90, 365];
const MAX_ADDRESSES = 5000;

interface Point {
    lat: number;
    lon: number;
    city: string;
    region: string;
    country: string;
    logins: number;
    accounts: number;
    failed: number;
    addresses: number;
    lastLogin: string | null;
}

/**
 * @param pool Database pool.
 * @returns The router.
 */
export function mapRoutes(pool: Pool): Router {
    const router = Router();

    router.get("/logins", handle(async (req, res) => {
        const days = req.query.days === undefined ? 30 : Number(req.query.days);
        if (!PERIODS.includes(days)) {
            throw new ValidationError(`The period must be one of ${PERIODS.join(", ")} days.`);
        }
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const [good, bad] = await Promise.all([
            pool.query(
                `SELECT metadata->>'ip' AS ip, COUNT(*)::int AS logins, COUNT(DISTINCT actor_id)::int AS accounts, MAX(created_date) AS last
                   FROM activity_log WHERE action = 'login' AND created_date >= $1 AND metadata->>'ip' IS NOT NULL
                  GROUP BY 1 ORDER BY logins DESC LIMIT ${MAX_ADDRESSES}`, [since]),
            pool.query(
                `SELECT ip_address AS ip, SUM(count)::int AS failed FROM security_events
                  WHERE type IN ('login_failed', 'login_locked', 'admin_login_failed') AND bucket >= $1
                  GROUP BY 1 ORDER BY failed DESC LIMIT ${MAX_ADDRESSES}`, [since]),
        ]);

        const points = new Map<string, Point>();
        const seen = new Map<string, Set<string>>();
        let located = 0;
        let unlocated = 0;
        let loginsTotal = 0;
        let failedTotal = 0;
        const add = (ip: string, logins: number, accounts: number, failed: number, last: Date | null) => {
            const place = locate(ip);
            if (!place) {
                unlocated += logins + failed;
                return;
            }
            located += logins + failed;
            const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
            const point = points.get(key) ?? {lat: place.lat, lon: place.lon, city: place.city, region: place.region, country: place.country, logins: 0, accounts: 0, failed: 0, addresses: 0, lastLogin: null};
            point.logins += logins;
            // Distinct accounts can't be summed across addresses without double counting; the maximum is a safe floor.
            point.accounts = Math.max(point.accounts, accounts);
            point.failed += failed;
            const ips = seen.get(key) ?? new Set<string>();
            ips.add(ip);
            seen.set(key, ips);
            point.addresses = ips.size;
            if (last && (!point.lastLogin || last.toISOString() > point.lastLogin)) {
                point.lastLogin = last.toISOString();
            }
            points.set(key, point);
        };
        for (const row of good.rows) {
            loginsTotal += row.logins;
            add(row.ip, row.logins, row.accounts, 0, row.last);
        }
        for (const row of bad.rows) {
            failedTotal += row.failed;
            add(row.ip, 0, 0, row.failed, null);
        }

        const countries = new Map<string, {logins: number; failed: number}>();
        for (const point of points.values()) {
            const entry = countries.get(point.country) ?? {logins: 0, failed: 0};
            entry.logins += point.logins;
            entry.failed += point.failed;
            countries.set(point.country, entry);
        }
        res.json({
            available: geoAvailable(),
            days,
            points: [...points.values()].sort((a, b) => b.logins + b.failed - (a.logins + a.failed)),
            countries: [...countries.entries()].map(([country, value]) => ({country, ...value})).sort((a, b) => b.logins + b.failed - (a.logins + a.failed)),
            totals: {logins: loginsTotal, failed: failedTotal, located, unlocated, truncated: good.rowCount === MAX_ADDRESSES || bad.rowCount === MAX_ADDRESSES},
        });
    }));

    return router;
}
