/**
 * How long an admin password may be used: ADMIN_PASSWORD_MAX_AGE_DAYS (default 60, 0 = never expires) and how many days
 * before that the admin is reminded every day, ADMIN_PASSWORD_WARN_DAYS (default 5). Both are portal settings
 * (Settings > Admin portal) and environment variables; the portal wins.
 */
import {appService} from "../../AppService";
import {findSetting} from "./settingsCatalog";

export interface PasswordPolicy {
    /** A password older than this many days must be replaced; 0 = passwords never expire. */
    maxAgeDays: number;
    /** From this many days before the end, remind the admin every day. */
    warnDays: number;
}

const read = (key: string): number => {
    const raw = appService.getSettings().get(key);
    const value = Number(raw === undefined || raw === "" ? findSetting(key)?.defaultValue : raw);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : Number(findSetting(key)?.defaultValue ?? 0);
};

/**
 * @returns The password policy now in force.
 * @example
 *   // ADMIN_PASSWORD_MAX_AGE_DAYS=90, ADMIN_PASSWORD_WARN_DAYS=7  ->  {maxAgeDays: 90, warnDays: 7}
 *   // nothing set                                                 ->  {maxAgeDays: 60, warnDays: 5}
 */
export function passwordPolicy(): PasswordPolicy {
    return {maxAgeDays: read("ADMIN_PASSWORD_MAX_AGE_DAYS"), warnDays: read("ADMIN_PASSWORD_WARN_DAYS")};
}
