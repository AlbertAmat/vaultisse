/**
 * =============================================================================
 * LocationRoute
 * =============================================================================
 * Mounted at `/api/rest/location`. CRUD for physical storage "locations"
 * (shelves, rooms, warehouses, ...) and moving book stocks between them.
 * All routes require auth and are scoped to the caller's `user_id`.
 */
import {Router, Request, Response} from 'express';
import {requireAuth} from "../middlewares/AuthMiddleware";
import {appService} from "../AppService";
import {Pool} from "pg";

const router = Router();

/**
 * GET /location
 * -------------
 * List every location the user owns, with a `total_books` count of stocks
 * currently placed there.
 *
 * Auth: required.
 *
 * Example response (200):
 *  [{ "id": 2, "name": "Main shelf", "description": "Front room", "default": true, "total_books": 14 }]
 */
// @ts-ignore
router.get('', requireAuth, async (req: Request, res: Response) => {
    const pool = appService.getDatabasePool();
    const client = await pool.connect();
    const userId = appService.getSessionUser(req);

    try {
        const result = await client.query(`
            SELECT id,
                   name,
                   description,
                   "default",
                   (SELECT COUNT(*) FROM book_stocks WHERE book_stocks.location_id = locations.id) total_books
            FROM locations
            WHERE user_id = $1
            ORDER BY id
        `, [userId]);
        res.status(200).json(result.rows);
    } catch (err: any) {
        console.error('Error executing query', err.stack);
        res.status(500).send('Internal Server Error');
    } finally {
        client.release();
    }
});

/**
 * GET /location/:id/books
 * ------------------------
 * List the books currently stocked at a location.
 *
 * Auth: required. Path param `id` {number} - location id.
 *
 * Example response (200):
 *  [{ "id": 5, "name": "The Hobbit", "book_id": 12, "code": "a1b2c3d4e5",
 *     "status": 0, "image_url": "https://..." }]
 */
