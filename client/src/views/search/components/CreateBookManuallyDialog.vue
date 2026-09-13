<template>
	<v-dialog
		v-model="dialog"
		width="700"
		scrollable
		persistent
	>
		<v-card>
			<v-card-title class="d-flex" style="align-items: center">
				{{t(AppLabels.ADD_BOOK)}}

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
				<v-file-upload
					v-model="image"
					density="compact"
					:title="t(AppLabels.DRAG_AND_DROP_BOOK_COVER)"
					clearable
					class="mb-6"
				></v-file-upload>

				<template v-for="(field, index) in fields">
					<v-text-field
						v-if="field.type == FIELD_TYPE.TEXT_FIELD"
						:key="index + '-field'"
						v-model="field.model.value"
						:label="field.label"
						:rules="[field.rules]"
						variant="outlined"
						density="compact"
						:autofocus="index == 0"
					></v-text-field>

					<v-textarea
						v-else-if="field.type == FIELD_TYPE.TEXT_AREA"
						:key="index + '-area'"
						v-model="field.model.value"
						:label="field.label"
						:rules="[field.rules]"
						variant="outlined"
						density="compact"
						:autofocus="index == 0"
					></v-textarea>
				</template>

				<v-select
					v-model="selectedLocation"
					:items="locations"
					:label="t(AppLabels.LOCATIONS)"
					density="compact"
					variant="outlined"
					item-value="value"
					item-title="text"
					clearable
					hide-details
					class="mt-3"
				></v-select>
			</v-card-text>

			<v-divider></v-divider>

			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn
					variant="text"
					class="text-none"
					@click="dialog = false"
				>
					{{t(AppLabels.CANCEL)}}
				</v-btn>
				<v-btn
					color="primary"
					:loading="loading"
					:disabled="disableButton"
					variant="elevated"
					class="text-none mr-4"
					@click="addBook()"
				>
					{{t(AppLabels.ADD)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * "Add a book manually" dialog: name/description/ISBN fields plus a cover
 * image drop zone, submitted via `bookService.createBook`. Used as the
 * fallback when a book can't be found by ISBN lookup.
 */
import {computed, ref, Ref, watch} from "vue";
import {validateIsbn10, validateIsbn13} from "@/utils/IsbnVerification";
import { VFileUpload } from 'vuetify/labs/VFileUpload'
import {bookService} from "@/service/book/BookService";
import {bookRoute} from "@/router/routes/BookRoute";
import router from "@/router/Router";
import {appSnackbarController, SnackbarType} from "@/components/appSnackbar/AppSnackbarController";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
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
const loading: Ref<boolean> = ref(false);

const name: Ref<string> = ref("");
const description: Ref<string> = ref("");
const isbn: Ref<string> = ref("");
const image: Ref<File | undefined> = ref(undefined);

/**
 * Location to place the book's initial stock in, or null to create the
 * book without one (a stock can still be added later from its page).
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

enum FIELD_TYPE {
	TEXT_FIELD,
	TEXT_AREA,
}

const fields: Array<{ label: string, model: Ref<any>, type: FIELD_TYPE, rules?: any }> = [
	{
		label: t(AppLabels.NAME),
		model: name,
		type: FIELD_TYPE.TEXT_FIELD
	},
	{
		label: t(AppLabels.DESCRIPTION),
		model: description,
		type: FIELD_TYPE.TEXT_AREA
	},
	{
		label: "ISBN",
		model: isbn,
		rules: isbnValidationRule.value,
		type: FIELD_TYPE.TEXT_FIELD
	}
]

/**
 *
 */
const disableButton = computed(() => {
	return loading.value || name.value.trim().length === 0;
})

async function addBook() {
	try {
		loading.value = true;
		const id = await bookService.createBook(name.value, description.value, isbn.value, image.value || null);
		if (selectedLocation.value != null) {
			await bookService.addBookStock(id, selectedLocation.value, BookStockStatusEnum.AVAILABLE, null);
		}
		await router.push(bookRoute.getPath(id));
		appSnackbarController.show({message: t(AppLabels.BOOK_HAS_BEEN_ADDED, {name: name.value}) })
		dialog.value = false;
	} finally {
		loading.value = false;
	}
}

watch(() => image.value, (img) => {
	if(img && !img.type.startsWith("image/")) {
		appSnackbarController.show({message: t(AppLabels.ONLY_IMAGES_ALLOWED), type: SnackbarType.ERROR})
		image.value = undefined;
	}
})
</script>