<template>
	<card-component
		:title="t(AppLabels.STOCKS)"
		icon="mdi-book-multiple"
		:counter="stocks.length"
	>
		<template v-slot:actions>
			<v-btn
				v-if="canEditCatalog"
				@click="showAddStockDialog"
				density="comfortable"
				color="primary"
				class="text-none"
			>
				{{t(AppLabels.ADD)}}
			</v-btn>
		</template>

		<template v-slot:default>
			<v-data-table
				:key="book.getStocks().length"
				:headers="headers"
				density="compact"
				:items="stocks"
			>

				<template v-slot:item.status="{item}">
					<v-chip
						density="compact"
						variant="outlined"
						:color="item.status_color"
					>
						{{ item.status_text }}
					</v-chip>
				</template>

				<template v-slot:item.actions="{ item }">
					<v-btn
						v-if="canLend && item.status === BookStockStatusEnum.AVAILABLE"
						@click="showLendDialog(item.id)"
						prepend-icon="mdi-account-arrow-right-outline"
						variant="tonal"
						color="primary"
						density="compact"
						class="mx-1 text-none"
					>
						{{t(AppLabels.LEND)}}
					</v-btn>
					<v-btn
						v-if="canLend && item.status === BookStockStatusEnum.BOOKED"
						@click="returnStock(item.id)"
						:loading="returnLoading.includes(item.id)"
						:disabled="returnLoading.includes(item.id)"
						prepend-icon="mdi-keyboard-return"
						variant="outlined"
						density="compact"
						class="mx-1 text-none"
					>
						{{t(AppLabels.RETURN)}}
					</v-btn>
					<v-icon
						v-if="canEditCatalog"
						@click="addToPrintQueue(item.id)"
						small
						class="mx-1"
					>
						mdi-printer-pos-plus-outline
					</v-icon>
					<v-icon
						v-if="canEditCatalog"
						@click="showEditStockDialog(item.id)"
						small
						class="mx-1"
					>
						mdi-pencil
					</v-icon>
					<v-btn
						v-if="canEditCatalog"
						icon
						variant="text"
						density="compact"
						:loading="deleteLoading.includes(item.id)"
						:disabled="deleteLoading.includes(item.id)"
						@click="removeBookStock(item)"
						class="mx-1"
					>
						<v-icon
							size="21"
							color="error"
						>
							mdi-delete
						</v-icon>
					</v-btn>
				</template>
			</v-data-table>

			<book-stock-dialog
				v-if="stockDialog"
				v-model="stockDialog"
				:book="book"
				:stock="selectedStock"
			/>

			<lend-stock-dialog
				v-if="lendDialog && selectedStock"
				v-model="lendDialog"
				:book="book"
				:stock="selectedStock"
			/>
		</template>
	</card-component>
</template>

<script setup lang="ts">
/**
 * Physical stocks table on the book detail view: lists every copy with its
 * code/location/status (with the borrower of a loaned copy), and lets the
 * user lend/return, add/edit/delete a stock or queue its barcode for printing.
 */
import {computed, Ref, ref, ShallowRef, shallowRef} from 'vue'
import Book from "@/model/book/Book";
import BookStock from "@/model/book/BookStock";
import BookStockDialog from "@/views/book/compoents/BookStockDialog.vue";
import LendStockDialog from "@/views/book/compoents/LendStockDialog.vue";
import {BookStockStatusEnum} from "@vaultisse/types/book/IBookStock";
import CardComponent from "@/components/card/CardComponent.vue";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {printDialogController} from "@/components/printDialog/PrintDialogController";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import {applicationService} from "@/service/ApplicationService";

/** Hides add/edit/delete stock actions for roles that can't edit the catalog (readonly, borrower). */
const canEditCatalog = applicationService.canEditCatalog();

/** Lend/Return actions also need loans enabled in the vault. */
const canLend = computed(() => canEditCatalog && applicationService.isLoansEnabled());

interface Props {
	book: Book
}

const props = defineProps<Props>()

const {t} = useI18n();

const headers = computed(() => {
	const cols: {title: string, value: string, align?: string, sortable?: boolean}[] = [
		{
			title: t(AppLabels.CODE),
			align: 'start',
			sortable: false,
			value: 'code',
		},
		{title: t(AppLabels.LOCATION), value: 'location_name'},
		{title: t(AppLabels.BOOK_STOCK_STATUS), value: 'status'},
	];

	cols.push({title: t(AppLabels.ACTIONS), value: 'actions', align: 'end'});

	return cols;
});

const stockDialog: Ref<boolean> = ref(false);
const selectedStock: ShallowRef<BookStock | null> = shallowRef(null);

function showEditStockDialog(stockId: number) {
	const stock = props.book.getStocks().find((stock) => stock.getId() === stockId);

	if (stock) {
		selectedStock.value = stock;
		stockDialog.value = true;
	}
}

function showAddStockDialog() {
	selectedStock.value = null;
	stockDialog.value = true;
}

const lendDialog: Ref<boolean> = ref(false);

function showLendDialog(stockId: number) {
	const stock = props.book.getStocks().find((stock) => stock.getId() === stockId);

	if (stock) {
		selectedStock.value = stock;
		lendDialog.value = true;
	}
}

const returnLoading: Ref<number[]> = ref([]);

/** Returns a loaned copy in one click. */
async function returnStock(stockId: number) {
	const stock = props.book.getStocks().find((stock) => stock.getId() === stockId);
	if (!stock) {
		return;
	}
	try {
		returnLoading.value.push(stockId);
		await stock.returnLoan();
	} finally {
		returnLoading.value.splice(returnLoading.value.indexOf(stockId), 1);
	}
}

const deleteLoading: Ref<number[]> = ref([]);

const stocks = computed(() => {
	return props.book.getStocks().map((stock) => {
		const status = BookStock.BookStockStatus.find((item) => item.value === stock.getStatus());

		return {
			id: stock.getId(),
			code: stock.getCode(),
			location_id: stock.getLocationId(),
			location_name: stock.getLocationName() || t(AppLabels.NO_LOCATION),
			status: stock.getStatus(),
			status_color: status!.color,
			// A loaned copy names its borrower, while loans are enabled.
			status_text: stock.getStatus() === BookStockStatusEnum.BOOKED && applicationService.isLoansEnabled() && stock.getCustomerName()
				? t(AppLabels.LENT_TO_NAME, {name: stock.getCustomerName()})
				: status!.text
		}
	})
})

function addToPrintQueue(id: number) {
	const stock = props.book.getStocks().find((stock) => stock.getId() === id);
	if (stock) {
		printDialogController.addLabel(props.book.getName(), stock.getCode(), stock.generateBarcodeImage(), props.book.getImageUrl());
	}
}

/**
 *
 * @param stockId
 */
async function removeBookStock(stock: Record<string, any>) {
	confirmationDialogController.showDialog(
		`${t(AppLabels.DELETE_STOCK)} ${stock.code}`,
		t(AppLabels.DELETE_STOCK_DESC),
		t(AppLabels.DELETE)
	).then(async () => {
		try {
			deleteLoading.value.push(stock.id);
			await props.book.removeBookStock(stock.id);
		} finally {
			deleteLoading.value.splice(deleteLoading.value.indexOf(stock.id), 1);
		}
	})
}
</script>
