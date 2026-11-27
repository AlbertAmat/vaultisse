<template>
	<!-- The client's logo: two book spines on a rounded tile, one variant per theme (see client AppMenu.vue). -->
	<svg v-if="state.theme === 'beige'" :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
		<rect width="32" height="32" rx="8" fill="#f5e3d0"/>
		<path d="M8 8.5C8 7.67 8.67 7 9.5 7H15v18H9.5A1.5 1.5 0 0 1 8 23.5v-15Z" fill="#a35f2c"/>
		<path d="M24 8.5c0-.83-.67-1.5-1.5-1.5H17v18h5.5a1.5 1.5 0 0 0 1.5-1.5v-15Z" fill="#c97b3d"/>
	</svg>
	<svg v-else :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
		<rect width="32" height="32" rx="7" fill="#0d1420"/>
		<path d="M8 8.5C8 7.67 8.67 7 9.5 7H15v18H9.5A1.5 1.5 0 0 1 8 23.5v-15Z" fill="#1c7ff1"/>
		<path d="M24 8.5c0-.83-.67-1.5-1.5-1.5H17v18h5.5a1.5 1.5 0 0 0 1.5-1.5v-15Z" fill="#78dcf6"/>
	</svg>
</template>

<script setup lang="ts">
import {state} from "@/store";

withDefaults(defineProps<{ size?: number }>(), {size: 32});
</script>
