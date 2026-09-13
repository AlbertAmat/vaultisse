<template>
	<v-dialog
		v-model="dialog"
		width="500"
	>
		<v-card>
			<v-card-title>
				{{ stock ? t(AppLabels.EDIT_BOOK_STOCK) : t(AppLabels.ADD_BOOK_STOCK) }}
			</v-card-title>

			<v-divider></v-divider>

			<v-card-text>
				<p class="mb-8 mt-1" style="font-size: 14px">
					{{t(AppLabels.BOOK_STOCK_INFO)}}
				</p>

				<v-select
					v-model="selectedStatus"
					:items="status"
					:label="t(AppLabels.BOOK_STOCK_STATUS)"
					density="compact"
					variant="outlined"
					item-value="value"
					item-title="text"
					hide-details
				></v-select>

				<v-select
					v-model="selectedLocation"
					:items="locations"
					:label="t(AppLabels.LOCATIONS)"
					density="compact"
					variant="outlined"
					item-value="value"
					item-title="text"
					hide-details
					class="mt-3"
				></v-select>

				<v-select
					v-if="selectedStatus == BookStockStatusEnum.BOOKED"
					v-model="selectedCustomer"
					:items="customers"
					:label="t(AppLabels.BOOKED_BY)"
					density="compact"
					variant="outlined"
					item-value="value"
					item-title="text"
					hide-details
					class="mt-3"
				></v-select>
			</v-card-text>

			<v-divider></v-divider>

			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn
					text
					small
					@click="closeDialog()"
					class="text-none"
				>
					{{ t(AppLabels.CLOSE) }}
				</v-btn>
				<v-btn
					color="primary"
					small
					:disabled="selectedStatus === null || selectedLocation == null || loading"
					:loading="loading"
					@click="addStock()"
					class="text-none"
					variant="tonal"
				>
					{{ stock ? t(AppLabels.UPDATE) : t(AppLabels.ADD) }}
				</v-btn>
				<v-btn
					v-if="!stock"
					color="primary"
					variant="elevated"
					small
					:disabled="selectedStatus === null || selectedLocation == null || loading"
					:loading="loading"
					@click="addStock(true)"
					class="text-none"
				>
					{{t(AppLabels.ADD_AND_PRINT)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Create/edit dialog for a book stock (physical copy): status, location,
 * and (only when status is BOOKED) the customer it's loaned to. Passing an
 * existing `stock` prop switches it to edit mode; omitting it creates a
 * new one, optionally printing a barcode label immediately ("Add & Print").
 */
import {computed, Ref, ref, watch} from 'vue'
import Book from "@/model/book/Book";
import {BookStockStatusEnum} from "@/types/book/IBookStock";
import BookStock from "@/model/book/BookStock";
import {applicationService} from "@/service/ApplicationService";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

interface Props {
	book: Book,
	stock?: BookStock,
	modelValue: boolean
}

const props = defineProps<Props>()

const {t} = useI18n();

const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void
}>()

/**
 *
 */
const dialog = computed({
	get: () => props.modelValue,
	set: (val: boolean) => emit('update:modelValue', val),
})

/**
 *
 */
const loading: Ref<boolean> = ref(false);

/**
 * The list of selectable book statuses. The BOOKED status is only offered
 * when leasing is enabled, unless the stock being edited is already booked.
 */
const status = computed(() => {
	if (applicationService.getUser().isLeasingEnabled() || selectedStatus.value === BookStockStatusEnum.BOOKED) {
		return BookStock.BookStockStatus;
	}

	return BookStock.BookStockStatus.filter((item) => item.value !== BookStockStatusEnum.BOOKED);
});

const locations = computed(() => {
	return applicationService.getLocations().map((location) => {
		return {
			value: location.getId(),
			text: location.getName()
		}
	})
})

/**
 *
 */
const selectedStatus: Ref<BookStockStatusEnum> = ref(props.stock ? props.stock.getStatus() : BookStockStatusEnum.AVAILABLE);

/**
 *
 */
const selectedLocation: Ref<number | null> = ref(props.stock ? props.stock.getLocationId() : (applicationService.getDefaultLocation()?.getId() ?? null));

/**
 *
 */
const selectedCustomer: Ref<number | null> = ref(props.stock ? props.stock.getCustomerId() : null);

const customers = computed(() => {
	return applicationService.getCustomers().map((customer) => {
		return {
			value: customer.getCustomerId(),
			text: customer.getCustomerName()
		}
	})
})

/**
 *
 * @param print
 */
async function addStock(print: boolean = false) {
	if (selectedLocation.value != null) {
		try {
			loading.value = true;
			if (props.stock) {
				await props.stock.update(selectedStatus.value, selectedLocation.value, selectedCustomer.value)
			} else {
				await props.book.addBookStock(selectedStatus.value, selectedLocation.value,  selectedCustomer.value, print);
			}
			closeDialog();
		} finally {
			loading.value = false;
		}
	}
}

/**
 *
 */
function closeDialog() {
	selectedStatus.value = BookStockStatusEnum.AVAILABLE;
	selectedLocation.value = null;
	dialog.value = false;
}

watch(() => selectedStatus.value, () => {
	if(selectedStatus.value != BookStockStatusEnum.BOOKED) {
		selectedCustomer.value = null;
	}
})
</script>
