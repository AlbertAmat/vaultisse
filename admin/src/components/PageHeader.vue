<template>
	<div class="d-flex align-start ga-3 mb-5">
		<!-- Title and subtitle take the free space, so the actions stay on the same row, on the right. -->
		<div class="flex-grow-1" style="min-width: 0">
			<h1 class="text-h5 font-weight-bold pb-display">{{ title }}</h1>
			<p v-if="subtitle" class="text-body-2 text-medium-emphasis mt-1">{{ subtitle }}</p>
		</div>
		<div class="d-flex align-center ga-2 flex-shrink-0">
			<slot/>
		</div>
	</div>
</template>

<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>
