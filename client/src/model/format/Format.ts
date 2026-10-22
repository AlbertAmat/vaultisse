import {IFormat} from "@vaultisse/types/format/IFormat";

/** View model for a book format (e.g. "Paperback"). Read-only - formats are managed globally, not per-user. */
export default class Format {

    /** Format id. */
    public readonly m_formatId: number;

    /** Format display name. */
    public readonly m_formatName: string;

    /** @param data Raw format data from the server. */
    public constructor(data: IFormat) {
        this.m_formatId = data.id;
        this.m_formatName = data.name;
    }

    /** @returns The format id. */
    public getFormatId(): number {
        return this.m_formatId;
    }

    /** @returns The format's display name. */
    public getFormatName(): string {
        return this.m_formatName;
    }
}
