<template>
	<v-dialog
		v-model="dialog"
		width="500"
	>
		<v-card>
			<v-card-title>
				{{t(AppLabels.LEND_BOOK)}}
			</v-card-title>

			<v-divider></v-divider>

			<v-card-text>
				<p class="mb-6 mt-1" style="font-size: 14px">
					{{book.getName()}} ({{stock.getCode()}})
				</p>

				<v-autocomplete
					v-model="selectedBorrower"
					:items="borrowers"
					:label="t(AppLabels.BOOKED_BY)"
					density="compact"
					variant="outlined"
					item-value="value"
					item-title="text"
					hide-details
					autofocus
				></v-autocomplete>

				<!-- A loaned copy must have a location; only ask when this one has none. -->
				<v-select
					v-if="stock.getLocationId() == null"
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
			</v-card-text>

			<v-divider></v-divider>

			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn
					@click="dialog = false"
					class="text-none"
				>
					{{t(AppLabels.CLOSE)}}
				</v-btn>
				<v-btn
					color="primary"
					variant="elevated"
					:disabled="selectedBorrower === null || selectedLocation === null || loading"
					:loading="loading"
					@click="lend()"
					class="text-none"
				>
					{{t(AppLabels.LEND)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Lends one available copy: pick the borrower, confirm. A shortcut for
 * setting the status to "on loan" in BookStockDialog.
 */
import {computed, Ref, ref} from "vue";
import {useI18n} from "vue-i18n";
import {BookStockStatusEnum} from "@vaultisse/types/book/IBookStock";
import Book from "@/model/book/Book";
import BookStock from "@/model/book/BookStock";
import {applicationService} from "@/service/ApplicationService";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {borrowerItems, toBorrower} from "@/views/book/compoents/borrowerOptions";

interface Props {
	book: Book,
	stock: BookStock,
	modelValue: boolean
}

const props = defineProps<Props>()

const {t} = useI18n();

const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void
}>()

const dialog = computed({
	get: () => props.modelValue,
	set: (val: boolean) => emit('update:modelValue', val),
})

const loading: Ref<boolean> = ref(false);
const selectedBorrower: Ref<string | null> = ref(null);
const selectedLocation: Ref<number | null> = ref(props.stock.getLocationId() ?? applicationService.getDefaultLocation()?.getId() ?? null);

const borrowers = computed(() => borrowerItems());

const locations = computed(() => applicationService.getLocations().map((location) => ({
	value: location.getId(),
	text: location.getName()
})));

/** Marks the copy as on loan to the picked borrower. */
async function lend() {
	if (selectedBorrower.value === null || selectedLocation.value === null) {
		return;
	}
	try {
		loading.value = true;
		await props.stock.update(BookStockStatusEnum.BOOKED, selectedLocation.value, toBorrower(selectedBorrower.value));
		dialog.value = false;
	} finally {
		loading.value = false;
	}
}
</script>
