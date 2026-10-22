<template>
	<div v-if="data && data.length">
		<LineChartComponent :data="chartData" :options="chartOptions"/>
	</div>
	<div v-else class="text-gray-500 text-sm">Loading chart...</div>
</template>

<script setup lang="ts">
/** Line chart of books added per month (Chart.js via vue-chartjs), fed by `IDashboard.booksInTime`. */
import {computed} from 'vue';
import {
	Chart as ChartJS,
	Title,
	Tooltip,
	Legend,
	LineElement,
	PointElement,
	CategoryScale,
	LinearScale
} from 'chart.js';
import {Line as LineChartComponent} from 'vue-chartjs';
import {IBooksInTime} from "@vaultisse/types/dashboard/IDashboard";
import {useI18n} from "vue-i18n";
import {useTheme} from "vuetify";
import {AppLabels} from "@/plugins/i18n/AppLabels";

// Register Chart.js modules
ChartJS.register(
	Title,
	Tooltip,
	Legend,
	LineElement,
	PointElement,
	CategoryScale,
	LinearScale
);

const {t} = useI18n();
const theme = useTheme();

/** Vuetify 4 types theme colors as string | number | color objects; ours (plugins/vuetify.ts) are hex strings. */
const primaryColor = () => theme.current.value.colors.primary as string;

interface Props {
	data: IBooksInTime[];
}

const props = defineProps<Props>()

const chartData = computed(() => ({
	labels: props.data.map(item =>
		new Date(item.month).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short'
		})
	),
	datasets: [
		{
			label: t(AppLabels.DASHBOARD_BOOKS_ADDED_TIME_OVER_TIME),
			data: props.data.map(item => item.total_books),
			borderColor: primaryColor(),
			backgroundColor: primaryColor(),
			fill: false,
			tension: 0.3
		}
	]
}));

// Chart.js defaults to dark tick/legend text, which is unreadable on the
// dark "library" theme - derive grid/tick/legend colors from the active
// Vuetify theme instead of leaving them hardcoded.
const chartOptions = computed(() => {
	const gridColor = theme.current.value.dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)';
	const textColor = theme.current.value.dark ? '#8b94a7' : '#7d7364';

	return {
		responsive: true,
		plugins: {
			legend: {display: true, labels: {color: textColor}}
		},
		scales: {
			x: {ticks: {color: textColor}, grid: {color: gridColor}},
			y: {beginAtZero: true, ticks: {color: textColor}, grid: {color: gridColor}}
		}
	};
});
</script>
