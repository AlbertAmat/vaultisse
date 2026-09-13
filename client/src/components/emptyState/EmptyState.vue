<template>
	<div class="empty-state" :class="{ 'empty-state--compact': compact }">
		<div v-if="!compact" class="empty-state__orbit">
			<div class="empty-state__ring empty-state__ring--sm"></div>
			<div class="empty-state__ring empty-state__ring--md"></div>
			<div class="empty-state__ring empty-state__ring--lg"></div>

			<div
				v-for="(chip, index) in chips"
				:key="index"
				class="empty-state__chip"
				:style="chip.style"
			>
				<v-icon :size="chip.iconSize" color="var(--pb-text-muted)">{{ chip.icon }}</v-icon>
			</div>

			<div class="empty-state__center">
				<v-icon size="26" color="var(--pb-accent)">{{ icon }}</v-icon>
			</div>
		</div>

		<div v-else class="empty-state__icon-compact">
			<v-icon size="20" color="var(--pb-accent)">{{ icon }}</v-icon>
		</div>

		<h3 class="empty-state__title">{{ title }}</h3>
		<p v-if="description" class="empty-state__description">{{ description }}</p>

		<div v-if="$slots.default" class="empty-state__actions">
			<slot></slot>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * Decorative "nothing here yet" placeholder used across list views (books,
 * locations, customers, categories, authors, ...) when a list is empty:
 * an icon with orbiting decorative chips (or a compact icon-only variant),
 * a title/description, and an actions slot (typically an "add" button).
 */
import {computed} from "vue";

interface Props {
	icon?: string;
	title: string;
	description?: string;
	chipIcons?: string[];
	compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
	icon: 'mdi-plus',
	compact: false,
});

const defaultChipIcons = [
	'mdi-book-outline',
	'mdi-bookshelf',
	'mdi-book-open-page-variant',
	'mdi-book-multiple-outline',
	'mdi-notebook-outline',
	'mdi-book-open-variant',
	'mdi-book-account-outline',
	'mdi-book-education-outline',
];

/**
 * Fixed scatter positions (relative to the orbit center) used to lay out the
 * decorative chips, roughly matching a hand-placed "floating cards" reference layout.
 */
const positions = [
	{x: -120, y: -64, size: 44, rotate: -8, opacity: 0.55},
	{x: -172, y: 20, size: 38, rotate: 6, opacity: 0.3},
	{x: -108, y: 98, size: 44, rotate: -6, opacity: 0.6},
	{x: -18, y: -104, size: 52, rotate: -5, opacity: 0.9},
	{x: 30, y: 72, size: 48, rotate: 7, opacity: 0.8},
	{x: 110, y: -60, size: 44, rotate: 8, opacity: 0.6},
	{x: 172, y: 12, size: 38, rotate: -6, opacity: 0.3},
	{x: 118, y: 102, size: 42, rotate: 6, opacity: 0.55},
];

const chips = computed(() => {
	const icons = props.chipIcons && props.chipIcons.length ? props.chipIcons : defaultChipIcons;
	return positions.map((pos, index) => ({
		icon: icons[index % icons.length],
		iconSize: Math.round(pos.size * 0.4),
		style: {
			transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) rotate(${pos.rotate}deg)`,
			width: `${pos.size}px`,
			height: `${pos.size}px`,
			opacity: pos.opacity,
		},
	}));
});
</script>

<style scoped lang="scss">
.empty-state {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	text-align: center;
	padding: 32px 16px;
	width: 100%;
	height: 100%;
	min-height: 320px;
	box-sizing: border-box;
}

.empty-state__orbit {
	position: relative;
	flex-shrink: 0;
	width: 380px;
	max-width: 100%;
	height: 230px;
	margin-bottom: 8px;
}

@media (max-width: 480px), (max-height: 480px) {
	.empty-state {
		min-height: 260px;
		padding: 20px 16px;
	}

	.empty-state__orbit {
		transform: scale(0.7);
		transform-origin: center top;
		margin-bottom: -70px;
	}
}

.empty-state__ring {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	border-radius: 50%;
	border: 1px solid var(--pb-border);
}

.empty-state__ring--sm {
	width: 160px;
	height: 160px;
}

.empty-state__ring--md {
	width: 260px;
	height: 260px;
}

.empty-state__ring--lg {
	width: 360px;
	height: 360px;
}

.empty-state__chip {
	position: absolute;
	top: 50%;
	left: 50%;
	background: var(--pb-surface);
	border-radius: 10px;
	display: flex;
	align-items: center;
	justify-content: center;
	box-shadow: var(--pb-shadow);
	border: 1px solid var(--pb-border);
}

.empty-state__center {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	width: 60px;
	height: 60px;
	border-radius: 16px;
	background: var(--pb-surface);
	display: flex;
	align-items: center;
	justify-content: center;
	box-shadow: var(--pb-shadow);
	border: 1px solid var(--pb-border);
	z-index: 1;
}

.empty-state__icon-compact {
	width: 40px;
	height: 40px;
	border-radius: 12px;
	background: var(--pb-surface);
	display: flex;
	align-items: center;
	justify-content: center;
	box-shadow: var(--pb-shadow);
	border: 1px solid var(--pb-border);
	margin-bottom: 10px;
}

.empty-state__title {
	font-family: var(--pb-font-display);
	font-size: 18px;
	font-weight: 600;
	color: var(--pb-text);
	margin: 0;
}

.empty-state__description {
	font-size: 13px;
	color: var(--pb-text-muted);
	margin: 4px 0 0;
	max-width: 320px;
}

.empty-state--compact .empty-state__description {
	font-size: 12px;
	max-width: 220px;
}

.empty-state__actions {
	display: flex;
	gap: 12px;
	margin-top: 18px;
}

.empty-state--compact .empty-state__actions {
	margin-top: 12px;
}

.empty-state--compact {
	min-height: 160px;
}
</style>
