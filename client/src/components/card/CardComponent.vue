<template>
	<v-card
		:variant="outline ? 'outlined' : 'flat'"
		class="pb-panel-card"
	>
		<v-card-title
			v-if="!dense"
			class="d-flex align-center pb-display pb-panel-card-title"
		>
			<v-icon v-if="icon" class="mr-2" color="primary">{{icon}}</v-icon>

			{{ title }}

			<v-chip
				v-if="counter != undefined"
				density="compact"
				class="px-2 ml-2">
				{{ counter }}
			</v-chip>

			<v-spacer></v-spacer>

			<slot name="actions"></slot>
		</v-card-title>
		<v-card-text :class="dense ? 'pt-0' : ''">
			<slot></slot>
		</v-card-text>
	</v-card>
</template>

<script setup lang="ts">
/** Generic titled card shell (icon, title, optional count chip, optional header actions slot, body slot) used throughout the list/detail views for consistent styling. */
interface Props {
	title:  string;
	icon?:  string;
	counter?: number;
	outline?: boolean
	dense?: boolean
}

const props = withDefaults(defineProps<Props>(), {
	outline: false,  // ✅ no function needed for primitive
	dense: false
})
</script>

<style scoped lang="scss">
.pb-panel-card {
	border-radius: var(--pb-radius) !important;
	border-color: var(--pb-border) !important;
	background: var(--pb-surface) !important;
}

.pb-panel-card-title {
	font-size: 17px;
	font-weight: 600;
}
</style>