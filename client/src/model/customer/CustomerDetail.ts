/**
 * `Customer` extended with its (lazily loaded) list of loaned books, used
 * on the customer detail view/dialog.
 */
import {Ref, ref, ShallowRef, shallowRef} from "vue";
import ICustomer, {ICustomerDetail} from "@vaultisse/types/customer/ICustomer";
import {customersService} from "@/service/customers/CustomersService";
import {ICustomerBook} from "@vaultisse/types/customer/ICustomerBook";
import {CustomerBook} from "@/model/customer/CustomerBook";
import Customer from "@/model/customer/Customer";

export default class CustomerDetail extends Customer {

    /** Number of books currently on loan to this customer. */
    private readonly m_totalBooks: Ref<number>;

    /** Books currently on loan to this customer, populated by `fetchBooks()`/`setBooks()`. */
    private m_books: ShallowRef<CustomerBook[]>;

    /** @param data Raw customer detail data from the server. */
    public constructor(data: ICustomerDetail) {
        super(data);
        this.m_totalBooks = ref(data.total_books);
        this.m_books = shallowRef([]);
    }

    /** @returns The number of books currently on loan to this customer. */
    public getTotalBooks(): number {
        return this.m_totalBooks.value;
    }

    /** @returns The books currently on loan to this customer. */
    public getBooks(): CustomerBook[] {
        return this.m_books.value;
    }

    /**
     * Replace the local loaned-books list from raw data.
     * @param books Raw customer-book data from the server.
     */
    public setBooks(books: ICustomerBook[]) {
        this.m_books.value = books.map((book) => new CustomerBook(book));
    }

    /** Fetch and cache this customer's currently loaned books from the server. */
    public async fetchBooks() {
        const books = await customersService.getCustomerBooks(this.m_customerId);
        this.m_books.value = books.map((book) => new CustomerBook(book));
        this.m_totalBooks.value =  this.m_books.value.length;
    }

    /**
     * Return a single loaned book on the server and remove it from the local list.
     * @param bookStockCode Stock code of the book being returned.
     */
    public async removeBook(bookStockCode: string) {
        await customersService.removeCustomerBook(this.m_customerId, bookStockCode);

        const index = this.m_books.value.findIndex((books) => books.getStockCode() === bookStockCode);
        if(index != -1) {
            this.m_books.value.splice(index, 1);
            this.m_books.value = [...this.m_books.value];
            this.m_totalBooks.value = this.m_totalBooks.value -1;
        }
    }
}
