<template>
	<v-menu
		v-model="filterMenu"
		:close-on-content-click="false"
	>
		<template v-slot:activator="{ props }">
			<v-btn
				v-bind="props"
				icon
				variant="text"
				density="compact"
				:color="hasActiveFilters ? 'primary' : undefined"
			>
				<v-icon size="20">mdi-filter-variant</v-icon>
			</v-btn>
		</template>

		<v-card min-width="260" class="pa-2">
			<div class="text-caption text-medium-emphasis px-2 pt-1">{{ t(AppLabels.ADD_FILTER) }}</div>
			<v-list density="compact">
				<v-list-item
					v-for="f in filterOptions"
					:key="f.value"
					@click="toggleFilter(f.value)"
				>
					<template v-slot:prepend>
						<v-icon size="18">{{ isFilterActive(f.value) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}</v-icon>
					</template>
					<v-list-item-title>{{ f.title }}</v-list-item-title>
				</v-list-item>
			</v-list>

			<v-divider class="my-2"/>

			<div class="px-2 pb-2">
				<div class="text-caption text-medium-emphasis mb-2">{{ t(AppLabels.CATEGORY_FILTER) }}</div>
				<v-select
					v-model="categoryInput"
					:items="categoryOptions"
					item-title="title"
					item-value="value"
					density="compact"
					variant="outlined"
					hide-details
					@update:model-value="applyCategory"
				/>
			</div>

			<v-divider class="my-2"/>

			<div class="px-2 pb-2">
				<div class="text-caption text-medium-emphasis mb-2">{{ t(AppLabels.UPLOAD_DATE_FILTER) }}</div>
				<v-text-field
					v-model="dateFromInput"
					:label="t(AppLabels.DATE_FROM)"
					type="date"
					density="compact"
					hide-details
					class="mb-3"
				/>
				<v-text-field
					v-model="dateToInput"
					:label="t(AppLabels.DATE_TO)"
					type="date"
					density="compact"
					hide-details
				/>
				<div class="d-flex justify-end mt-3">
					<v-btn variant="text" class="text-none mr-2" @click="clearDateRange">{{t(AppLabels.CLEAR)}}</v-btn>
					<v-btn color="primary" class="text-none" @click="applyDateRange">{{t(AppLabels.APPLY)}}</v-btn>
				</div>
			</div>
		</v-card>
	</v-menu>
</template>

<script setup lang="ts">
/**
 * Filter icon + menu docked in the global search box (see `AppBar.vue`), so
 * it's always visible - self-contained the same way `BarcodeScanner.vue` is,
 * since Vuetify's `v-menu` overlay breaks when inlined directly inside a
 * `v-text-field`'s `append-inner` slot template.
 *
 * While the library page is mounted (see `activeSearchController`), it drives
 * that page's own `SearchController` directly - filters/category apply live,
 * no navigation. From any other page there's no live controller to mutate, so
 * toggling a filter/category/applying a date range instead navigates to the
 * library page with that filter set already in the URL
 * (`SearchRoute.getPathForFilters`); `SearchController` picks the same params
 * back up on mount.
 */
import {computed, ref, Ref, watch} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {activeSearchController} from "@/controller/search/SearchController";
import {SearchFilter} from "@/types/search/SearchFilter";
import router from "@/router/Router";
import {searchRoute} from "@/router/routes/SearchRoute";
import {applicationService} from "@/service/ApplicationService";

const {t} = useI18n();

const filterMenu: Ref<boolean> = ref(false);
const dateFromInput: Ref<string | null> = ref(null);
const dateToInput: Ref<string | null> = ref(null);
const categoryInput: Ref<number | null> = ref(null);

const categoryOptions = computed(() => [
	{title: t(AppLabels.ALL_CATEGORIES), value: null},
	...applicationService.getCategories().map((category) => ({
		title: category.getCategoryName(),
		value: category.getCategoryId()
	}))
]);

/** Staged filter selection, used only while there's no live `activeSearchController` (see file doc). */
const pendingFilters: Ref<SearchFilter[]> = ref([]);

const filterOptions = computed(() => [
	{title: t(AppLabels.NO_STOCK_FILTER), value: SearchFilter.NO_STOCK},
	{title: t(AppLabels.HAS_STOCK_FILTER), value: SearchFilter.HAS_STOCK},
	...(applicationService.canEditCatalog() && applicationService.getUser().isLeasingEnabled() ? [
		{title: t(AppLabels.ON_LOAN_FILTER), value: SearchFilter.ON_LOAN}
	] : []),
	{title: t(AppLabels.RECENT_FILTER), value: SearchFilter.RECENT},
	{title: t(AppLabels.WANT_TO_READ), value: SearchFilter.WANT_TO_READ},
	{title: t(AppLabels.CURRENTLY_READING), value: SearchFilter.CURRENTLY_READING}
]);

const hasActiveFilters = computed(() => {
	if (activeSearchController.value) {
		return activeSearchController.value.hasActiveFilters();
	}
	return pendingFilters.value.length > 0 || categoryInput.value !== null;
});

function isFilterActive(filter: SearchFilter): boolean {
	if (activeSearchController.value) {
		return activeSearchController.value.getFilters().includes(filter);
	}
	return pendingFilters.value.includes(filter);
}

function toggleFilter(filter: SearchFilter) {
	const controller = activeSearchController.value;
	if (controller) {
		if (controller.getFilters().includes(filter)) {
			controller.removeFilter(filter);
		} else {
			controller.addFilter(filter);
		}
		return;
	}

	// Not on the library page - jump there with the toggled filter set applied
	// instead of mutating a controller that doesn't exist yet.
	pendingFilters.value = pendingFilters.value.includes(filter)
		? pendingFilters.value.filter((f) => f !== filter)
		: [...pendingFilters.value, filter];

	router.push(searchRoute.getPathForFilters({
		filters: pendingFilters.value,
		dateFrom: dateFromInput.value,
		dateTo: dateToInput.value,
		categoryId: categoryInput.value
	}));
}

function applyCategory(categoryId: number | null) {
	const controller = activeSearchController.value;
	if (controller) {
		controller.setCategoryId(categoryId);
		return;
	}

	router.push(searchRoute.getPathForFilters({
		filters: pendingFilters.value,
		dateFrom: dateFromInput.value,
		dateTo: dateToInput.value,
		categoryId
	}));
}

// Reset the draft filters/dates/category to whatever's actually active each
// time the menu opens - the live controller's state while on the library
// page, or a blank slate (not last page's leftover picks) everywhere else.
watch(filterMenu, (open) => {
	if (!open) return;
	if (activeSearchController.value) {
		dateFromInput.value = activeSearchController.value.getDateFrom();
		dateToInput.value = activeSearchController.value.getDateTo();
		categoryInput.value = activeSearchController.value.getCategoryId();
	} else {
		pendingFilters.value = [];
		dateFromInput.value = null;
		dateToInput.value = null;
		categoryInput.value = null;
	}
});

function applyDateRange() {
	const controller = activeSearchController.value;
	if (controller) {
		controller.setDateRange(dateFromInput.value || null, dateToInput.value || null);
	} else {
		router.push(searchRoute.getPathForFilters({
			filters: pendingFilters.value,
			dateFrom: dateFromInput.value || null,
			dateTo: dateToInput.value || null,
			categoryId: categoryInput.value
		}));
	}
	filterMenu.value = false;
}

function clearDateRange() {
	dateFromInput.value = null;
	dateToInput.value = null;
	activeSearchController.value?.clearDateRange();
}
</script>
