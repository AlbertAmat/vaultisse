<template>
	<v-card :class="cardCssClass" class="dashboard-card pb-spine-top" elevation="0">
		<v-card-title
			class="d-flex align-center pb-eyebrow"
			:class="large ? 'py-3' : 'pt-3'"
		>
			{{ title }}

			<v-chip
				v-if="counter !== undefined"
				density="compact"
				class="dashboard-card-counter ml-2"
			>
				{{ counter }}
			</v-chip>

			<v-spacer></v-spacer>

			<slot name="actions"></slot>
		</v-card-title>
		<v-divider v-if="large" class="dashboard-card-divider"></v-divider>
		<v-card-text class="mx-1 mb-1 pa-2 dashboard-card-body">
			<slot></slot>
		</v-card-text>
	</v-card>
</template>

<script setup lang="ts">
/** Titled tile shell used to lay out the dashboard's KPI/chart cards, with a `large` variant for the chart card, an optional count chip, and an `actions` header slot (e.g. a "View all" link). */
interface Props {
	title:  string;
	large?:  boolean;
	cardCssClass?:  string;
	counter?: number;
}

const props = defineProps<Props>()
</script>

<style scoped lang="scss">
.dashboard-card {
	border: 1px solid var(--pb-border);
	border-radius: var(--pb-radius);
	background: var(--pb-surface) !important;
	display: flex;
	flex-direction: column;
}

.dashboard-card-divider {
	border-color: var(--pb-border) !important;
}

.dashboard-card-counter {
	font-family: var(--pb-font-mono);
	font-size: 11px;
}

.dashboard-card-body {
	background-color: var(--pb-surface-alt);
	border-radius: var(--pb-radius-sm);
	flex: 1;
}
</style>
