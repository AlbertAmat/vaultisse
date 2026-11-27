<template>
	<v-dialog v-model="dialog" width="560" :persistent="lending">
		<template v-slot:activator="{ props: activatorProps }">
			<v-btn
				v-bind="activatorProps"
				prepend-icon="mdi-book-arrow-right-outline"
				class="text-none mr-3"
				color="primary"
				variant="elevated"
			>
				{{ t(AppLabels.LOAN_A_BOOK) }}
			</v-btn>
		</template>

		<v-card>
			<v-card-title>{{ t(AppLabels.LOAN_A_BOOK) }}</v-card-title>
			<v-divider/>

			<v-card-text>
				<!-- Handheld scanners type the code and press Enter. -->
				<v-autocomplete
					v-model="customerId"
					v-model:search="customerSearch"
					:items="customers"
					item-title="name"
					item-value="id"
					:label="t(AppLabels.LOAN_CUSTOMER_FIELD)"
					:loading="scanning"
					variant="outlined"
					density="compact"
					hide-details
					autofocus
					@keydown.enter="scanTypedCard()"
				>
					<template v-slot:append-inner>
						<barcode-scanner @value="scanCard"/>
					</template>
				</v-autocomplete>

				<!-- Each pick or scan adds a copy to the list below; the field stays empty for the next one. -->
				<v-autocomplete
					ref="bookInput"
					:model-value="null"
					@update:model-value="add"
					:search="bookSearch"
					@update:search="onBookSearch"
					:items="choices"
					item-title="bookName"
					item-value="code"
					:label="t(AppLabels.LOAN_BOOK_FIELD)"
					:no-data-text="t(AppLabels.LOAN_NO_AVAILABLE_COPY)"
					:loading="searching"
					:disabled="lending"
					variant="outlined"
					density="compact"
					hide-details
					return-object
					no-filter
					class="mt-4"
					@keydown.enter="pickCopy(bookSearch)"
				>
					<template v-slot:item="{ props: itemProps, item }">
						<v-list-item v-bind="itemProps" :subtitle="describe(item)"/>
					</template>
					<template v-slot:append-inner>
						<barcode-scanner @value="pickCopy"/>
					</template>
				</v-autocomplete>

				<v-list v-if="picked.length" density="compact" class="mt-2 pa-0" max-height="260">
					<v-list-item
						v-for="copy in picked"
						:key="copy.code"
						:title="copy.bookName"
						:subtitle="describe(copy)"
						class="px-1"
					>
						<template v-slot:append>
							<v-btn
								icon="mdi-close"
								variant="text"
								size="small"
								:disabled="lending"
								@click="remove(copy.code)"
							/>
						</template>
					</v-list-item>
				</v-list>
			</v-card-text>

			<v-divider/>

			<v-card-actions>
				<v-spacer/>
				<v-btn class="text-none" :disabled="lending" @click="dialog = false">{{ t(AppLabels.CLOSE) }}</v-btn>
				<v-btn
					color="primary"
					variant="elevated"
					class="text-none"
					:disabled="customerId === null || !picked.length || lending"
					:loading="lending"
					@click="lend()"
				>
					{{ t(AppLabels.LEND) }}<template v-if="picked.length > 1">&nbsp;({{ picked.length }})</template>
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Lends one or more copies from the Loans view: pick the customer (by name or
 * library card scan), then add available copies (by title or stock label scan).
 */
import {computed, nextTick, ref, shallowRef, watch} from "vue";
import {useI18n} from "vue-i18n";
import {ICustomerDetail} from "@vaultisse/types/customer/ICustomer";
import {IAvailableStock} from "@vaultisse/types/loans/IAvailableStock";
import BarcodeScanner from "@/components/barcodeScanner/BarcodeScanner.vue";
import {api} from "@/plugins/api";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";

defineProps<{customers: ICustomerDetail[]}>();
const emit = defineEmits<{
	/** At least one book was lent, so the loans list is stale. */
	(e: 'refresh'): void
}>();
const {t} = useI18n();

const dialog = ref(false);
const customerId = ref<number | null>(null);
const customerSearch = ref("");
/** Copies waiting to be lent, in the order they were added. */
const picked = shallowRef<IAvailableStock[]>([]);
const stocks = shallowRef<IAvailableStock[]>([]);
const bookSearch = ref("");
const scanning = ref(false);
const searching = ref(false);
const lending = ref(false);
const bookInput = ref<HTMLInputElement | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | undefined;
/** Number of the latest search, so a slow older answer is ignored. */
let searchNumber = 0;

