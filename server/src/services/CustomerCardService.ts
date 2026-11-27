/**
 * Business rules for library cards: the card's printed content, and the
 * card-scan screen (a customer's loans, history, and lending by scan).
 */
import {Pool} from "pg";
import {CustomerCardRepository} from "../repositories/CustomerCardRepository";
import {CustomerRepository} from "../repositories/CustomerRepository";
import {LoanHistoryRepository} from "../repositories/LoanHistoryRepository";
import {VaultRepository} from "../repositories/VaultRepository";
import {withTransaction} from "../repositories/withTransaction";
import {CardSettingsFields, CustomerCardRow} from "../types/customerCard";
import {ConflictError, ForbiddenError, NotFoundError, ValidationError} from "../errors/DomainError";
import {FileSignature} from "../utils/FileSignature";

/** Longest label/value that still fits on a card (matches the column sizes). */
const MAX_LABEL = 30;
const MAX_VALUE = 60;

/** Business rules for library cards. Calls CustomerCardRepository and friends; throws DomainError subclasses for expected failures. */
export class CustomerCardService {
    /**
     * @param pool Database connection pool, forwarded to fresh repositories on every call.
     */
    public constructor(private readonly pool: Pool) {
    }

    /**
     * Turns stored image bytes into a data URI.
     * @param image PNG or JPEG bytes, or null.
     * @returns The data URI, or null.
     */
    private dataUri(image: Buffer | null): string | null {
        const mime = image ? FileSignature.imageMime(image) : null;
        return image && mime ? `data:${mime};base64,${image.toString("base64")}` : null;
    }

    /**
     * Resolves an image form field into what to store.
     * @param upload Uploaded bytes, if any.
     * @param remove Whether the current image should be removed.
     * @returns New bytes, null to remove, or undefined to keep.
     * @throws ValidationError if the upload isn't really a PNG or JPEG.
     */
    private imageChange(upload: Buffer | undefined, remove: boolean): Buffer | null | undefined {
        if (upload) {
            if (!FileSignature.imageMime(upload)) {
                throw new ValidationError("Only PNG or JPG images are allowed");
            }
            return upload;
        }
        return remove ? null : undefined;
    }

    /**
     * Converts a stored card row to the response shape.
     * @param row Card row.
     * @param photosAllowed False for a public institution, which never gets a stored photo back.
     * @returns The card, with the photo as a data URI.
     */
    private toCard(row: CustomerCardRow, photosAllowed: boolean) {
        return {...row, photo: photosAllowed ? this.dataUri(row.photo) : null};
    }

    /**
     * Whether customer photos may be used.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @returns False for a public institution.
     */
    private async photosAllowed(vaultId: number, userId: number): Promise<boolean> {
        return !(await new CustomerCardRepository(this.pool).isPublicInstitution(vaultId, userId));
    }

    /**
     * Reads a vault's card settings.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @returns The two fields and background (all null when never set up), and whether cards carry photos.
     */
    public async getSettings(vaultId: number, userId: number) {
        const row = await new CustomerCardRepository(this.pool).findSettings(vaultId);
        return {
            field1_label: row?.field1_label ?? null,
            field1_value: row?.field1_value ?? null,
            field2_label: row?.field2_label ?? null,
            field2_value: row?.field2_value ?? null,
            background: this.dataUri(row?.background ?? null),
            photos_allowed: await this.photosAllowed(vaultId, userId),
        };
    }

    /**
     * Saves a vault's card settings.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @param body Form fields; blank values are stored as empty.
     * @param background Uploaded background, if any.
     * @param removeBackground Whether to drop the current background.
     * @returns The saved settings.
     * @throws ValidationError on a too-long field or a bad image.
     */
    public async saveSettings(vaultId: number, userId: number, body: Record<string, unknown>, background: Buffer | undefined, removeBackground: boolean) {
        const read = (name: keyof CardSettingsFields, max: number): string | null => {
            const value = typeof body[name] === "string" ? (body[name] as string).trim() : "";
            if (value.length > max) {
                throw new ValidationError(`${name} can't be longer than ${max} characters`);
            }
            return value || null;
        };
        const fields: CardSettingsFields = {
            field1_label: read("field1_label", MAX_LABEL),
            field1_value: read("field1_value", MAX_VALUE),
            field2_label: read("field2_label", MAX_LABEL),
            field2_value: read("field2_value", MAX_VALUE),
        };
        await new CustomerCardRepository(this.pool).saveSettings(vaultId, fields, this.imageChange(background, removeBackground));
        return this.getSettings(vaultId, userId);
    }

