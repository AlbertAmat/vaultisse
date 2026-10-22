<template>
	<book-stock-codes-dialog
		v-model="dialog"
		:loading="loading"
		@execute-action="addBooks"
	/>
</template>

<script setup lang="ts">
/** Wraps `BookStockCodesDialog` to lend a scanned/typed batch of book stock codes to this customer. */
import {computed, ref, Ref} from "vue";
import BookStockCodesDialog from "@/components/addBookStocks/BookStockCodesDialog.vue";
import Customer from "@/model/customer/Customer";
import {api} from "@/plugins/api";

interface Props {
	customer: Customer,
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

async function addBooks(books: string[]) {
	try {
		loading.value = true;
		const data = await api.customers.addBooks(props.customer.getCustomerId(), books);
		props.customer.setBooks(data);
	} finally {
		loading.value = false;
		dialog.value = false;
	}
}
</script>