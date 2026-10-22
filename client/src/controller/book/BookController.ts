/**
 * Backs the book detail view: reads the `book_id` route param, loads that
 * book, and exposes it as a `Book` model instance.
 */
import {BaseController} from "@/controller/BaseController";
import IBook from "@vaultisse/types/book/IBook";
import Book from "@/model/book/Book";
import {api} from "@/plugins/api";
import router from "@/router/Router";
import {shallowRef, ShallowRef} from "vue";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

export default class BookController extends BaseController<IBook>{

    /** The currently loaded book, or an empty placeholder before load completes. */
    private m_book: ShallowRef<Book> = shallowRef(Book.empty());

    public constructor() {
        super(i18n.global.t(AppLabels.BOOK));
    }

    /** @returns The book matching the current route's `book_id` param, fetched from the server. */
    async fetchData(): Promise<IBook> {
        const bookId = Number(router.currentRoute.value.params.book_id);
        return await api.books.getBook(bookId);
    }

    /** @param data Raw book detail data from the server. */
    setData(data: IBook): void {
        this.m_book.value = new Book(data);
    }

    /** @returns Whether a book has been loaded. */
    public hasBook(): boolean {
        return this.m_book.value != null;
    }

    /** @returns The currently loaded book. */
    public getBook(): Book {
        return this.m_book.value;
    }
}
