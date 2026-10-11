import {Pool, PoolClient} from "pg";

/** One ebook file attached to a book, as listed in an OPDS entry (no bytes). */
export interface OpdsFile {
    id: number;
    file_type: "epub" | "pdf" | "mobi";
    file_name: string;
    file_size: number;
}

/** One book in an OPDS acquisition feed. */
export interface OpdsBook {
    id: number;
    name: string;
    description: string | null;
    isbn: string | null;
    image_url: string | null;
    publisher: string | null;
    language_code: string | null;
    date_updated: Date;
    authors: string[];
    files: OpdsFile[];
}

/** Data access for the OPDS feed: token lookup/management on `users`, and the read-only book listing. */
export class OpdsRepository {
    /**
     * @param db Pool for a standalone call, or a transaction's checked-out client.
     */
    public constructor(private readonly db: Pool | PoolClient) {
    }

    /**
     * Resolves a feed token's hash to its (active) owner.
     * @param tokenHash SHA-256 hex of the raw token.
     * @returns The user id, or null if no active user has this token.
     */
    public async findUserIdByTokenHash(tokenHash: string): Promise<number | null> {
        const result = await this.db.query(
            "SELECT id FROM users WHERE opds_token_hash = $1 AND disabled = FALSE",
            [tokenHash]
        );
        return result.rows[0]?.id ?? null;
    }

    /**
     * Stores (replacing any previous) or clears a user's feed token hash.
     * @param userId Owning user's id.
     * @param tokenHash SHA-256 hex of the new token, or null to disable the feed.
     */
    public async setTokenHash(userId: number, tokenHash: string | null): Promise<void> {
        await this.db.query("UPDATE users SET opds_token_hash = $2 WHERE id = $1", [userId, tokenHash]);
    }

    /**
     * Whether a user currently has a feed token.
     * @param userId Owning user's id.
     */
    public async hasToken(userId: number): Promise<boolean> {
        const result = await this.db.query("SELECT opds_token_hash IS NOT NULL AS has FROM users WHERE id = $1", [userId]);
        return result.rows[0]?.has === true;
    }

    /**
     * Lists a vault's books that have at least one ebook file, by name.
     * @param vaultId Vault id.
     * @param search Optional case-insensitive match on title, author or ISBN.
     * @param limit Page size.
     * @param offset Rows to skip.
     * @returns The page of books plus the total match count.
     */
    public async listDigitalBooks(vaultId: number, search: string | null, limit: number, offset: number): Promise<{total: number; books: OpdsBook[]}> {
        const params: unknown[] = [vaultId];
        let filter = "";
        if (search) {
            params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
            filter = `AND (b.name ILIKE $2 OR b.isbn ILIKE $2 OR EXISTS (
                          SELECT 1 FROM book_authors ba JOIN authors a ON a.id = ba.author_id
                           WHERE ba.book_id = b.id AND a.name ILIKE $2))`;
        }
        const base = `FROM books b
                     WHERE b.vault_id = $1
                       AND EXISTS (SELECT 1 FROM book_files bf WHERE bf.book_id = b.id AND bf.vault_id = $1)
                       ${filter}`;

        const total = await this.db.query(`SELECT COUNT(*)::int AS count ${base}`, params);
        const rows = await this.db.query(
            `SELECT b.id, b.name, b.description, b.isbn, b.image_url, b.publisher, b.language_code, b.date_updated,
                    COALESCE((SELECT json_agg(a.name ORDER BY a.name)
                                FROM book_authors ba JOIN authors a ON a.id = ba.author_id
                               WHERE ba.book_id = b.id), '[]') AS authors,
                    (SELECT json_agg(json_build_object('id', bf.id, 'file_type', bf.file_type,
                                                       'file_name', bf.file_name, 'file_size', bf.file_size) ORDER BY bf.id)
                       FROM book_files bf WHERE bf.book_id = b.id AND bf.vault_id = $1) AS files
             ${base}
             ORDER BY b.name, b.id
             LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
            params
        );
        return {total: total.rows[0].count, books: rows.rows};
    }
}
