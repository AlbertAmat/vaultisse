export interface CustomerGroup {
    id: number;
    name: string;
    description: string | null;
}

export interface CustomerGroupWithCount extends CustomerGroup {
    /** COUNT(c.id)::int in SQL - a genuine number, not bigint-as-string. */
    total_customers: number;
}

export interface Customer {
    id: number;
    name: string;
    group_id: number | null;
    group_name: string | null;
}

export interface CustomerWithLoanCount extends Customer {
    /** Plain COUNT(*) subquery - pg serializes bigint as a string, not a number. */
    total_books: string;
}

export interface CustomerLoanedBook {
    id: number;
    name: string;
    image_url: string | null;
    isbn: string | null;
    code: string;
}
