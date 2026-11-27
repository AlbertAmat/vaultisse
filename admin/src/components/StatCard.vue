<template>
	<v-card class="pa-4 h-100" :to="to">
		<div class="d-flex align-center ga-2 text-medium-emphasis text-body-2">
			<v-icon v-if="icon" :icon="icon" size="18"/>
			{{ label }}
		</div>
		<div class="text-h4 font-weight-bold mt-1" :class="color ? `text-${color}` : ''">{{ value }}</div>
		<div v-if="hint" class="text-caption text-medium-emphasis mt-1">{{ hint }}</div>
	</v-card>
</template>

<script setup lang="ts">
defineProps<{ label: string; value: string | number; hint?: string; icon?: string; color?: string; to?: string }>();
</script>
