<template>
	<v-dialog
		v-model="dialog"
		width="570"
		scrollable
		persistent
		:close-on-content-click="false"
	>
		<v-card>
			<v-card-title class="d-flex" style="align-items: center">
				{{t(AppLabels.ADD_BOOK_ISBN)}}

				<v-spacer></v-spacer>

				<v-btn
					@click="dialog = false"
					variant="text"
					icon
					density="comfortable"
				>
					<v-icon>mdi-close</v-icon>
				</v-btn>
			</v-card-title>
			<v-divider></v-divider>

			<v-card-text>
				<v-card-subtitle class="px-0" style="white-space: normal">
					{{t(AppLabels.ADD_BOOK_ISBN_DESC)}}
				</v-card-subtitle>

				<div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center">
					<v-text-field
						v-model="isbnCode"
						:disabled="loadingIsbnCode.length != 0"
						:rules="[isbnValidationRule]"
						:label="t(AppLabels.ISBN_CODE)"
						variant="outlined"
						hide-details
						density="compact"
						autofocus
						style="flex: 1 1 200px; min-width: 0"
						class="mt-3"
						@keydown.enter="handleEnter()"
					>
						<template v-slot:append-inner>
							<barcode-scanner @value="addBarcodeValue"/>
						</template>
					</v-text-field>

					<v-select
						v-model="selectedLocation"
						:items="locations"
						:label="t(AppLabels.LOCATIONS)"
						density="compact"
						variant="outlined"
						item-value="value"
						item-title="text"
						hide-details
						style="flex: 1 1 200px; min-width: 0"
						class="mt-3"
					></v-select>
				</div>

				<v-list
					density="compact"
					style="max-height: 400px; overflow-y: auto; overflow-x: hidden "
					slim
				>
					<v-list-item
						v-for="(item, index) in isbnCodeList"
						:key="index"
						density="compact"
						class="px-0"
						prepend-icon="mdi-book"
						:title="item"
						slim
					>
						<template v-slot:append>
							<v-progress-circular
								v-if="loadingIsbnCode.includes(item)"
								indeterminate
								size="20"
								color="primary"
							></v-progress-circular>

							<v-tooltip
								v-else-if="notFoundIsbnCode.includes(item)"
								:text="t(AppLabels.ISBN_BOOK_NOT_FOUND)"
								location="top"
							>
								<template v-slot:activator="{ props: tooltipProps }">
									<v-icon
										v-bind="tooltipProps"
										color="warning"
									>
										mdi-book-alert
									</v-icon>
								</template>
							</v-tooltip>

							<v-tooltip
								v-else-if="errorIsbnCode.includes(item)"
								:text="t(AppLabels.ISBN_ADD_ERROR)"
								location="top"
							>
								<template v-slot:activator="{ props: tooltipProps }">
									<v-icon
										v-bind="tooltipProps"
										color="error"
									>
										mdi-alert-circle
									</v-icon>
								</template>
							</v-tooltip>

							<v-icon
								v-else-if="createdBooks.includes(item)"
								color="success"
							>
								mdi-check
							</v-icon>
						</template>
					</v-list-item>
				</v-list>
			</v-card-text>

			<v-divider></v-divider>

			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn
					text
					class="text-none"
					@click="dialog = false"
				>
					{{t(AppLabels.CANCEL)}}
				</v-btn>
				<v-btn
					v-if="(errorIsbnCode.length != 0 || notFoundIsbnCode.length != 0) && createdBooks.length != 0"
					color="primary"
					variant="elevated"
					class="text-none mr-4"
					@click="dialog = false"
				>
					{{t(AppLabels.CLOSE)}}
				</v-btn>
				<v-btn
					v-else
					color="primary"
					:loading="loadingIsbnCode.length > 0 || loading"
					:disabled="disableButton"
					variant="elevated"
					class="text-none mr-4"
					@click="addBooks()"
				>
					{{t(AppLabels.ADD)}} ({{isbnCodeList.length}})
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * "Add book(s) by ISBN" dialog: scan/type one or more ISBNs (client-side
 * checksum-validated) into a queue, then create each sequentially via
 * `bookService.createBookFromIsbn` with a 1.5s delay between calls (rate-limit
 * friendly toward the Google Books/Open Library lookups). Each row's icon
 * reflects its outcome: loading, not found, error, or created. Navigates
 * straight to the book detail page when adding exactly one.
 */
