<template>
	<v-card class="mb-5 pb-4 settings-card">
		<v-card-title>
			<span class="pb-display settings-card-title">{{ title }}</span>
		</v-card-title>
		<v-divider class="mt-2 mb-0"></v-divider>

		<v-card-text class="pt-2">
			<slot></slot>
		</v-card-text>
	</v-card>
</template>

<script setup lang="ts">
/** Titled card shell used to group related fields on the settings view. */
interface Props {
	title: string;
}

const props = defineProps<Props>();
</script>

<style scoped lang="scss">
.settings-card {
	border-radius: var(--pb-radius) !important;
	border: 1px solid var(--pb-border);
	background: var(--pb-surface) !important;
}

.settings-card-title {
	font-size: 17px;
	font-weight: 600;
}
</style>
