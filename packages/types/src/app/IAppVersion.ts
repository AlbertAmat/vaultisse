/**
 * Response shape for `GET /app/version` (see server/src/routes/AppRoute.ts).
 *
 * @example
 * const v: IAppVersion = {version: "1.1.7", uptime: 12345.6};
 */
export default interface IAppVersion {
    /** Running server's `APP_VERSION` (Docker build arg), or "dev" outside a built image. */
    version: string;
    /** Server process uptime in seconds. */
    uptime: number;
}
