<template>
	<book-stock-codes-dialog
		v-model="dialog"
		:loading="loading"
		@execute-action="addBooks"
	/>
</template>

<script setup lang="ts">
/** Wraps `BookStockCodesDialog` to move a scanned/typed batch of book stock codes into this location. */
import LocationExt from "@/model/location/LocationExt";
import {computed, ref, Ref} from "vue";
import {api} from "@/plugins/api";
import BookStockCodesDialog from "@/components/addBookStocks/BookStockCodesDialog.vue";

interface Props {
	location: LocationExt,
	modelValue: boolean
}

const props = defineProps<Props>()

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
 *
 * @param books
 */
async function addBooks(books: string[]) {
	try {
		loading.value = true;
		const data = await api.locations.addBooks(props.location.getId(), books);
		props.location.setBooks(data);
	} finally {
		loading.value = false;
		dialog.value = false;
	}
}
</script>