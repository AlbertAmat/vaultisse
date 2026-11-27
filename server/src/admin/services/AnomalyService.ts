/**
 * Spots unusual activity and tells the admins (email and webhooks).
 *
 *  - An admin signing in from a country that admin has never used before (checked at every admin sign-in).
 *  - Users signing in from a country nobody has signed in from in the last 180 days (checked hourly).
 *  - A burst of new accounts: more than ADMIN_NOTIFY_ANOMALY_SIGNUPS_PER_HOUR within an hour (checked hourly).
 *
 * Countries come from the same offline location database as the login map, so only public addresses can be
 * placed. Nothing is raised on a fresh installation that has no history to compare with.
 */
import {Pool} from "pg";
import {appService} from "../../AppService";
import {Logger} from "../../utils/Logger";
import {findSetting} from "./settingsCatalog";
import {locate} from "./GeoLocator";

const DAY = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 180;
const MAX_ADDRESSES = 20000;

const regionNames = new Intl.DisplayNames(["en"], {type: "region"});
/** @returns The English name of a country code. */
/**
 * Example:
 *   countryName("GB") // "United Kingdom"
 *   countryName("JP") // "Japan"
 */
export function countryName(code: string): string {
    try {
        return regionNames.of(code) ?? code;
    } catch {
        return code;
    }
}

/** Raises anomaly alerts. */
export class AnomalyService {
    /**
     * @param pool Database pool.
     * @param logger Server logger.
     */
    public constructor(private readonly pool: Pool, private readonly logger: Logger) {
    }

    /**
     * Called after an admin signs in.
     * @param admin The admin.
     * @param ip Address of the sign-in.
     * @param startedAt When this sign-in began (sessions before it are the history).
     */
    public async adminSignedIn(admin: {id: number; email: string}, ip: string | undefined, startedAt: Date): Promise<void> {
        try {
            const place = ip ? locate(ip) : null;
            if (!ip || !place) return;
            const previous = await this.pool.query(
                "SELECT DISTINCT ip_address FROM admin_sessions WHERE admin_id = $1 AND ip_address IS NOT NULL AND created_date < $2 LIMIT 500", [admin.id, startedAt]);
            const known = new Set<string>();
            for (const row of previous.rows) {
                const country = locate(row.ip_address)?.country;
                if (country) known.add(country);
            }
            if (known.size === 0 || known.has(place.country)) return;
            const name = countryName(place.country);
            await appService.getAdminAudit().recordAs("admin.login_new_country", {id: admin.id, email: admin.email}, ip, {entityType: "admin", entityId: admin.id, entityLabel: admin.email, metadata: {country: place.country}});
            await appService.getNotifier().notify("anomaly", {
                title: `Admin ${admin.email} signed in from a new country: ${name}`,
                lines: [`Address ${ip}${place.city ? `, near ${place.city}` : ""}.`, `Until now this admin only signed in from: ${[...known].map(countryName).join(", ")}.`, "If this wasn't them, end the session under Admins > Sessions and reset their two-factor."],
                dedupeKey: `admin-country:${admin.id}:${place.country}`,
                cooldownMs: 30 * DAY,
                event: "admin.login_new_country",
            });
        } catch (error) {
            this.logger.error(`New-country check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private signupThreshold(): number {
        const raw = appService.getSettings().get("ADMIN_NOTIFY_ANOMALY_SIGNUPS_PER_HOUR");
        const value = Number(raw === undefined || raw === "" ? findSetting("ADMIN_NOTIFY_ANOMALY_SIGNUPS_PER_HOUR")?.defaultValue : raw);
        return Number.isFinite(value) && value > 0 ? value : 20;
    }

    /** Hourly: looks for sign-ins from new countries and for a burst of sign-ups. */
    public async check(): Promise<void> {
        await this.checkCountries().catch((e) => this.logger.error(`Country anomaly check failed: ${e instanceof Error ? e.message : String(e)}`));
        await this.checkSignups().catch((e) => this.logger.error(`Sign-up anomaly check failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    private async checkCountries(): Promise<void> {
        const recentSince = new Date(Date.now() - 70 * 60 * 1000);
        const recent = await this.pool.query(
            "SELECT metadata->>'ip' AS ip, COUNT(*)::int AS logins FROM activity_log WHERE action = 'login' AND created_date >= $1 AND metadata->>'ip' IS NOT NULL GROUP BY 1 LIMIT $2", [recentSince, MAX_ADDRESSES]);
        if (recent.rowCount === 0) return;
        const older = await this.pool.query(
            "SELECT DISTINCT metadata->>'ip' AS ip FROM activity_log WHERE action = 'login' AND created_date < $1 AND created_date >= $2 AND metadata->>'ip' IS NOT NULL LIMIT $3",
            [recentSince, new Date(Date.now() - HISTORY_DAYS * DAY), MAX_ADDRESSES]);
        const known = new Set<string>();
        for (const row of older.rows) {
            const country = locate(row.ip)?.country;
            if (country) known.add(country);
        }
        // Nothing to compare with yet: on a young installation every country would look new.
        if (known.size === 0) return;
        const fresh = new Map<string, {logins: number; ip: string}>();
        for (const row of recent.rows) {
            const country = locate(row.ip)?.country;
            if (!country || known.has(country)) continue;
            const entry = fresh.get(country) ?? {logins: 0, ip: row.ip};
            entry.logins += row.logins;
            fresh.set(country, entry);
        }
        for (const [country, entry] of fresh) {
            await appService.getNotifier().notify("anomaly", {
                title: `Sign-ins from a new country: ${countryName(country)}`,
                lines: [`${entry.logins} sign-in${entry.logins === 1 ? "" : "s"} from ${countryName(country)} in the last hour. Nobody signed in from there in the last ${HISTORY_DAYS} days.`, "Open the Login map in the console to see where, and Logs > Sign-ins for the accounts."],
                dedupeKey: `country:${country}`,
                cooldownMs: 14 * DAY,
            });
        }
    }

    private async checkSignups(): Promise<void> {
        const threshold = this.signupThreshold();
        const count = (await this.pool.query("SELECT COUNT(*)::int AS n FROM users WHERE created_date >= NOW() - INTERVAL '1 hour'")).rows[0].n;
        if (count < threshold) return;
        await appService.getNotifier().notify("anomaly", {
            title: `A burst of new accounts: ${count} in the last hour`,
            lines: [`${count} accounts were created in the last hour (the alert starts at ${threshold}).`, "This can be a bot. Consider turning on approval for new accounts (Settings > Registration) or closing registration."],
            dedupeKey: "signup-burst",
            cooldownMs: 3 * 60 * 60 * 1000,
        });
    }
}
