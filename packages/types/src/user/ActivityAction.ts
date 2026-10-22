/**
 * Auth events written to the `activity_log` table (`activity_log.action`) and
 * returned by `GET /user/activity`. The server's filter for that endpoint reads
 * `Object.values(ActivityAction)` rather than duplicating this list. The DB
 * column itself is a plain VARCHAR with no CHECK constraint.
 *
 * @example
 * if (entry.action === ActivityAction.LOGIN_FAILED) { ... }
 */
export enum ActivityAction {
    LOGIN = "login",
    LOGIN_FAILED = "login_failed",
    LOGOUT = "logout",
    PASSWORD_CHANGED = "password_changed",
}