/** @returns The stock code and, if shelved, the location of a copy. */
const describe = (copy: IAvailableStock) => [copy.code, copy.locationName].filter(Boolean).join(" · ");

/** The search results still left to add. */
const choices = computed(() => stocks.value.filter((copy) => !picked.value.some((p) => p.code === copy.code)));

watch(dialog, (open) => {
	clearTimeout(searchTimer);
	if (open) {
		// Reloaded on every opening: availability changes with each loan and return.
		search("");
		return;
	}
	customerId.value = null;
	customerSearch.value = "";
	picked.value = [];
	stocks.value = [];
	bookSearch.value = "";
});

/**
 * Loads the available copies matching a text.
 * @param query Stock code, title or ISBN fragment.
 * @returns The matches, or null if a newer search superseded this one or it failed.
 */
async function search(query: string): Promise<IAvailableStock[] | null> {
	const current = ++searchNumber;
	try {
		searching.value = true;
		const found = await api.loans.searchAvailable(query);
		if (current !== searchNumber) {
			return null;
		}
		stocks.value = found;
		return found;
	} catch (e) {
		console.error("Error searching available copies", e);
		return null;
	} finally {
		if (current === searchNumber) {
			searching.value = false;
		}
	}
}

/**
 * Searches as the user types.
 * @param query The field's text.
 */
function onBookSearch(query: string) {
	bookSearch.value = query;
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => search(query), 250);
}

/**
 * Adds a copy to the list to lend and empties the field for the next one.
 * @param copy The chosen or scanned copy; adding it twice has no effect.
 */
async function add(copy: IAvailableStock | null) {
	if (!copy) {
		return;
	}
	if (!picked.value.some((p) => p.code === copy.code)) {
		picked.value = [...picked.value, copy];
	}
	// After the autocomplete has finished writing its own search text.
	await nextTick();
	onBookSearch("");
}

/**
 * Takes a copy off the list.
 * @param code Stock code.
 */
function remove(code: string) {
	picked.value = picked.value.filter((copy) => copy.code !== code);
}

/**
 * Adds the copy carrying a scanned (or typed and entered) stock label.
 * @param code Stock code.
 */
async function pickCopy(code: string) {
	const wanted = code.trim().toLowerCase();
	if (!wanted) {
		return;
	}
	clearTimeout(searchTimer);
	const found = await search(code.trim());
	if (!found) {
		return;
	}
	const match = found.find((copy) => copy.code.toLowerCase() === wanted);
	if (match) {
		await add(match);
	} else if (found.length === 0) {
		appSnackbarController.show({message: t(AppLabels.LOAN_NO_AVAILABLE_COPY)});
	}
}

/**
 * Selects the owner of a scanned library card.
 * @param code Barcode content.
 */
async function scanCard(code: string) {
	if (!code.trim() || scanning.value) {
		return;
	}
	try {
		scanning.value = true;
		const activity = await api.customers.scanCard(code.trim());
		customerId.value = activity.customer.id;
		await nextTick();
		bookInput.value?.focus();
	} catch (e) {
		console.error("Error scanning card", e);
	} finally {
		scanning.value = false;
	}
}

/** Enter in the customer field: look the text up as a card only if it is shaped like one, not a name. */
function scanTypedCard() {
	if (/^[0-9a-f]{32}$/i.test(customerSearch.value.trim().replace(/-/g, ""))) {
		scanCard(customerSearch.value);
	}
}

/**
 * Lends every listed copy to the picked customer, one by one; the server only
 * accepts available copies. Any it refuses stay listed, with the dialog open.
 */
async function lend() {
	const customer = customerId.value;
	if (customer === null || !picked.value.length) {
		return;
	}
	let lent = 0;
	try {
		lending.value = true;
		for (const copy of picked.value) {
			try {
				await api.customers.lendByScan(customer, copy.code);
				remove(copy.code);
				lent++;
			} catch (e) {
				console.error("Error lending book", copy.code, e);
			}
		}
	} finally {
		lending.value = false;
	}
	if (!lent) {
		return;
	}
	emit('refresh');
	if (!picked.value.length) {
		appSnackbarController.show({message: t(AppLabels.SNACKBAR_BOOK_LENT)});
		dialog.value = false;
	}
}
</script>
