<template>
	<v-btn
		@click="dialog = true"
		class="text-none"
		small
		variant="tonal"
		color="primary"
	>
		{{t(AppLabels.RETURN_BOOKS)}}
	</v-btn>
	<book-stock-codes-dialog
		v-model="dialog"
		:loading="loading"
		:title="t(AppLabels.RETURN_BOOKS)"
		:action-text="t(AppLabels.RETURN)"
		@execute-action="returnBooks"
	/>
</template>

<script setup lang="ts">
/**
 * "Return books" button + dialog (shown on the dashboard and loans
 * views): wraps `BookStockCodesDialog` to bulk-return a scanned/typed batch
 * of book stock codes via `api.books.returnBooks`, then emits `refresh`
 * so the parent can reload its data.
 */
import {ref, Ref} from "vue";
import BookStockCodesDialog from "@/components/addBookStocks/BookStockCodesDialog.vue";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {useI18n} from "vue-i18n";
import {api} from "@/plugins/api";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";

const {t} = useI18n();

const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void
	(e: 'refresh'): void
}>()

const dialog: Ref<boolean> = ref(false);

/**
 *
 */
const loading: Ref<boolean> = ref(false);

/**
 *
 * @param books
 */
async function returnBooks(books: string[]) {
	try {
		loading.value = true;
		await api.books.returnBooks(books);
		appSnackbarController.show({message: t(AppLabels.SNACKBAR_RETURN_BOOKS)})
		emit('refresh')
	} finally {
		loading.value = false;
		dialog.value = false;
	}
}
</script>