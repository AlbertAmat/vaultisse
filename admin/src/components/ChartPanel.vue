<template>
	<div :style="{height: `${height}px`}">
		<component :is="type === 'line' ? Line : type === 'doughnut' ? Doughnut : Bar" :data="data" :options="options"/>
	</div>
</template>

<script setup lang="ts">
import {computed} from "vue";
import {useTheme} from "vuetify";
import {Bar, Doughnut, Line} from "vue-chartjs";
import {ArcElement, BarElement, CategoryScale, Chart, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip} from "chart.js";

Chart.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);

export interface ChartSeries {
	label: string;
	data: number[];
	/** Vuetify theme color name. */
	color: string;
}

const props = withDefaults(defineProps<{
	type?: "bar" | "line" | "doughnut";
	/** Bars growing sideways (for long labels). */
	horizontal?: boolean;
	/** Doughnut: Vuetify colour name of each slice, in order. */
	colors?: string[];
	labels: string[];
	series: ChartSeries[];
	height?: number;
	stacked?: boolean;
}>(), {type: "bar", height: 220, stacked: false, horizontal: false, colors: () => ["primary", "secondary", "info", "warning", "success", "error"]});

const theme = useTheme();
const color = (name: string): string => String(theme.current.value.colors[name] ?? "#888");

// Chart.js's generics don't model a bar/line switch well; the shape is the same for both.
const data = computed<any>(() => {
	if (props.type === "doughnut") {
		return {
			labels: props.labels,
			datasets: [{data: props.series[0]?.data ?? [], backgroundColor: props.labels.map((_, i) => color(props.colors[i % props.colors.length])), borderWidth: 2, borderColor: color("surface")}],
		};
	}
	return {
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
	};
});

const options = computed<any>(() => {
	const text = color("on-surface");
	const grid = "rgba(128, 128, 128, 0.18)";
	if (props.type === "doughnut") {
		return {responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: {legend: {position: "right", labels: {color: text, boxWidth: 10}}}};
	}
	if (props.horizontal) {
		return {
			responsive: true,
			maintainAspectRatio: false,
			indexAxis: "y",
			plugins: {legend: {display: props.series.length > 1, labels: {color: text, boxWidth: 10}}},
			scales: {
				x: {stacked: props.stacked, beginAtZero: true, ticks: {color: text, precision: 0}, grid: {color: grid}},
				y: {stacked: props.stacked, ticks: {color: text}, grid: {display: false}},
			},
		};
	}
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
