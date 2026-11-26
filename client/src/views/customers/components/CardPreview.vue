<template>
	<canvas ref="canvas" class="card-preview"/>
</template>

<script setup lang="ts">
/** Live preview of a library card. Parents use `getCanvas()` to export it. */
import {onMounted, ref, watch} from "vue";
import {CardContent, drawCustomerCard} from "@/utils/customerCard";

const props = defineProps<{content: CardContent}>();

const canvas = ref<HTMLCanvasElement | null>(null);

let pending: Promise<void> = Promise.resolve();

/** Draws are chained so a slow image load can't overwrite a newer card. */
function redraw() {
	pending = pending
		.then(() => canvas.value ? drawCustomerCard(canvas.value, props.content) : undefined)
		.catch((e) => console.error("Error drawing the card", e));
}

watch(() => props.content, redraw, {deep: true});
onMounted(redraw);

defineExpose({getCanvas: () => canvas.value});
</script>

<style scoped>
.card-preview {
	width: 100%;
	aspect-ratio: 1011 / 638;
	border-radius: 14px;
	border: 1px solid var(--pb-border);
}
</style>
