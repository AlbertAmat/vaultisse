/**
 * One of the current user's active login sessions, as returned by
 * `GET /user/sessions` (see server/src/routes/UserRoute.ts). Device info
 * isn't parsed server-side - `userAgent` is shown as-is so the client can
 * classify/format it with full i18n context (see DeviceInfo.ts).
 *
 * @example
 * const s: IUserSession = {
 *   id: 12, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/128.0",
 *   ipAddress: "203.0.113.4", createdDate: "2026-09-01T10:00:00.000Z",
 *   lastSeenDate: "2026-09-03T18:05:00.000Z", isCurrent: true
 * };
 */
export default interface IUserSession {
    /** DB id - pass to `DELETE /user/sessions/:id` to revoke this session. */
    id: number;
    /** Raw `User-Agent` header captured at login, or null if none was sent. */
    userAgent: string | null;
    /** Client IP captured at login, or null. */
    ipAddress: string | null;
    /** When this session was created (ISO string). */
    createdDate: string;
    /** Last time this session was seen active (ISO string). */
    lastSeenDate: string;
    /** Whether this is the session the request was made with. */
    isCurrent: boolean;
}