    /**
     * Reads one customer's card.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @param customerId Customer id.
     * @returns The card.
     * @throws NotFoundError if the customer isn't in this vault.
     */
    public async getCard(vaultId: number, userId: number, customerId: number) {
        const row = await new CustomerCardRepository(this.pool).findCard(vaultId, {id: customerId});
        if (!row) {
            throw new NotFoundError("Customer not found");
        }
        return this.toCard(row, await this.photosAllowed(vaultId, userId));
    }

    /**
     * Updates a customer's photo and/or member-since date.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @param customerId Customer id.
     * @param memberSince YYYY-MM-DD, or undefined/empty to keep it.
     * @param photo Uploaded photo, if any.
     * @param removePhoto Whether to drop the current photo.
     * @returns The updated card.
     * @throws ValidationError on a bad date or image, ForbiddenError on a photo upload by a public institution, NotFoundError if the customer isn't in this vault.
     */
    public async updateCard(vaultId: number, userId: number, customerId: number, memberSince: unknown, photo: Buffer | undefined, removePhoto: boolean) {
        if (photo && !(await this.photosAllowed(vaultId, userId))) {
            throw new ForbiddenError("Public institutions can't store customer photos");
        }

        let date: string | undefined;
        if (typeof memberSince === "string" && memberSince) {
            const parsed = new Date(`${memberSince}T00:00:00Z`);
            // The round trip rejects impossible dates such as 2026-02-31.
            if (!/^\d{4}-\d{2}-\d{2}$/.test(memberSince) || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== memberSince) {
                throw new ValidationError("Invalid member-since date");
            }
            date = memberSince;
        }
        const updated = await new CustomerCardRepository(this.pool).updateCard(vaultId, customerId, date, this.imageChange(photo, removePhoto));
        if (!updated) {
            throw new NotFoundError("Customer not found");
        }
        return this.getCard(vaultId, userId, customerId);
    }

    /**
     * Everything the card-scan screen shows.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @param row The customer's card row.
     * @returns The card, current loans and history.
     */
    private async activity(vaultId: number, userId: number, row: CustomerCardRow) {
        const repo = new CustomerCardRepository(this.pool);
        const [loans, history] = await Promise.all([repo.listLoans(vaultId, row.id), repo.listHistory(vaultId, row.id)]);
        return {customer: this.toCard(row, await this.photosAllowed(vaultId, userId)), loans, history};
    }

    /**
     * Resolves a scanned card.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @param code The barcode content: the customer's uuid, with or without hyphens.
     * @returns The card, current loans and history.
     * @throws NotFoundError if it isn't a card of this vault.
     */
    public async scan(vaultId: number, userId: number, code: string) {
        const hex = code.trim().replace(/-/g, "").toLowerCase();
        const row = /^[0-9a-f]{32}$/.test(hex) ? await new CustomerCardRepository(this.pool).findCard(vaultId, {uuid: hex}) : null;
        if (!row) {
            throw new NotFoundError("Card not found");
        }
        return this.activity(vaultId, userId, row);
    }

    /**
     * Lends one scanned copy to a customer. Unlike the batch lend, only an
     * available copy is accepted, so a scan can never take over a loan.
     * @param vaultId Vault id.
     * @param userId Caller's id.
     * @param customerId Customer id.
     * @param code Scanned stock code.
     * @returns The card, current loans and history.
     * @throws ValidationError if loans are off or no code was sent, NotFoundError for an unknown customer or copy, ConflictError if the copy isn't available.
     */
    public async lend(vaultId: number, userId: number, customerId: number, code: unknown) {
        if (typeof code !== "string" || !code.trim()) {
            throw new ValidationError("No book code provided");
        }
        if (!(await new VaultRepository(this.pool).isLoansEnabled(vaultId))) {
            throw new ValidationError("Loans are not enabled in this vault");
        }
        const row = await new CustomerCardRepository(this.pool).findCard(vaultId, {id: customerId});
        if (!row) {
            throw new NotFoundError("Customer not found");
        }

        const stockCode = code.trim();
        await withTransaction(this.pool, async (client) => {
            const status = await new CustomerCardRepository(client).lockStockStatus(vaultId, stockCode);
            if (status === null) {
                throw new NotFoundError("Book copy not found");
            }
            if (status !== 0) {
                throw new ConflictError(status === 2 ? "This copy is already on loan" : "This copy is not available");
            }
            await new CustomerRepository(client).lendBookStock(customerId, vaultId, stockCode);
            await new LoanHistoryRepository(client).recordLoan(vaultId, stockCode, customerId);
        });

        return this.activity(vaultId, userId, row);
    }
}
