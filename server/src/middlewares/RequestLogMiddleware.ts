/**
 * =============================================================================
 * RequestLogMiddleware
 * =============================================================================
 * Writes one line to the server log for every API request that ends in an
 * error status (4xx -> WARN, 5xx -> ERROR), so a failed 2FA code, a rejected
 * upload, a validation error or a crash can be traced afterwards. Successful
 * requests are not logged (that would be an access log; see DEBUG_LOGGING).
 *
 * Each line carries the method, path (query string dropped - it can hold
 * OIDC codes or search terms), status, duration, client IP, the user id when
 * the request had a valid session, the active vault, and the error message
 * the server sent back. Request bodies are never logged (passwords, 2FA codes).
 */
import {NextFunction, Request, Response} from "express";
import {appService} from "../AppService";

/**
 * Pulls the human-readable error out of a response body: `{error}` or `{message}`
 * JSON, or a plain-text body.
 * @param body Whatever was passed to `res.json()` / `res.send()`.
 * @returns The message, or undefined if the body doesn't carry one.
 */
function extractErrorMessage(body: unknown): string | undefined {
    if (typeof body === "string") {
        // res.json() hands us the already-serialized string on some paths.
        try {
            return extractErrorMessage(JSON.parse(body)) ?? body.slice(0, 300);
        } catch {
            return body.slice(0, 300);
        }
    }
    if (body && typeof body === "object") {
        const {error, message} = body as {error?: unknown; message?: unknown};
        if (typeof error === "string") {
            return error;
        }
        if (typeof message === "string") {
            return message;
        }
    }
    return undefined;
}

/**
 * Resolves the session's user id without ever throwing - requests that fail
 * before login (wrong password, 2FA step) simply have none.
 * @param req Express request.
 * @returns The user id, or undefined.
 */
function sessionUserId(req: Request): number | undefined {
    try {
        return appService.getSessionUser(req);
    } catch {
        return undefined;
    }
}

/**
 * Express middleware: logs error responses once they have been sent.
 * @param req Express request.
 * @param res Express response.
 * @param next Next handler.
 */
export function logFailedRequests(req: Request, res: Response, next: NextFunction): void {
    const startedAt = Date.now();
    let errorMessage: string | undefined;

    // Capture the message the handler sends, then pass the call through unchanged.
    const originalJson = res.json.bind(res);
    res.json = (body?: unknown) => {
        errorMessage = extractErrorMessage(body);
        return originalJson(body);
    };
    const originalSend = res.send.bind(res);
    res.send = (body?: unknown) => {
        errorMessage ??= extractErrorMessage(body);
        return originalSend(body);
    };

    res.on("finish", () => {
        if (res.statusCode < 400) {
            return;
        }
        const userId = sessionUserId(req);
        const parts = [
            `${req.method} ${req.originalUrl.split("?")[0]}`,
            `-> ${res.statusCode}`,
            `(${Date.now() - startedAt}ms)`,
            `ip=${req.ip}`,
            `user=${userId ?? "-"}`,
            `vault=${req.vaultId ?? "-"}`,
        ];
        const line = `${parts.join(" ")}${errorMessage ? ` | ${errorMessage}` : ""}`;
        if (res.statusCode >= 500) {
            appService.getLogger().error(line);
        } else {
            appService.getLogger().warn(line);
        }
    });

    next();
}
