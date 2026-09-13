/**
 * =============================================================================
 * AppRoute
 * =============================================================================
 * Mounted at `/api/rest/app`. General application-level endpoints: a public
 * health check, and the "policy" bootstrap payload the client fetches once
 * on login to hydrate its dropdowns/labels/locale.
 */
import { Router, Request, Response } from 'express';
import {appService} from "../AppService";
import {requireAuth} from "../middlewares/AuthMiddleware";

const router = Router();

/**
 * GET /app/version
 * ------------------
 * Health check / version probe. Unauthenticated so it can be used by
 * container orchestrators and uptime monitors.
 *
 * Example response (200): { "version": "0.1.2", "uptime": 12345.6 }
 */
router.get('/version', (req: Request, res: Response) => {
    res.json({
        version: process.env.APP_VERSION || "dev",
        uptime: process.uptime(),
    });
});

/**
 * GET /app/policy
 * ------------------
 * Bootstrap payload fetched once after login: the current user's profile
 * plus every reference list (categories, languages, formats, locations,
 * customers) and UI label translations needed to render the app. Each
 * section is fetched independently and defaults to `[]`/`{}` on failure so
 * one failing query doesn't take down the whole app shell.
 *
 * Auth: required.
 *
 * Example response (200):
 *  {
 *    "user": { "code": "jdoe", "name": "Jane Doe", "email": "jane@example.com",
 *               "language": "en", "region": "US", "image": null, "isPublicInstitution": false,
 *               "leasingEnabled": false, "totpEnabled": false, "securityNoticeAccepted": false,
 *               "termsOfServiceAccepted": false },
 *    "categories": [{ "id": 3, "name": "Fantasy" }],
 *    "languages": [{ "code": "en", "name": "English" }],
 *    "formats": [{ "id": 1, "name": "Paperback" }],
 *    "locations": [{ "id": 2, "name": "Main shelf", "description": "" }],
 *    "customers": [{ "id": 7, "name": "Jane Doe" }],
 *    "labels": { "app.title": "Vaultisse" },
 *    "maxImportFileSizeMb": 10
 *  }
 */
// @ts-ignore
router.get('/policy', requireAuth, async (req: Request, res: Response) => {
    const userId = appService.getSessionUser(req)

    let categories: Record<string, any>[] = [];
    let languages: Record<string, any>[] = [];
    let formats: Record<string, any>[] = [];
    let locations: Record<string, any>[] = [];
    let customers: Record<string, any>[] = [];
    let appLabels: Record<string, string> = {};

    try {
        categories = await getCategories(userId);
    } catch (e) {
        console.error("Error when getting categories. ", e)
    }

    try {
        languages = await getLanguages();
    } catch (e) {
        console.error("Error when getting languages. ", e)
    }

    try {
        formats = await getFormats();
    } catch (e) {
        console.error("Error when getting formats. ", e)
    }

    try {
        locations = await getLocations(userId);
    } catch (e) {
        console.error("Error when getting locations. ", e)
    }

    try {
        customers = await getCustomers(userId);
    } catch (e) {
        console.error("Error when getting customers. ", e)
    }

    try {
        appLabels = await getAppLabels(userId);
    } catch (e) {
        console.error("Error when getting app labels. ", e)
    }

    const user = await  getUser(userId);

    // Public-institution accounts get a persistent security-measures notice
    // after login until they acknowledge it (see SecurityNoticeDialog.vue).
    // Record that it was sent the first time it's actually going to be
    // shown; ON CONFLICT DO NOTHING makes this a no-op on every later fetch.
    if (user.isPublicInstitution && !user.securityNoticeAccepted) {
        try {
            await recordSecurityNoticeSent(userId);
        } catch (e) {
            console.error("Error recording security notice sent date. ", e)
        }
    }

    // Every account, regardless of isPublicInstitution, must accept the
    // Terms of Service once (see TermsOfServiceDialog.vue). Same
    // record-on-first-serve pattern as the security notice above.
    if (!user.termsOfServiceAccepted) {
        try {
            await recordTermsOfServiceSent(userId);
        } catch (e) {
            console.error("Error recording terms of service sent date. ", e)
        }
    }

    res.status(200).json({
        user,
        categories,
        languages,
        formats,
        locations,
        customers,
        labels: appLabels,
        maxImportFileSizeMb: appService.getMaxImportFileSizeMb(),
    });
});

/** List `{id, name}` for every customer of `userId` - used to populate the policy payload. */
async function getCustomers(userId: number): Promise<Record<string, any>[]> {
    const pool = appService.getDatabasePool();

    const query = `
        SELECT id,
               name
        FROM customers
        WHERE user_id = $1
    `
    // Use a prepared statement to fetch items by name
    appService.getLogger().debug(`executing query: ${query}`);
    const result = await pool.query(query, [userId]);

    // Return the result (found rows)
    return result.rows;
}


