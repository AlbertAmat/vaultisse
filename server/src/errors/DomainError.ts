/**
 * Typed errors a service layer throws for expected business-rule failures
 * (not found, name already taken, bad input, ...), as opposed to unexpected
 * failures (DB connection drop, bug) that fall through to a route's generic
 * 500 handler. Controllers catch `DomainError` and map `httpStatus` straight
 * to the response - see server/src/controllers/*.
 */
export abstract class DomainError extends Error {
    abstract readonly httpStatus: number;

    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

/** The requested resource doesn't exist, or doesn't belong to the caller. */
export class NotFoundError extends DomainError {
    readonly httpStatus = 404;
}

/** The request conflicts with existing state - e.g. a unique-constraint violation (pg 23505). */
export class ConflictError extends DomainError {
    readonly httpStatus = 409;
}

/** The request body/params fail a business-rule check the DB itself doesn't enforce. */
export class ValidationError extends DomainError {
    readonly httpStatus = 400;
}

/** The caller is authenticated but not allowed to perform this action. */
export class ForbiddenError extends DomainError {
    readonly httpStatus = 403;
}

/** Re-authentication (password/code) failed - e.g. wrong current password on a change-password/delete-account/disable-2FA flow, or a bad TOTP code. Distinct from ForbiddenError: this is "prove who you are again", not "you're not allowed to do this". */
export class UnauthorizedError extends DomainError {
    readonly httpStatus = 401;
}

/** The request is well-formed but the specific state/value it asks for isn't allowed here - e.g. creating a stock as already-booked. */
export class NotAcceptableError extends DomainError {
    readonly httpStatus = 406;
}
