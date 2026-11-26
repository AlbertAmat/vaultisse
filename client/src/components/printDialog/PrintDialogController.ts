import { ref, Ref, ShallowRef, shallowRef } from "vue";
import jsPDF from "jspdf";
import {api} from "@/plugins/api";
import {appSnackbarController, SnackbarType} from "@/components/appSnackbar/AppSnackbarController";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

/** A single queued printable barcode label. */
export interface PrintLabelItem {
    /** Book name printed alongside the barcode. */
    name: string;
    /** Rendered barcode canvas (see `BookStock.generateBarcodeImage()`). */
    label: HTMLCanvasElement;
    /** Book cover image URL/data-URI, or null if the book has none. */
    imageUrl: string | null;
}

/**
 * Controller class for managing a print dialog in a Vue application.
 * Handles visibility, compact mode, label management, and PDF printing.
 */
export class PrintDialogController {

    /**
     * Tracks whether the print dialog is visible or not.
     * @private
     */
    private m_visible: Ref<boolean> = ref(false);

    /**
     * Stores the canvas elements for each label keyed by name.
     * Uses ShallowRef to avoid deep reactivity on canvas elements (improves performance).
     * @private
     */
    private m_labels: ShallowRef<Record<string, PrintLabelItem>> = shallowRef({});

    /**
     * Checks if the dialog is currently visible.
     * @returns {boolean} true if visible, false otherwise
     */
    public isVisible() {
        return this.m_visible.value;
    }

    /**
     * Checks if the dialog is currently visible.
     * @returns {boolean} true if visible, false otherwise
     */
    public setVisible(value: boolean) {
        this.m_visible.value = value;
    }

    /**
     * Returns all the label canvases currently stored.
     * @returns {Record<string, HTMLCanvasElement>} object containing label canvases
     */
    public getLabels(): Record<string, PrintLabelItem> {
        return this.m_labels.value;
    }

    /**
     * Returns the total number of labels stored.
     * @returns {number} count of label canvases
     */
    public getTotalLabels(): number {
        return Object.keys(this.m_labels.value).length;
    }

    /**
     * Adds a new label canvas to the collection.
     * @param name Book name to print alongside the barcode.
     * @param code Stock code, used as the dedupe key (a label already queued
     * for this code is rejected with a warning snackbar).
     * @param label Canvas element representing the rendered barcode label.
     * @param imageUrl Book cover image URL/data-URI, or null if none.
     */
    public addLabel(name: string, code: string, label: HTMLCanvasElement, imageUrl: string | null) {
        if(Object.keys(this.m_labels.value).includes(code)) {
            console.warn("label already exist");
            appSnackbarController.show({
                message: i18n.global.t(AppLabels.SNACKBAR_PRINT_LABEL_ALREADY_ADDED),
                type: SnackbarType.ERROR
            })
            return;
        }

        this.m_labels.value[code] = {name: name, label: label, imageUrl: imageUrl};
        // Trigger reactivity update by replacing the object with a shallow copy
        this.m_labels.value = { ...this.m_labels.value };

        appSnackbarController.show({
            message:  i18n.global.t(AppLabels.SNACKBAR_PRINT_LABEL_ADDED)
        })
    }

    /**
     * Removes a single queued label by its stock code.
     * @param code Stock code of the label to remove (the key used in `addLabel`).
     */
    public removeLabel(code: string) {
        const labels = { ...this.m_labels.value };
        delete labels[code];
        this.m_labels.value = labels;
    }

    /**
     * Generates a PDF containing all the stored label canvases and prompts download.
     * Each label is scaled to fit a single A4 page while maintaining aspect ratio.
     */
    public print() {
        if (this.getTotalLabels() === 0) {
            console.log("No labels to print");
            return;
        }

        const labels: PrintLabelItem[] = Object.values(this.m_labels.value);

        const pdf = new jsPDF({
            orientation: "landscape",
            unit: "pt",
            format: "a4"
        });

        labels.forEach((item: PrintLabelItem, index) => {
            const imgData = item.label.toDataURL("image/png");
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();

            // Scale the canvas to fit the page while keeping the aspect ratio
            const imgProps = pdf.getImageProperties(imgData);
            const ratio = Math.min(pageWidth / imgProps.width, pageHeight / imgProps.height);
            const imgWidth = imgProps.width * ratio;
            const imgHeight = imgProps.height * ratio;

            // Center the image on the page
            const x = (pageWidth - imgWidth) / 2;
            const y = (pageHeight - imgHeight) / 2;

            pdf.addImage(imgData, "PNG", x, y, imgWidth, imgHeight);

            // Add a new page for each label except the last
            if (index < labels.length - 1) {
                pdf.addPage();
            }
        });

        // Prompt the user to download the PDF
        pdf.save("labels.pdf");
        // Not awaited: the PDF is already saved, and a failure shows the usual error dialog.
        api.books.markLabelsPrinted(Object.keys(this.m_labels.value))
            .catch((e) => console.error("Error while recording printed labels", e));
        this.cancel();
    }

    /**
     * Resets the dialog state: hides it, exits mini mode, and clears all labels.
     */
    public cancel() {
        this.m_visible.value = false;
        this.m_labels.value = {};
    }
}

/** Singleton instance shared by every part of the app. */
export const printDialogController = new PrintDialogController();