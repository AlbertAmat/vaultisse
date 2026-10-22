/**
 * One row of the current user's recent auth activity (sign-ins, failed
 * sign-ins, sign-outs, password changes), as returned by
 * `GET /user/activity` (see server/src/routes/UserRoute.ts). Backed by the
 * generic `activity_log` table - this endpoint filters to auth events only.
 *
 * @example
 * const a: IActivityLogEntry = {
 *   id: "42", action: "login", metadata: {ip: "203.0.113.4"},
 *   createdDate: "2026-09-03T18:05:00.000Z"
 * };
 */
export default interface IActivityLogEntry {
    /**
     * `activity_log.id` (a Postgres BIGSERIAL) - kept as a string rather
     * than cast to `number` server-side, since a bigint can exceed
     * `Number.MAX_SAFE_INTEGER`. Only used as a list `:key` here, never
     * compared/sorted, so the string form is fine as-is.
     */
    id: string;
    action: "login" | "login_failed" | "logout" | "password_changed";
    /** Free-form context for `action` - e.g. `{ip}`, or `{attemptedUsername}` for a login_failed with no matching account. */
    metadata: Record<string, unknown> | null;
    /** When this happened (ISO string). */
    createdDate: string;
}