/** List `{id, name}` for every category of `userId` - used to populate the policy payload. */
async function getCategories(userId: number): Promise<Record<string, any>[]> {
    const pool = appService.getDatabasePool();

    const query = `
        SELECT id,
               name
        FROM categories
        WHERE user_id = $1
    `
    // Use a prepared statement to fetch items by name
    appService.getLogger().debug(`executing query: ${query}`);
    const result = await pool.query(query, [userId]);

    // Return the result (found rows)
     return result.rows;
}

/** List every `{code, name}` row in the global `languages` table (not user-scoped). */
async function getLanguages(): Promise<Record<string, any>[]> {
    const pool = appService.getDatabasePool();

    const query = `
        SELECT code,
               name
        FROM languages
    `
    // Use a prepared statement to fetch items by name
    appService.getLogger().debug(`executing query: ${query}`);
    const result = await pool.query(query);

    // Return the result (found rows)
    return result.rows;
}

/** List every `{id, name}` row in the global `formats` table (not user-scoped), e.g. "Paperback". */
async function getFormats(): Promise<Record<string, any>[]> {
    const pool = appService.getDatabasePool();

    const query = `
        SELECT id,
               name
        FROM formats
    `
    // Use a prepared statement to fetch items by name
    appService.getLogger().debug(`executing query: ${query}`);
    const result = await pool.query(query);

    // Return the result (found rows)
    return result.rows;
}

/** List `{id, name, description, default}` for every location of `userId` - used to populate the policy payload. */
async function getLocations(userId: number): Promise<Record<string, any>[]> {
    const pool = appService.getDatabasePool();
    const query = `
        SELECT id,
               name,
               description,
               "default"
        FROM locations
        WHERE user_id = $1
        ORDER BY id
    `
    // Use a prepared statement to fetch items by name
    appService.getLogger().debug(`executing query: ${query}`);
    const result = await pool.query(query, [userId]);

    // Return the result (found rows)
    return result.rows;
}

/**
 * Build a `{ labelCode: translatedText }` map for `userId`'s configured
 * `users.language`, from the `app_labels` translation table.
 */
async function getAppLabels(userId: number): Promise<Record<string, string>> {
    const pool = appService.getDatabasePool();
    const query = `
        SELECT app_labels.code, app_labels.text
          FROM app_labels, users
         WHERE users.id = $1
           AND app_labels.language = users.language
    `
    // Use a prepared statement to fetch items by name
    appService.getLogger().debug(`executing query: ${query}`);
    const result = await pool.query(query, [userId]);

    // Return the result (found rows)
    const appLabels: Record<string, string> = {};
    result.rows.forEach((row) => {
        appLabels[row.code] = row.text;
    });

    return appLabels;
}

/**
 * Fetch `userId`'s profile fields, converting the stored `image` bytea (if
 * any) into a `data:image/png;base64,...` URL the client can use directly
 * as an `<img src>`. Throws if the user doesn't exist.
 */
async function getUser(userId: number): Promise<Record<string, any>> {
    const pool = appService.getDatabasePool();

    const query = `
        SELECT u.code,
               u.name,
               u.email,
               u.language,
               u.region,
               u.image,
               u.theme,
               u.sidebar_rail          AS "sidebarRail",
               u.leasing_enabled       AS "leasingEnabled",
               u.is_public_institution AS "isPublicInstitution",
               u.totp_enabled          AS "totpEnabled",
               (sn.accepted_date IS NOT NULL) AS "securityNoticeAccepted",
               (tos.accepted_date IS NOT NULL) AS "termsOfServiceAccepted"
        FROM users u
        LEFT JOIN user_security_notice_acknowledgements sn ON sn.user_id = u.id
        LEFT JOIN user_terms_of_service_acknowledgements tos ON tos.user_id = u.id
        WHERE u.id = $1
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
        throw new Error("User not found");
    }

    const user = result.rows[0];

    if (user.image) {
        // Convert Buffer to base64 string with data URL prefix
        const base64Image = user.image.toString('base64');

        // You can detect the mime type or hardcode it if you know it’s PNG or JPEG
        // For example, assume PNG here:
        user.image = `data:image/png;base64,${base64Image}`;
    } else {
        user.image = null; // or a default image URL/base64 string
    }

    return user;
}

/**
 * Ensures a `user_security_notice_acknowledgements` row exists for `userId`,
 * recording "now" as `sent_date` the first time it's called for that user.
 * `ON CONFLICT DO NOTHING` makes every later call for an already-recorded
 * user a no-op, so `sent_date` always reflects the first time the notice
 * was actually shown.
 */
async function recordSecurityNoticeSent(userId: number): Promise<void> {
    const pool = appService.getDatabasePool();

    await pool.query(
        `INSERT INTO user_security_notice_acknowledgements (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
    );
}

/**
 * Ensures a `user_terms_of_service_acknowledgements` row exists for `userId`,
 * recording "now" as `sent_date` the first time it's called for that user.
 * `ON CONFLICT DO NOTHING` makes every later call for an already-recorded
 * user a no-op, so `sent_date` always reflects the first time the dialog
 * was actually shown.
 */
async function recordTermsOfServiceSent(userId: number): Promise<void> {
    const pool = appService.getDatabasePool();

    await pool.query(
        `INSERT INTO user_terms_of_service_acknowledgements (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
    );
}

export default router;