import ILanguage from "@vaultisse/types/language/ILanguage";
import {ref, Ref} from "vue";

/** View model for a language option. Read-only - languages are managed globally, not per-user. */
export default class Language {
    /** 2-letter language code. */
    private readonly m_languageCode: string;

    /** Language display name. */
    private readonly m_languageName: string;

    /** @param data Raw language data from the server. */
    public constructor(data: ILanguage) {
        this.m_languageCode = data.code;
        this.m_languageName = data.name;
    }

    /** @returns The 2-letter language code. */
    public getLanguageCode(): string {
        return this.m_languageCode;
    }

    /** @returns The language's display name. */
    public getLanguageName(): string {
        return this.m_languageName;
    }
}
