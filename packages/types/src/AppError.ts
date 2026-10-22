/**
 * Application-specific error codes the client checks against HTTP response
 * statuses/bodies to show a tailored error state instead of a generic one.
 *
 * @example
 * if (AppErrorsList.includes(status)) { showNotFoundState(); }
 */
export enum AppError {
    BOOK_NOT_FOUND = 404
}

/** All known `AppError` values, handy for membership checks (see example above). */
export const AppErrorsList = [AppError.BOOK_NOT_FOUND]
