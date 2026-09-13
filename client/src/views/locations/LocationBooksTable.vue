<template>
	<v-data-table-virtual
		:headers="headers"
		density="compact"
		:items="books"
	>
		<template v-slot:top>
			<v-toolbar
				flat
				density="compact"
				class="px-3"
			>
				<v-spacer/>
				<v-btn
					@click="addDialog = true;"
					density="compact"
					color="primary"
					variant="tonal"
					prepend-icon="mdi-plus"
					:text="t(AppLabels.ADD_A_BOOK)"
					class="text-none"
				></v-btn>
			</v-toolbar>
		</template>

		<template v-slot:item.name="{item}">
			<router-link :to="item.url">
				{{item.name}}
			</router-link>
		</template>

		<template v-slot:item.status="{item}">
			<v-chip
				density="compact"
				variant="outlined"
				:color="item.status_color"
			>
				{{ item.status_text }}
			</v-chip>
		</template>

		<template v-slot:item.image="{item}">
			<img
				v-if="item.image != null"
				:src="item.image"
				style="height: 55px; margin-right: 10px"
			/>
			<div
				v-else
				style="background-color: var(--pb-surface-alt); height: 55px; width: 30px; margin-right: 10px; display: flex; align-items: center; justify-content: center"
			>
				<v-icon>mdi-image-outline</v-icon>
			</div>
		</template>
	</v-data-table-virtual>

	<location-add-books-dialog
		v-if="addDialog"
		v-model="addDialog"
		:location="location"
	/>
</template>

<script setup lang="ts">
/** Table of the books stocked at one location (fetched on mount), with a button to add more via `LocationAddBooksDialog`. */
import {computed, onMounted, Ref, ref} from "vue";
import LocationExt from "@/model/location/LocationExt";
import BookStock from "@/model/book/BookStock";
import LocationAddBooksDialog from "@/views/locations/LocationAddBooksDialog.vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {bookRoute} from "@/router/routes/BookRoute";

interface Props {
	location: LocationExt
}

const props = defineProps<Props>();

const {t} = useI18n();

const loading: Ref<boolean> = ref(false);
const addDialog: Ref<boolean> = ref(false);

const headers = [
	{
		title: t(AppLabels.IMAGE),
		value: 'image',
	},
	{
		title: t(AppLabels.NAME),
		value: 'name',
	},
	{title: t(AppLabels.CODE), value: 'code'},
	{title: t(AppLabels.BOOK_STOCK_STATUS), value: 'status'},
];

const books = computed(() => {
	return props.location.getBooks().map((book) => {
		const status = BookStock.BookStockStatus.find((item) => item.value === book.getStockStatus());

		return {
			id: book.getBookId(),
			name: book.getBookName(),
			code: book.getStockCode(),
			image: book.getBookImageUrl(),
			status: book.getStockStatus(),
			status_color: status!.color,
			status_text: status!.text,
			url: bookRoute.getPath(book.getBookId())
		}
	})
})

onMounted(async () => {
	try {
		loading.value = true;
		await props.location.fetchBooks();
	} finally {
		loading.value = false;
	}
})
</script>