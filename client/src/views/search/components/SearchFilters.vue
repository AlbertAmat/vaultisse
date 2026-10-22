<template>
	<div v-if="model.hasActiveFilters()" class="search-filters">
		<v-chip
			v-for="filter in selectedFilters"
			:key="filter.value"
			label
			class="mr-2"
			closable
			color="primary"
			@click:close="model.removeFilter(filter.value)"
		>{{ filter.title }}</v-chip>

		<v-chip
			v-if="model.hasDateRange()"
			label
			closable
			color="primary"
			@click:close="model.clearDateRange()"
		>{{ dateRangeLabel }}</v-chip>

		<v-chip
			v-if="categoryLabel"
			label
			closable
			color="primary"
			@click:close="model.clearCategoryId()"
		>{{ categoryLabel }}</v-chip>
	</div>
</template>

<script setup lang="ts">
/**
 * Search view's active-filter summary: removable chips for the current
 * `SearchFilter`(s) and upload-date range - adding/changing them now happens
 * from the filter menu docked in the global search box (see `AppBar.vue`),
 * which drives the same `SearchController` via `activeSearchController`.
 * Renders nothing when no filter/date range is active, to keep the library
 * view's toolbar area free.
 */
import SearchController from "@/controller/search/SearchController";
import {SearchFilter} from "@vaultisse/types/search/SearchFilter";
import {computed} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "../../../plugins/i18n/AppLabels";
import {applicationService} from "@/service/ApplicationService";

interface Props {
	model: SearchController
}

const props = defineProps<Props>();

const {t} = useI18n();

const filters = computed(() => [
	{
		title: t(AppLabels.NO_STOCK_FILTER),
		value: SearchFilter.NO_STOCK
	},
	{
		title: t(AppLabels.HAS_STOCK_FILTER),
		value: SearchFilter.HAS_STOCK
	},
	...(applicationService.isLoansEnabled() ? [
		{
			title: t(AppLabels.ON_LOAN_FILTER),
			value: SearchFilter.ON_LOAN
		}
	] : []),
	{
		title: t(AppLabels.RECENT_FILTER),
		value: SearchFilter.RECENT
	},
	{
		title: t(AppLabels.WANT_TO_READ),
		value: SearchFilter.WANT_TO_READ
	},
	{
		title: t(AppLabels.CURRENTLY_READING),
		value: SearchFilter.CURRENTLY_READING
	}
])

const selectedFilters = computed(() => {
	return props.model.getFilters().map((filterValue) => {
		return filters.value.find((filter) => filter.value == filterValue) as Record<string, any>
	})
})

const dateRangeLabel = computed(() => {
	const from = props.model.getDateFrom();
	const to = props.model.getDateTo();
	if (from && to) return `${from} – ${to}`;
	if (from) return `${t(AppLabels.DATE_FROM)} ${from}`;
	return `${t(AppLabels.DATE_TO)} ${to}`;
})

const categoryLabel = computed(() => {
	const categoryId = props.model.getCategoryId();
	if (categoryId === null) return null;
	return applicationService.getCategory(categoryId)?.getCategoryName() ?? null;
})
</script>

<style scoped>
.search-filters {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
}
</style>
