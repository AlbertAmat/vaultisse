/**
 * `Location` extended with its book count and (lazily loaded) list of
 * stocked books, used on the locations list/detail views.
 */
import Location from "@/model/location/Location";
import ILocationExt from "@vaultisse/types/location/ILocationExt";
import {locationsService} from "@/service/locations/LocationsService";
import LocationBook from "@/model/location/LocationBook";
import {shallowRef, ShallowRef} from "vue";
import ILocationBook from "@vaultisse/types/location/ILocationBook";

export default class LocationExt extends Location{

    /** Total number of book stocks at this location. */
    private readonly m_totalBooks: number;

    /** Books stocked at this location, populated by `fetchBooks()`/`setBooks()`. */
    private m_books: ShallowRef<LocationBook[]> = shallowRef([]);

    /** @param location Raw extended location data from the server. */
    public constructor(location: ILocationExt) {
        super(location);
        this.m_totalBooks = location.total_books;
    }

    /** @returns The total number of book stocks at this location. */
    public getTotalBooks(): number {
        return this.m_totalBooks;
    }

    /** @returns The books currently stocked at this location. */
    public getBooks(): LocationBook[] {
        return this.m_books.value;
    }

    /**
     * Replace the local books list from raw data (e.g. after a batch move).
     * @param books Raw location-book data from the server.
     */
    public setBooks(books: ILocationBook[]) {
        this.m_books.value = books.map((book) => new LocationBook(book));
    }

    /** Fetch and cache this location's books from the server. */
    public async fetchBooks() {
        const books = await locationsService.getLocationBooks(this.m_id);
        this.m_books.value = books.map((book) => new LocationBook(book));
    }
}
