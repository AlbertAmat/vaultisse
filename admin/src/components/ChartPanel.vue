<template>
	<div :style="{height: `${height}px`}">
		<component :is="type === 'line' ? Line : Bar" :data="data" :options="options"/>
	</div>
</template>

<script setup lang="ts">
import {computed} from "vue";
import {useTheme} from "vuetify";
import {Bar, Line} from "vue-chartjs";
import {BarElement, CategoryScale, Chart, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip} from "chart.js";

Chart.register(BarElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);

export interface ChartSeries {
	label: string;
	data: number[];
	/** Vuetify theme color name. */
	color: string;
}

const props = withDefaults(defineProps<{
	type?: "bar" | "line";
	labels: string[];
	series: ChartSeries[];
	height?: number;
	stacked?: boolean;
}>(), {type: "bar", height: 220, stacked: false});

const theme = useTheme();
const color = (name: string): string => String(theme.current.value.colors[name] ?? "#888");

// Chart.js's generics don't model a bar/line switch well; the shape is the same for both.
const data = computed<any>(() => ({
	labels: props.labels,
	datasets: props.series.map((series) => ({
		label: series.label,
		data: series.data,
		backgroundColor: props.type === "line" ? `${color(series.color)}33` : color(series.color),
		borderColor: color(series.color),
		borderWidth: props.type === "line" ? 2 : 0,
		fill: props.type === "line",
		pointRadius: 0,
		tension: 0.25,
		borderRadius: 3,
	})),
}));

const options = computed<any>(() => {
	const text = color("on-surface");
	const grid = "rgba(128, 128, 128, 0.18)";
	return {
		responsive: true,
		maintainAspectRatio: false,
		interaction: {mode: "index" as const, intersect: false},
		plugins: {legend: {display: props.series.length > 1, labels: {color: text, boxWidth: 10}}},
		scales: {
			x: {stacked: props.stacked, ticks: {color: text, maxTicksLimit: 8}, grid: {display: false}},
			y: {stacked: props.stacked, beginAtZero: true, ticks: {color: text, precision: 0}, grid: {color: grid}},
		},
	};
});
</script>
