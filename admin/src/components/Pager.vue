<template>
	<div class="d-flex align-center justify-end ga-2 pa-3 text-body-2">
		<span class="text-medium-emphasis">{{ from }}–{{ to }} of {{ total.toLocaleString() }}</span>
		<v-btn icon="mdi-chevron-left" size="small" variant="text" :disabled="page <= 1" aria-label="Previous page" @click="$emit('update:page', page - 1)"/>
		<v-btn icon="mdi-chevron-right" size="small" variant="text" :disabled="to >= total" aria-label="Next page" @click="$emit('update:page', page + 1)"/>
	</div>
</template>

<script setup lang="ts">
import {computed} from "vue";

const props = defineProps<{ page: number; pageSize: number; total: number }>();
defineEmits<{ "update:page": [page: number] }>();

const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.total, props.page * props.pageSize));
</script>
