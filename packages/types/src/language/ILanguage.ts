/**
 * A language option (ISO 639-1 code + display name), from the global `languages` table.
 *
 * @example
 * const l: ILanguage = { code: "en", name: "English" };
 */
export default interface ILanguage {
    /** 2-letter language code. */
    code: string;
    /** Language display name. */
    name: string;
}
