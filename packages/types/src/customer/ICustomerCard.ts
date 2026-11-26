/** What a vault prints on every library card, besides the customer's own data. */
export interface ICardSettings {
    field1_label: string | null;
    field1_value: string | null;
    field2_label: string | null;
    field2_value: string | null;
    /** Background image as a data URI, or null. */
    background: string | null;
}

/** One customer's card data. */
export interface ICustomerCard {
    id: number;
    /** What the card's barcode carries. */
    uuid: string;
    name: string;
    group_name: string | null;
    /** YYYY-MM-DD */
    member_since: string;
    /** Photo as a data URI, or null. */
    photo: string | null;
}

/** What scanning a card shows. */
export interface ICardActivity {
    customer: ICustomerCard;
    loans: {code: string; name: string; loaned_at: string | null}[];
    history: {stock_code: string; book_name: string; loaned_at: string; returned_at: string | null}[];
}
