/**
 * Blocks an address by itself once it keeps failing to sign in.
 *
 * It watches failed logins (users, locked accounts and admin logins) per address in a sliding window and,
 * when one address reaches the threshold, adds it to the IP blocklist for a while, records it in the audit
 * trail and tells the admins. Off by default.
 *
 * Because a wrong block would lock real people out, it never blocks:
 *  - private, loopback or link-local addresses (behind Docker or a reverse proxy without TRUST_PROXY every
 *    visitor shows up as one such address, and blocking it would block everybody);
 *  - an address from which somebody signed in successfully in the last 24 hours (a shared office address);
 *  - an address on the admin IP allowlist.
 */
import net from "net";
import {Pool} from "pg";
import {appService} from "../../AppService";
import {Logger} from "../../utils/Logger";
import {SecurityEventType, SecurityRepository} from "../repositories/SecurityRepository";
import {findSetting} from "./settingsCatalog";

const COUNTED: SecurityEventType[] = ["login_failed", "login_locked", "admin_login_failed"];
/**
 * The login limiters cut an address off after a handful of attempts (5 per 5 minutes), so an attacker who keeps
 * hammering mostly produces "rate limited" events rather than more "failed login" ones. Those are the same
 * thing seen from the other side, so they count too - without them a threshold above ~10 could never be reached.
 */
const LOGIN_LIMITERS = new Set(["login", "2fa", "admin-login"]);
const MAX_TRACKED = 10000;
const KNOWN_GOOD_MS = 24 * 60 * 60 * 1000;

/**
 * @param ip Address as reported by Express.
 * @returns Whether it is a public internet address (the only kind that may be blocked automatically).
 *
 * @example
 *   isPublicAddress("8.8.8.8")          // true   (a public internet address: may be blocked)
 *   isPublicAddress("::ffff:203.0.113.5") // true   (IPv4 seen on a dual-stack socket)
 *   isPublicAddress("192.168.1.20")    // false  (private: behind Docker or a proxy every visitor looks like this)
 *   isPublicAddress("127.0.0.1")       // false
 */
export function isPublicAddress(ip: string): boolean {
    const address = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
    const kind = net.isIP(address);
    if (kind === 4) {
        const [a, b] = address.split(".").map(Number);
        return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
    }
    if (kind === 6) {
        const lower = address.toLowerCase();
        return !(lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower) || lower.startsWith("ff"));
    }
    return false;
}

/** Counts failed logins per address and blocks the persistent offenders. */
export class AutoBlocker {
    private readonly failures = new Map<string, number[]>();
    private readonly security: SecurityRepository;
    private readonly deciding = new Set<string>();

    /**
     * @param pool Database pool.
     * @param logger Server logger.
     * @param enabled Whether the admin portal is on.
     */
    public constructor(pool: Pool, private readonly logger: Logger, private readonly enabled: boolean) {
        this.security = new SecurityRepository(pool);
    }

    private number(key: string): number {
        const raw = appService.getSettings().get(key);
        const value = Number(raw === undefined || raw === "" ? findSetting(key)?.defaultValue : raw);
        return Number.isFinite(value) && value > 0 ? value : Number(findSetting(key)?.defaultValue);
    }

    /** @returns Whether automatic blocking is switched on. */
    public isOn(): boolean {
        const raw = appService.getSettings().get("ADMIN_AUTOBLOCK_ENABLED");
        return this.enabled && (raw === undefined || raw === "" ? "false" : raw) === "true";
    }

    /**
     * Called for every security event; counts the failed logins.
     * @param type What happened.
     * @param ip Address it came from.
     * @param detail Extra context of the event (which limiter, for a rate-limit hit).
     */
    public observe(type: SecurityEventType, ip: string | undefined, detail?: string): void {
        const counts = COUNTED.includes(type) || (type === "rate_limited" && detail !== undefined && LOGIN_LIMITERS.has(detail));
        if (!this.enabled || !ip || !counts || !this.isOn()) {
            return;
        }
        const now = Date.now();
        const windowMs = this.number("ADMIN_AUTOBLOCK_WINDOW_MIN") * 60 * 1000;
        const list = this.failures.get(ip) ?? [];
        list.push(now);
        while (list.length > 0 && list[0] < now - windowMs) {
            list.shift();
        }
        if (!this.failures.has(ip) && this.failures.size >= MAX_TRACKED) {
            return;
        }
        this.failures.set(ip, list);
        if (list.length >= this.number("ADMIN_AUTOBLOCK_THRESHOLD") && !this.deciding.has(ip)) {
            this.deciding.add(ip);
            void this.decide(ip, list.length).finally(() => this.deciding.delete(ip));
        }
    }

    /**
     * Blocks the address unless one of the safeguards applies.
     * @param ip Address.
     * @param count Failed logins counted.
     * @returns Whether it was blocked.
     */
    public async decide(ip: string, count: number): Promise<boolean> {
        try {
            if (!isPublicAddress(ip) || appService.getBlockedIps().isBlocked(ip) || appService.getAdminConfig().allowedIps.includes(ip)) {
                this.failures.delete(ip);
                return false;
            }
            if (await this.security.hasRecentSuccessfulLogin(ip, KNOWN_GOOD_MS)) {
                this.failures.delete(ip);
                return false;
            }
            const hours = this.number("ADMIN_AUTOBLOCK_HOURS");
            const windowMin = this.number("ADMIN_AUTOBLOCK_WINDOW_MIN");
            const reason = `Automatic: ${count} failed or refused logins in ${windowMin} minutes`;
            await this.security.blockIp(ip, reason, null, new Date(Date.now() + hours * 60 * 60 * 1000), true);
            this.failures.delete(ip);
            await appService.getBlockedIps().refresh();
            this.logger.warn(`Automatically blocked ${ip} for ${hours}h: ${reason}`);
            await appService.getAdminAudit().recordAs("security.auto_block", {id: null, email: null}, ip, {
                entityType: "ip", entityLabel: ip, metadata: {failedLogins: count, windowMinutes: windowMin, hours},
            });
            void appService.getNotifier().notify("security", {
                title: `An address was blocked automatically: ${ip}`,
                lines: [`${ip} failed to sign in ${count} times within ${windowMin} minutes and is blocked for ${hours} hours.`, "You can unblock it earlier under Security > Blocked addresses."],
                event: "ip.blocked",
                dedupeKey: "autoblock",
                cooldownMs: 30 * 60 * 1000,
            });
            return true;
        } catch (error) {
            this.logger.error(`Automatic blocking of ${ip} failed: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
}
