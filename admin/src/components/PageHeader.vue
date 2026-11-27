<template>
	<div class="d-flex flex-wrap align-center ga-3 mb-5">
		<div class="mr-auto">
			<h1 class="text-h5 font-weight-bold">{{ title }}</h1>
			<p v-if="subtitle" class="text-body-2 text-medium-emphasis mt-1">{{ subtitle }}</p>
		</div>
		<slot/>
	</div>
</template>

<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>
