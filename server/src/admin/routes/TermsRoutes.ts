/**
 * Terms-acceptance report (mounted at `/api/admin/terms`): who has accepted the Terms of Service and the
 * security notice, who was asked but hasn't answered, and who hasn't been asked yet.
 *
 *  GET /summary          counts for both documents
 *  GET /list             ?doc=tos|security&status=accepted|pending|never&search=&page=&pageSize=
 *  GET /export.csv       the same filter as a CSV file (every matching row)
 *
 * "Pending" means the app asked (the row exists) and the user hasn't accepted yet; "never" means the account has
 * no row at all, typically because it hasn't signed in since the terms were introduced.
 */
import {Router} from "express";
import {Pool} from "pg";
import {ValidationError} from "../../errors/DomainError";
import {handle, paging, text} from "../http";

type Doc = "tos" | "security";
type Status = "accepted" | "pending" | "never";

const TABLE: Record<Doc, string> = {
    tos: "user_terms_of_service_acknowledgements",
    security: "user_security_notice_acknowledgements",
};
const STATUS_SQL: Record<Status, string> = {
    accepted: "a.accepted_date IS NOT NULL",
    pending: "a.id IS NOT NULL AND a.accepted_date IS NULL",
    never: "a.id IS NULL",
};

/** @returns A cell safe to open in a spreadsheet (no formula injection) and quoted when needed. */
/**
 * Example:
 *   csvCell("Alice")             // Alice
 *   csvCell("Smith, John")       // "Smith, John"      (quoted because of the comma)
 *   csvCell("=HYPERLINK(...)")   // '=HYPERLINK(...)   (a leading = + - @ is neutralised: no formula injection in a spreadsheet)
 */
export function csvCell(value: unknown): string {
    let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@\t\r]/.test(text)) {
        text = `'${text}`;
    }
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function doc(value: unknown): Doc {
    if (value === "security") return "security";
    if (value === undefined || value === "" || value === "tos") return "tos";
    throw new ValidationError("Unknown document.");
}

function status(value: unknown): Status | undefined {
    if (value === undefined || value === "") return undefined;
    if (value === "accepted" || value === "pending" || value === "never") return value;
    throw new ValidationError("Unknown status.");
}

/**
 * @param pool Database pool.
 * @returns The router.
 */
export function termsRoutes(pool: Pool): Router {
    const router = Router();

    const query = (which: Doc, filter: Status | undefined, search: string | undefined, paged: boolean) => {
        const params: unknown[] = [];
        const where = ["TRUE"];
        if (filter) where.push(STATUS_SQL[filter]);
        if (search) {
            params.push(`%${search.replace(/[%_\\]/g, "\\$&")}%`);
            where.push(`(u.code ILIKE $1 OR u.name ILIKE $1 OR u.email ILIKE $1)`);
        }
        const from = `FROM users u LEFT JOIN ${TABLE[which]} a ON a.user_id = u.id WHERE ${where.join(" AND ")}`;
        return {
            params,
            count: `SELECT COUNT(*)::int AS total ${from}`,
            rows: `SELECT u.id, u.code, u.name, u.email, u.disabled, a.sent_date AS "askedDate", a.accepted_date AS "acceptedDate",
                          CASE WHEN a.accepted_date IS NOT NULL THEN 'accepted' WHEN a.id IS NOT NULL THEN 'pending' ELSE 'never' END AS status
                     ${from} ORDER BY (a.accepted_date IS NULL) DESC, u.id${paged ? ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}` : ""}`,
        };
    };

    router.get("/summary", handle(async (_req, res) => {
        const out: Record<string, {accepted: number; pending: number; never: number; total: number}> = {};
        for (const which of ["tos", "security"] as Doc[]) {
            const row = (await pool.query(
                `SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE a.accepted_date IS NOT NULL)::int AS accepted,
                        COUNT(*) FILTER (WHERE a.id IS NOT NULL AND a.accepted_date IS NULL)::int AS pending,
                        COUNT(*) FILTER (WHERE a.id IS NULL)::int AS never
                   FROM users u LEFT JOIN ${TABLE[which]} a ON a.user_id = u.id`
            )).rows[0];
            out[which] = row;
        }
        res.json(out);
    }));

    router.get("/list", handle(async (req, res) => {
        const {page, pageSize, limit, offset} = paging(req);
        const q = query(doc(req.query.doc), status(req.query.status), text(req.query.search), true);
        const total = await pool.query(q.count, q.params);
        const rows = await pool.query(q.rows, [...q.params, limit, offset]);
        res.json({items: rows.rows, total: total.rows[0].total, page, pageSize});
    }));

    router.get("/export.csv", handle(async (req, res) => {
        const which = doc(req.query.doc);
        const q = query(which, status(req.query.status), text(req.query.search), false);
        const rows = (await pool.query(q.rows, q.params)).rows;
        const lines = [["username", "name", "email", "account_disabled", "status", "asked", "accepted"].join(",")];
        for (const row of rows) {
            lines.push([row.code, row.name, row.email, row.disabled, row.status, row.askedDate, row.acceptedDate].map(csvCell).join(","));
        }
        res.set({
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${which === "tos" ? "terms-of-service" : "security-notice"}-acceptance.csv"`,
            "Cache-Control": "no-store",
        });
        res.send(`﻿${lines.join("\r\n")}\r\n`);
    }));

    return router;
}
