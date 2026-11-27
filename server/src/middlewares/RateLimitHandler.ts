/**
 * `handler` for express-rate-limit limiters: answers 429 exactly like the library's default, and also
 * notes the hit as a security event so the admin portal's security page can show who is being limited.
 */
import {NextFunction, Request, Response} from "express";
import {Options} from "express-rate-limit";
import {appService} from "../AppService";

/**
 * @param limiter Short name of the limiter, kept as the event's detail (e.g. "login").
 * @returns A handler to pass as the limiter's `handler` option.
 */
export function rateLimited(limiter: string) {
    return (req: Request, res: Response, _next: NextFunction, options: Options): void => {
        appService.getSecurityEvents().record("rate_limited", req, limiter);
        res.status(options.statusCode).send(options.message);
    };
}
