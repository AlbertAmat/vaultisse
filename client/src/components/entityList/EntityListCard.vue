<template>
	<div class="pb-card entity-list">
		<div
			v-for="(item, index) in items"
			:key="item.id"
			class="entity-list-row"
			:class="{'entity-list-row--border': index !== items.length - 1}"
		>
			<v-icon class="entity-list-row-icon" color="primary" size="20">{{ icon }}</v-icon>

			<span class="entity-list-row-name">{{ item.name }}</span>

			<div class="entity-list-row-actions">
				<v-icon
					@click="$emit('edit', item.id)"
					size="small"
					class="mx-1 entity-list-row-edit"
				>
					mdi-pencil
				</v-icon>
				<v-btn
					icon
					variant="text"
					density="compact"
					@click="$emit('delete', item.id)"
					:loading="deleteLoading.includes(item.id)"
					:disabled="deleteLoading.includes(item.id)"
					class="mx-1"
				>
					<v-icon size="small" color="error">mdi-delete</v-icon>
				</v-btn>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * Row-list replacement for a plain "name + actions" data table: a single
 * `pb-card` shell holding one divided row per item (leading icon, name,
 * inline edit/delete). Used by views whose only real column is a name
 * (authors, categories) where a full data-table header row is overkill.
 */
interface Item {
	id: number;
	name: string;
}

interface Props {
	items: Item[];
	icon?: string;
	deleteLoading?: number[];
}

withDefaults(defineProps<Props>(), {
	icon: 'mdi-bookmark-outline',
	deleteLoading: () => [],
});

defineEmits<{
	edit: [id: number];
	delete: [id: number];
}>();
</script>

<style scoped lang="scss">
.entity-list {
	overflow: hidden;
}

.entity-list-row {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 11px 18px;
	transition: background-color 0.15s ease;
}

.entity-list-row:hover {
	background: var(--pb-surface-alt);
}

.entity-list-row:hover .entity-list-row-edit {
	cursor: pointer;
}

.entity-list-row--border {
	border-bottom: 1px solid var(--pb-border);
}

.entity-list-row-icon {
	flex-shrink: 0;
	opacity: 0.8;
}

.entity-list-row-name {
	flex: 1;
	font-size: 14px;
	font-weight: 500;
	color: var(--pb-text);
}

.entity-list-row-actions {
	display: flex;
	align-items: center;
	flex-shrink: 0;
}
</style>
