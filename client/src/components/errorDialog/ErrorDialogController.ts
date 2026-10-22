/**
 * Global controller backing the single `ErrorDialog.vue` instance mounted
 * in App.vue. The API client's `onError` handler calls
 * `showDialog(error)` for any unhandled server/network error, so the app
 * doesn't need per-call error UI - see `plugins/api.ts`.
 */
import { ref, Ref } from "vue";
import {AxiosError} from "axios";

export class ErrorDialogController {

    /** Whether the dialog is currently visible. */
    private m_visible: Ref<boolean> = ref(false);

    /** The error currently displayed, or null if none. */
    private m_error: AxiosError | null = null;

    /** @returns Whether the dialog is currently visible. */
    public isVisible(): boolean {
        return this.m_visible.value;
    }

    /** @param value New visibility. */
    public setVisible(value: boolean) {
        this.m_visible.value = value;
    }

    /** @returns The error currently displayed, or null if none. */
    public getError(): AxiosError | null {
        return this.m_error;
    }

    /**
     * Store the error and make the dialog visible.
     * @param error The axios error to display.
     */
    public showDialog(error: AxiosError) {
        this.m_error = error;
        this.m_visible.value = true;
    }
}

/** Singleton instance shared by every part of the app. */
export const errorDialogController = new ErrorDialogController();