// @ts-ignore
router.get('/:id/books', requireAuth, async (req: Request, res: Response) => {
    const locationId = Number(req.params.id);
    if (!locationId) {
        return res.status(400).send('No location ID provided');
    }
    const pool = appService.getDatabasePool();
    const userId = appService.getSessionUser(req);

    try {
        const locationBooks = await getLocationBooks(pool, locationId, userId);
        res.status(200).json(locationBooks);
    } catch (err: any) {
        console.error('Error executing query', err.stack);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * POST /location/:id/add/books
 * ------------------------------
 * Move a batch of book stocks into this location (by scanning/typing their
 * stock codes) - e.g. after physically moving books between shelves.
 *
 * Auth: required. Path param `id` {number} - destination location id.
 * Body: { "books": ["a1b2c3d4e5", "f6g7h8i9j0"] }  // array of book_stocks.code
 *
 * Example response (200): the updated list of books now at this location
 * (same shape as GET /location/:id/books).
 *
 * Response (404): "Location does not exist".
 */
// @ts-ignore
router.post('/:id/add/books', requireAuth, async (req: Request, res: Response) => {
    const locationId = Number(req.params.id);
    const books: string[] = req.body.books;

    if (!locationId) {
        return res.status(400).send('No location ID provided');
    }

    if (!Array.isArray(books) || books.length === 0) {
        return res.status(400).send('No books provided');
    }

    const pool = appService.getDatabasePool();
    const userId = appService.getSessionUser(req);

    try {
        const exist = await existLocation(pool, locationId, userId);
        if (!exist) {
            return res.status(404).send('Location does not exist');
        }

        for (const bookStockCode of books) {
            await pool.query(
                'UPDATE book_stocks SET location_id = $1 WHERE code = $2 AND user_id = $3',
                [locationId, bookStockCode, userId]
            );
        }

        const locationBooks = await getLocationBooks(pool, locationId, userId);

        res.status(200).json(locationBooks);
    } catch (err: any) {
        console.error('Error adding books to a location', err.stack);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * POST /location
 * ---------------
 * Create a new location.
 *
 * Auth: required.
 * Body: { "name": "Main shelf", "description": "Front room" }
 *
 * Example response (200): { "id": 2, "name": "Main shelf", "description": "Front room", "default": false, "total_books": 0 }
 */
// @ts-ignore
router.post('', requireAuth, async (req: Request, res: Response) => {
    const name = req.body.name;
    const description = req.body.description;

    const pool = appService.getDatabasePool();
    const client = await pool.connect();
    const userId = appService.getSessionUser(req);

    try {
        appService.getLogger().debug(`Adding location with name ${name}`);
        const insertLocation = await client.query(
            "INSERT INTO locations (name, description, user_id) VALUES ($1, $2, $3) RETURNING id",
            [name, description, userId]
        );

        // fetch new data
        const result = await pool.query(`
            SELECT locations.id,
                   locations.name,
                   locations.description,
                   locations."default",
                   (SELECT COUNT(*) FROM book_stocks WHERE book_stocks.location_id = locations.id) total_books
            FROM locations
            WHERE locations.id = ${insertLocation.rows[0].id}
              AND locations.user_id = $1
        `, [userId])

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error("Transaction error:", error);
        res.status(500).send("Error adding the location");
    } finally {
        client.release();
    }
});


/**
 * PUT /location/:id
 * -------------------
 * Rename/update a location's description.
 *
 * Auth: required. Path param `id` {number}. Body: { "name": "...", "description": "..." }
 *
 * Example response (200): the updated location row (same shape as GET /location).
 */
// @ts-ignore
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
    const locationId = req.params.id;
    if (!locationId) {
        return res.status(400).send('No location ID provided');
    }

    const userId = appService.getSessionUser(req);

    // Body params
    const {
        name,
        description
    } = req.body;

    const pool = appService.getDatabasePool();

    try {
        appService.getLogger().debug(`Updating location ${locationId}`);

        const queryResult = await pool.query(
            'UPDATE locations SET name = $1, description = $2 WHERE id = $3 AND user_id = $4',
            [name, description, locationId, userId]
        );

        if (queryResult.rowCount != 1) {
            return res.status(500).send();
        }

        const locationQueryResult = await pool.query(
            `SELECT locations.id,
                    locations.name,
                    locations.description,
                    locations."default",
                    (SELECT COUNT(*) FROM book_stocks WHERE book_stocks.location_id = locations.id) total_books
             FROM locations
             WHERE locations.id = $1
               AND locations.user_id = $2
            `,
            [locationId, userId]
        );

        res.status(200).json(locationQueryResult.rows[0]);
    } catch (error) {
        // Rollback on error
        console.error("Transaction error:", error);
        res.status(500).send("Error updating the location");
    }
});

/**
 * PUT /location/:id/default
 * ---------------------------
 * Mark a location as the user's default one (pre-filled when adding a new
 * book stock), clearing the flag from whichever location previously had it.
 *
 * Auth: required. Path param `id` {number}.
 *
 * Example response (200): every location the user owns, same shape as
 * `GET /location`, reflecting the new default.
 *
 * Response (404): "Location does not exist".
 */
// @ts-ignore
router.put('/:id/default', requireAuth, async (req: Request, res: Response) => {
    const locationId = Number(req.params.id);
    if (!locationId) {
        return res.status(400).send('No location ID provided');
    }

    const pool = appService.getDatabasePool();
    const client = await pool.connect();
    const userId = appService.getSessionUser(req);

    try {
        const exist = await existLocation(pool, locationId, userId);
        if (!exist) {
            return res.status(404).send('Location does not exist');
        }

        appService.getLogger().debug(`Setting location ${locationId} as default`);

        await client.query('BEGIN');
        await client.query('UPDATE locations SET "default" = FALSE WHERE user_id = $1', [userId]);
        await client.query('UPDATE locations SET "default" = TRUE WHERE id = $1 AND user_id = $2', [locationId, userId]);
        await client.query('COMMIT');

        const result = await pool.query(`
            SELECT id,
                   name,
                   description,
                   "default",
                   (SELECT COUNT(*) FROM book_stocks WHERE book_stocks.location_id = locations.id) total_books
            FROM locations
            WHERE user_id = $1
            ORDER BY id
        `, [userId]);

        res.status(200).json(result.rows);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Transaction error:", error);
        res.status(500).send("Error setting the default location");
    } finally {
        client.release();
    }
});

/**
 * DELETE /location/:id
 * ----------------------
 * Delete a location.
 *
 * Auth: required. Path param `id` {number}.
 *
 * Responses: 200 {"message": "Location deleted successfully"} | 404 {"error": "Location not found"}.
 */
// @ts-ignore
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
    const id = Number(req.params.id);

    // Database connection
    const pool = appService.getDatabasePool();
    const client = await pool.connect();

    const userId = appService.getSessionUser(req);

    try {
        // Validate the existence of the book
        const locationCheck = await client.query('SELECT id FROM locations WHERE id = $1 AND user_id = $2', [id, userId]);
        if (locationCheck.rowCount === 0) {
            return res.status(404).send({error: "Location not found"});
        }

        await client.query('DELETE FROM locations WHERE id = $1 AND user_id = $2', [id, userId]);

        res.send({message: "Location deleted successfully"});
    } catch (e) {
        console.error("Error while deleting location", e);
        res.status(500).send('Internal Server Error');
    } finally {
        client.release();
    }
});

/** Whether location `locationId` exists and belongs to `userId`. */
async function existLocation(pool: Pool, locationId: number, userId: number): Promise<boolean> {
    const queryResult = await pool.query(
        'SELECT id FROM locations WHERE id = $1 AND user_id = $2',
        [locationId, userId]
    );

    return queryResult.rowCount == 1;
}

/** Fetch the books (with stock code/status) currently stored at `locationId`. */
async function getLocationBooks(pool: Pool, locationId: number, userId: number) {
    const result = await pool.query(`
            SELECT book_stocks.id,
                   books.name,
                   books.id as book_id,
                   book_stocks.code,
                   book_stocks.status,
                   books.image_url
            FROM book_stocks,
                 books
            WHERE book_stocks.location_id = $1
              AND book_stocks.book_id = books.id
              AND book_stocks.user_id = $2
        `, [locationId, userId]);

    return result.rows;
}

export default router;