import {computed, ref, Ref, watch} from "vue";
import {validateIsbn10, validateIsbn13} from "@/utils/IsbnVerification";
import {bookService} from "@/service/book/BookService";
import router from "@/router/Router";
import {AxiosError, AxiosResponse} from "axios";
import {bookRoute} from "@/router/routes/BookRoute";
import Book from "@/model/book/Book";
import BookStock from "@/model/book/BookStock";
import BarcodeScanner from "@/components/barcodeScanner/BarcodeScanner.vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {AppError} from "@/types/AppError";
import {applicationService} from "@/service/ApplicationService";
import {BookStockStatusEnum} from "@/types/book/IBookStock";

interface Props {
	modelValue: boolean
}

const props = defineProps<Props>();

const {t} = useI18n();

const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void
}>()

/**
 *
 */
const dialog = computed({
	get() {
		return props.modelValue;
	},
	set(value: boolean) {
		emit("update:modelValue", value)
	}
});

/**
 *
 */
const loadingIsbnCode: Ref<string[]> = ref([]);

/**
 *
 */
const errorIsbnCode: Ref<string[]> = ref([]);

/**
 *
 */
const notFoundIsbnCode: Ref<string[]> = ref([]);

/**
 *
 */
const loading: Ref<boolean> = ref(false);

const isbnCode: Ref<string> = ref("");

/**
 *
 */
const isbnCodeList: Ref<string[]> = ref([]);
const createdBooks: Ref<string[]> = ref([]);

/**
 *
 */
const disableButton = computed(() => {
	return loadingIsbnCode.value.length > 0 || isbnCodeList.value.length == 0
})

/**
 *
 */
const selectedLocation: Ref<number | null> = ref(applicationService.getDefaultLocation()?.getId() ?? null);

const locations = computed(() => {
	return applicationService.getLocations().map((location) => {
		return {
			value: location.getId(),
			text: location.getName()
		}
	})
})

function addBarcodeValue(value: string) {
	if(isValidIsbn(value)) {
		isbnCode.value = value;
		handleEnter()
	}
}

// ISBN validation function
function isValidIsbn(isbn: string): boolean {
	// Remove any non-digit characters (like spaces or dashes)
	isbn = isbn.replace(/[^0-9X]/gi, "");

	// Validate ISBN-13
	if (isbn.length === 13) {
		return validateIsbn13(isbn);
	}

	// Validate ISBN-10
	if (isbn.length === 10) {
		return validateIsbn10(isbn);
	}

	return false;
}

// Computed property for validation rule
const isbnValidationRule = computed(() => {
	return (value: string) => {
		if (isValidIsbn(value)) {
			return true;
		} else {
			return t(AppLabels.INVALID_ISBN_CODE);
		}
	};
});

function handleEnter() {
	if (isValidIsbn(isbnCode.value)) {
		isbnCodeList.value.push(isbnCode.value);
	}
	isbnCode.value = "";
}

function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function addBooks() {
	errorIsbnCode.value = [];
	notFoundIsbnCode.value = [];
	loadingIsbnCode.value = [];
	loading.value = true;

	const totalBooks = isbnCodeList.value.length;

	for (const code of isbnCodeList.value) {
		try {
			loadingIsbnCode.value.push(code);

			const id = await bookService.createBookFromIsbn(code, selectedLocation.value);
			createdBooks.value.push(code);

			if (totalBooks === 1) {
				router.push(bookRoute.getPath(id));
			}
		} catch (error:any) {
			console.error("Failed to add book for ISBN", code, error)

			if (error.response?.status === AppError.BOOK_NOT_FOUND) {
				notFoundIsbnCode.value.push(code);
			} else {
				errorIsbnCode.value.push(code);
			}
		} finally {
			const index = loadingIsbnCode.value.indexOf(code);
			loadingIsbnCode.value.splice(index, 1);
		}

		// Wait 1.5 seconds before processing the next ISBN
		await delay(1500);
	}

	loading.value = false;

	if (errorIsbnCode.value.length === 0 && notFoundIsbnCode.value.length === 0 && createdBooks.value.length == totalBooks) {
		dialog.value = false;
	}
}

watch(() => dialog.value, () => {
	if (!dialog.value) {
		isbnCode.value = "";
		loading.value = false;
		selectedLocation.value = null;
		isbnCodeList.value = [];
		createdBooks.value = [];
		errorIsbnCode.value = [];
		notFoundIsbnCode.value = [];
		loadingIsbnCode.value = [];
	}
})
</script>