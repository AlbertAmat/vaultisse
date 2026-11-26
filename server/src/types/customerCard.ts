/** What a vault prints on every library card besides the customer's own data. */
export interface CardSettingsFields {
    field1_label: string | null;
    field1_value: string | null;
    field2_label: string | null;
    field2_value: string | null;
}

/** One customer's card data as stored. */
export interface CustomerCardRow {
    id: number;
    uuid: string;
    name: string;
    group_name: string | null;
    /** YYYY-MM-DD */
    member_since: string;
    photo: Buffer | null;
}
