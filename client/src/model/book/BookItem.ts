import ABook from "@/model/book/ABook";
import IBookItem from "@vaultisse/types/book/IBookItem";

/**
 * Lightweight book view model backing search results/lists, where the
 * fields on `ABook` are enough and the heavier `Book` detail model isn't needed.
 */
export default class BookItem extends ABook {
    public constructor(data: IBookItem) {
        super(data);
    }
}
