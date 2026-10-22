<template>
	<v-dialog
		v-model="dialog"
		width="500"
	>
		<v-card height="600px">
			<v-card-title class="d-flex">
				{{title || t(AppLabels.ADD_BOOK)}}

				<v-spacer></v-spacer>

				<v-btn
					variant="text"
					density="compact"
					icon
					@click="dialog = false"
				>
					<v-icon>mdi-close</v-icon>
				</v-btn>
			</v-card-title>

			<v-divider></v-divider>

			<v-card-text>
				<v-text-field
					v-model="bookCode"
					:label="t(AppLabels.STOCK_CODE)"
					variant="outlined"
					hide-details
					density="compact"
					autofocus
					style="width: 250px; flex: none"
					class="mb-3"
					@keydown.enter="handleEnter()"
				>
					<template v-slot:append-inner>
						<barcode-scanner @value="addBarcodeValue"/>
					</template>
				</v-text-field>

				<v-list>
					<book-stock-item
						v-for="code in bookCodes"
						:key="code"
						:code="code"
						:metadata="books.get(code)"
						:loading="loadingBooks.includes(code)"
						@remove="removeBook(code)"
					></book-stock-item>
				</v-list>
			</v-card-text>

			<v-divider/>

			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn
					variant="text"
					@click="dialog = false"
					class="text-none"
				>
					{{ t(AppLabels.CLOSE) }}
				</v-btn>
				<v-btn
					color="primary"
					variant="elevated"
					:disabled="bookCodes.length == 0 || loading"
					:loading="loading"
					@click="emit('executeAction', bookCodes)"
					class="text-none"
				>
					{{ actionText || t(AppLabels.ADD)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Reusable "scan/type a list of book stock codes" dialog, used by both the
 * location "add books" flow and the customer "lend books" flow. As each
 * code is entered it's added to `bookCodes` and its metadata fetched via
 * `api.books.fetchBookAddMd` (rendered by `BookStockItem`); the parent
 * listens for `executeAction` with the final array of codes to submit.
 */
import {computed, ref, Ref} from "vue";
import BarcodeScanner from "@/components/barcodeScanner/BarcodeScanner.vue";
import {api} from "@/plugins/api";
import {IBookAddMd} from "@vaultisse/types/book/IBookAddMd";
import BookStockItem from "@/components/addBookStocks/BookStockItem.vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "../../plugins/i18n/AppLabels";

interface Props {
	modelValue: boolean;
	loading: boolean;
	title?: string;
	actionText?: string;
}

const props = defineProps<Props>()

const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void
	(e: 'executeAction', books: string[]): void
}>()

const { t } = useI18n();

/**
 *
 */
const dialog = computed({
	get: () => props.modelValue,
	set: (val: boolean) => {
		emit('update:modelValue', val)

		if(!val) {
			books.value = new Map<string, IBookAddMd>();
			bookCodes.value = [];
			loadingBooks.value = [];
		}
	}
})

/**
 * An array of book stock codes
 */
const bookCodes: Ref<string[]> = ref([]);

/**
 * An array of book codes or book isb that are bing loaden
 */
const loadingBooks: Ref<string[]> = ref([]);

/**
 * Once a book is added into the book codes, it will fetch the book information and add it to this array.
 * With this array we can display the book cover, book name and add a selector of the book stocks if was not selected
 */
const books: Ref<Map<string, IBookAddMd>> = ref(new Map<string, IBookAddMd>());

/**
 *
 */
const bookCode: Ref<string> = ref("");

function handleEnter() {
	// only add it if we dont have it
	if(!bookCodes.value.includes(bookCode.value)) {
		bookCodes.value.push(bookCode.value);
		fetchBook(bookCode.value);
	}
	bookCode.value = "";
}

function addBarcodeValue(value: string) {
	if(value.length > 0) {
		bookCode.value = value;
		handleEnter();
	}
}

function removeBook(code: string) {
	books.value.delete(code);
	loadingBooks.value.splice(loadingBooks.value.indexOf(code), 1);
	bookCodes.value.splice(bookCodes.value.indexOf(code), 1);
}

async function fetchBook(book: string) {
	const loadingIndex = loadingBooks.value.push(book);
	try {
		const data = await api.books.fetchBookAddMd(book);
		books.value.set(book, data);
	} finally {
		loadingBooks.value.splice(loadingIndex, 1);
	}
}
</script>