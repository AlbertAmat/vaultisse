export interface Location {
    id: number;
    name: string;
    description: string | null;
    default: boolean;
    /** COUNT(*) subquery result - pg serializes bigint as a string, not a number. */
    total_books: string;
}

export interface LocationBook {
    id: number;
    name: string;
    book_id: number;
    code: string;
    status: number;
    image_url: string | null;
}
