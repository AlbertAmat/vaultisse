/**
 * View model for a single physical copy of a book (a `book_stocks` row):
 * its status/location/customer, plus generating a printable barcode label
 * for it. Always tied to the owning `ABook` instance (needed to print the
 * book's name alongside the barcode).
 *
 * @example
 * const stock = book.getStocks()[0];
 * const canvas = stock.generateBarcodeImage();
 * await stock.update(BookStockStatusEnum.BOOKED, locationId, customerId);
 */
import {BookStockStatusEnum, IBookStock} from "@/types/book/IBookStock";
import {IBorrower} from "@/types/book/IBorrower";
import JsBarcode from "jsbarcode";
import {bookService} from "@/service/book/BookService";
import {ref, Ref} from "vue";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import jsPDF from "jspdf";
import ABook from "@/model/book/ABook";

export default class BookStock {

    /** Display label + color for each `BookStockStatusEnum` value, for status chips/selects. */
    public static BookStockStatus = [
        {
            /** The status this entry describes. */
            value: BookStockStatusEnum.BOOKED,
            /** Localized display text for this status. */
            text: i18n.global.t(AppLabels.BOOKED),
            /** Chip/badge color for this status. */
            color: "#3F51B5"
        },
        {
            value: BookStockStatusEnum.AVAILABLE,
            text: i18n.global.t(AppLabels.AVAILABLE),
            color: "#4CAF50"
        },
        {
            value: BookStockStatusEnum.NOT_AVAILABLE,
            text: i18n.global.t(AppLabels.NOT_AVAILABLE),
            color: "#607D8B"
        },
        {
            value: BookStockStatusEnum.DAMAGE,
            text: i18n.global.t(AppLabels.DAMAGE),
            color: "#FF5722"
        },
    ]

    /** The book this stock belongs to (needed to print its name on the barcode label). */
    private readonly m_book: ABook;

    /** The book stock id. */
    private readonly m_id: number;

    /** Unique code identifying this stock (scannable/typeable). */
    private readonly m_code: string;

    /** Current lifecycle status. */
    private m_status: Ref<BookStockStatusEnum>;

    /** Id of the location this stock is stored at, or null if none. */
    private m_locationId: Ref<number | null>;

    /** Name of the location this stock is stored at, or null if none. */
    private m_locationName: string | null;

    /** Id of the customer this stock is loaned/booked to, or null if none. */
    private m_customerId: Ref<number | null>;

    /** Id of the vault member this stock is loaned/booked to (instead of a customer), or null if none. */
    private m_memberUserId: Ref<number | null>;

    /** Name of the customer or vault member this stock is loaned/booked to, or null if none. */
    private m_customerName: string | null;

    /**
     * @param book Owning book (used to print its name on the barcode label).
     * @param stock Raw stock data from the server.
     */
    public constructor(book: ABook, stock: IBookStock) {
        this.m_book = book;
        this.m_id = stock.id;
        this.m_code = stock.code;
        this.m_status = ref(stock.status);

        this.m_locationId = ref(stock.location_id);
        this.m_locationName = stock.location_name;

        this.m_customerId = ref(stock.customer_id);
        this.m_memberUserId = ref(stock.member_user_id ?? null);
        this.m_customerName = stock.customer_name;
    }

    /** @returns The stock id. */
    public getId(): number {
        return this.m_id;
    }

    /** @returns The stock's unique code. */
    public getCode(): string {
        return this.m_code
    }

    /** @returns The stock's current status. */
    public getStatus(): BookStockStatusEnum {
        return this.m_status.value;
    }

    /** @returns The id of the location this stock is stored at, or null if none. */
    public getLocationId(): number | null {
        return this.m_locationId.value;
    }

    /** @returns The name of the location this stock is stored at, or null if none. */
    public getLocationName(): string | null {
        return this.m_locationName;
    }

    /** @returns The id of the customer this stock is loaned/booked to, or null if none. */
    public getCustomerId(): number | null {
        return this.m_customerId.value;
    }

    /** @returns The user id of the vault member this stock is loaned/booked to, or null if none. */
    public getMemberUserId(): number | null {
        return this.m_memberUserId.value;
    }

    /** @returns The name of the customer or vault member this stock is loaned/booked to, or null if none. */
    public getCustomerName(): string | null {
        return this.m_customerName;
    }

    /**
     * Render a CODE128 barcode of this stock's code onto a canvas, with the
     * book name and code printed below it - used for the printable labels
     * in `PrintDialog.vue`.
     * @returns A canvas containing the rendered barcode + label text.
     */
    public generateBarcodeImage(): HTMLCanvasElement {
        // Create a barcode-only canvas
        const barcodeCanvas = document.createElement('canvas');
        JsBarcode(barcodeCanvas, this.m_code, {
            format: "CODE128",
            displayValue: false,
            width: 4,
            height: 150,
            margin: 20
        });

        // Prepare final canvas with extra space for text
        const paddingBottom = 30; // space for description
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = barcodeCanvas.width;
        finalCanvas.height = barcodeCanvas.height + paddingBottom;

        const ctx = finalCanvas.getContext('2d');
        if (!ctx) return finalCanvas;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

        // Draw barcode on top of white background
        ctx.drawImage(barcodeCanvas, 0, 0);

        // Add black text below barcode
        ctx.font = "30px Arial";
        ctx.fillStyle = "#000000";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const yPos = barcodeCanvas.height + paddingBottom / 2;
        ctx.fillText(`${this.m_book.getName()} : ${this.m_code}`, finalCanvas.width / 2, yPos);

        // return finalCanvas.toDataURL("image/png");
        return finalCanvas;
    }

    /**
     * Persist a new status/location/borrower for this stock and sync local reactive state.
     * @param status New status.
     * @param locationId New location id.
     * @param borrower New customer or vault member (both null to clear it).
     */
    public async update(status: BookStockStatusEnum, locationId: number, borrower: IBorrower) {
        try {
            const data = await bookService.updateBookStock(this.m_book.getId(), this.m_id, status, locationId, borrower);
            this.m_status.value = data.status;
            this.m_locationId.value = data.location_id;
            this.m_locationName = data.location_name;
            this.m_customerId.value = data.customer_id;
            this.m_memberUserId.value = data.member_user_id ?? null;
            this.m_customerName = data.customer_name;

            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_BOOK_STOCK_UPDATED)})
        } catch (e) {
            console.error("Error while updating book stock", e)
        }
    }

}
