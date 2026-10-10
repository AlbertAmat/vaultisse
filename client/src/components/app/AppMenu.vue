<template>
	<v-navigation-drawer
		v-model="menu"
		v-model:rail="rail"
		app
		width="240"
		class="app-menu"
		:expand-on-hover="railEnabled && !smAndDown"
		:permanent="!smAndDown"
		:temporary="smAndDown"
		:dark="true"
	>
		<div class="d-flex align-center pt-4 pb-3 ml-1 app-menu-header pr-1 pl-4">
			<svg v-if="theme.global.name.value === 'beige'" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
				<rect width="32" height="32" rx="8" fill="#f5e3d0" />
				<path d="M8 8.5C8 7.67 8.67 7 9.5 7H15v18H9.5A1.5 1.5 0 0 1 8 23.5v-15Z" fill="#a35f2c" />
				<path d="M24 8.5c0-.83-.67-1.5-1.5-1.5H17v18h5.5a1.5 1.5 0 0 0 1.5-1.5v-15Z" fill="#c97b3d" />
			</svg>
			<svg v-else width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
				<rect width="32" height="32" rx="7" fill="#0d1420" />
				<path d="M8 8.5C8 7.67 8.67 7 9.5 7H15v18H9.5A1.5 1.5 0 0 1 8 23.5v-15Z" fill="#1c7ff1" />
				<path d="M24 8.5c0-.83-.67-1.5-1.5-1.5H17v18h5.5a1.5 1.5 0 0 0 1.5-1.5v-15Z" fill="#78dcf6" />
			</svg>

			<!-- APP TITLE -->
			<span
				class="mx-2 app-menu-title pb-display"
				:class="{'app-menu-title--visible': !rail}"
			>
				Vaultisse
			</span>
		</div>

		<v-list
			v-model="selectedItem"
			v-model:opened="opened"
			:lines="false"
			density="compact"
			slim
			nav
			class="app-menu-list"
		>
			<v-list-item
				nav
				:to="dashboardRoute.getPath()"
				:value="dashboardRoute.getPath()"
				:title="t(AppLabels.DASHBOARD)"
				prepend-icon="mdi-chart-box-outline"
				density="compact"
				class="app-menu-item"
			/>

			<v-list-group value="library">
				<template v-slot:activator="{ props: activatorProps, isOpen }">
					<v-list-item
						v-bind="activatorProps"
						nav
						:to="searchRoute.getPath()"
						:active="false"
						:title="t(AppLabels.LIBRARY)"
						prepend-icon="mdi-bookshelf"
						density="compact"
						class="app-menu-item"
					>
						<template v-slot:append>
							<v-chip size="x-small" variant="tonal" class="app-menu-count mr-1">{{ counters.total }}</v-chip>
							<v-icon size="18" class="app-menu-expand-icon">{{ isOpen ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
						</template>
					</v-list-item>
				</template>

				<v-list-item
					:to="searchRoute.getPath()"
					:active="isLibraryViewAllActive"
					:title="t(AppLabels.VIEW_ALL)"
					density="compact"
					class="app-menu-item app-menu-subitem"
				>
					<template v-slot:append>
						<v-chip size="x-small" variant="tonal" class="app-menu-count">{{ counters.total }}</v-chip>
					</template>
				</v-list-item>

				<v-list-item
					:to="searchRoute.getPathForFilter(SearchFilter.RECENT)"
					:active="isLibraryRecentActive"
					:title="t(AppLabels.RECENT_FILTER)"
					density="compact"
					class="app-menu-item app-menu-subitem"
				>
					<template v-slot:append>
						<v-chip size="x-small" variant="tonal" class="app-menu-count">{{ counters.recent }}</v-chip>
					</template>
				</v-list-item>

				<v-list-item
					v-if="canEditCatalog && leasingEnabled"
					:to="searchRoute.getPathForFilter(SearchFilter.ON_LOAN)"
					:active="isLibraryOnLoanActive"
					:title="t(AppLabels.ON_LOAN_FILTER)"
					density="compact"
					class="app-menu-item app-menu-subitem"
				>
					<template v-slot:append>
						<v-chip size="x-small" variant="tonal" class="app-menu-count">{{ counters.onLoan }}</v-chip>
					</template>
				</v-list-item>

				<v-list-item
					:to="searchRoute.getPathForFilter(SearchFilter.NO_STOCK)"
					:active="isLibraryNoStockActive"
					:title="t(AppLabels.NO_STOCK_FILTER)"
					density="compact"
					class="app-menu-item app-menu-subitem"
				>
					<template v-slot:append>
						<v-chip size="x-small" variant="tonal" class="app-menu-count">{{ counters.noStock }}</v-chip>
					</template>
				</v-list-item>

				<v-list-item
					:to="searchRoute.getPathForFilter(SearchFilter.WANT_TO_READ)"
					:active="isLibraryWantToReadActive"
					:title="t(AppLabels.WANT_TO_READ)"
					density="compact"
					class="app-menu-item app-menu-subitem"
				>
					<template v-slot:append>
						<v-chip size="x-small" variant="tonal" class="app-menu-count">{{ counters.wantToRead }}</v-chip>
					</template>
				</v-list-item>

				<v-list-item
					:to="searchRoute.getPathForFilter(SearchFilter.CURRENTLY_READING)"
					:active="isLibraryCurrentlyReadingActive"
					:title="t(AppLabels.CURRENTLY_READING)"
					density="compact"
					class="app-menu-item app-menu-subitem"
				>
					<template v-slot:append>
						<v-chip size="x-small" variant="tonal" class="app-menu-count">{{ counters.currentlyReading }}</v-chip>
					</template>
				</v-list-item>
			</v-list-group>

			<v-list-item
				v-for="(item, index) in items"
				:key="index"
				nav
				:to="item.path"
				:value="item.path"
				:title="item.name"
				:prepend-icon="item.icon"
				density="compact"
				class="app-menu-item"
			/>
		</v-list>

		<div style="width: 100%;" class="pb-3">
			<v-divider class="app-menu-divider mb-2"></v-divider>

			<print-dialog v-if="canEditCatalog"/>

			<v-list-item
				nav
				href="https://docs.vaultisse.com"
				target="_blank"
				rel="noopener"
				:title="t(AppLabels.HELP)"
				prepend-icon="mdi-help-circle-outline"
				density="compact"
				class="mx-2 app-menu-item"
			/>
		</div>
	</v-navigation-drawer>
</template>

<script setup lang="ts">
/**
 * Left-hand navigation drawer: links to every top-level view, plus the print
 * queue and a Help link out to docs.vaultisse.com. Stays fully expanded by
 * default; if the user turns on
 * "Compact menu" in Settings (`users.sidebar_rail`, off by default) it
 * collapses to icon-only "rail" mode instead, expanding again on hover.
 * Styled as a dark "shelf frame" (see --pb-nav-* tokens) in both themes -
 * like the frame of a bookshelf standing in a bright or dim room.
 */
import {computed, onMounted, Ref, ref, watch} from "vue";
import {useRoute} from "vue-router";
import {useDisplay, useTheme} from "vuetify";
import {applicationService} from "@/service/ApplicationService";
import {navDrawerOpen} from "@/components/app/navDrawerState";
import {dashboardRoute} from "@/router/routes/DashboardRoute";
import {searchRoute} from "@/router/routes/SearchRoute";
import {locationsRoute} from "@/router/routes/LocationsRoute";
import {categoriesRoute} from "@/router/routes/CategoriesRoute";
import {customersRoute} from "@/router/routes/CustomersRoute";
import {authorsRoute} from "@/router/routes/AuthorsRoute";
import {loansRoute} from "@/router/routes/LoansRoute";
import {myLoansRoute} from "@/router/routes/MyLoansRoute";
import {SearchRoute} from "@/router/routes/SearchRoute";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import PrintDialog from "@/components/printDialog/PrintDialog.vue"
import {SearchFilter} from "@/types/search/SearchFilter";
import {IBookCounters} from "@/types/search/IBookCounters";
import {searchService} from "@/service/search/SearchService";

const route = useRoute()

const theme = useTheme();

const {t} = useI18n();

const {smAndDown} = useDisplay();

/**
 *
 */
const selectedItem: Ref<string | null> = ref(null);

/** Open state of the drawer - shared with `AppBar.vue`'s hamburger button. Starts closed on phone-sized screens, open otherwise. */
const menu = navDrawerOpen;
menu.value = !smAndDown.value;

// Force the drawer closed/open whenever the viewport crosses the phone-sized
// breakpoint, so e.g. rotating a phone to landscape doesn't leave a stray
// permanent-looking drawer open, and resizing back up doesn't leave it closed.
watch(smAndDown, (isSmall) => {
	menu.value = !isSmall;
});

// Navigating to a new page closes the temporary (phone) drawer, matching how
// a normal overlay/modal nav behaves.
watch(() => route.path, () => {
	if (smAndDown.value) {
		menu.value = false;
	}
});

/** Which nav list-groups are currently expanded (Vuetify's `v-list` `opened` model) - starts with "library" open if that's the current page. */
const opened: Ref<string[]> = ref(route.path === SearchRoute.PATH ? ["library"] : []);

/** Lightweight book totals (all/recent/on loan/no stock) shown as badges on the "Library" section and its quick filters. */
const counters: Ref<IBookCounters> = ref({total: 0, recent: 0, onLoan: 0, noStock: 0, wantToRead: 0, currentlyReading: 0});

/**
 * The "Library" quick filters all point to the same route path (only the
 * `filters` query param differs), so Vuetify's default `:to`-based active
 * detection (path-only, non-exact) would mark all four of them - and the
 * group header - active at once. Compute exact matches instead so only the
 * one actually selected lights up.
 */
const currentLibraryFilter = computed<string | undefined>(() => {
	if (route.path !== SearchRoute.PATH) return undefined;
	const filtersParam = route.query[SearchRoute.FILTERS_QUERY_PARAM];
	return filtersParam ? String(filtersParam) : undefined;
});

const isLibraryViewAllActive = computed(() => route.path === SearchRoute.PATH && !currentLibraryFilter.value);
const isLibraryRecentActive = computed(() => currentLibraryFilter.value === SearchFilter.RECENT);
const isLibraryOnLoanActive = computed(() => currentLibraryFilter.value === SearchFilter.ON_LOAN);
const isLibraryNoStockActive = computed(() => currentLibraryFilter.value === SearchFilter.NO_STOCK);
const isLibraryWantToReadActive = computed(() => currentLibraryFilter.value === SearchFilter.WANT_TO_READ);
const isLibraryCurrentlyReadingActive = computed(() => currentLibraryFilter.value === SearchFilter.CURRENTLY_READING);

onMounted(async () => {
	try {
		counters.value = await searchService.getCounters();
	} catch (e) {
		console.error("Error while fetching book counters", e);
	}
});

/** Whether rail (icon-only, expand-on-hover) mode is enabled - the user's saved Settings preference. Off by default. */
const railEnabled = computed(() => applicationService.getUser().isSidebarRail());

const rail: Ref<boolean> = ref(railEnabled.value);

// Keep the drawer in sync if the user toggles the preference in Settings
// without a page reload: rail mode fully off means always expanded.
watch(railEnabled, (enabled) => {
	rail.value = enabled;
});

/**
 *
 */
/** Whether the Loans and Customers pages are enabled - the user's saved Settings preference. Off by default. */
const leasingEnabled = computed(() => applicationService.getUser().isLeasingEnabled());

/** Roles that can't edit the catalog (borrower, readonly) only browse: no customers/loans management, no print queue. */
const canEditCatalog = applicationService.canEditCatalog();

const items = computed(() => [
	{
		name: t(AppLabels.LOCATIONS),
		icon: "mdi-map-marker-radius",
		path: locationsRoute.getPath()
	},
	...(canEditCatalog && leasingEnabled.value ? [
		{
			name: t(AppLabels.CUSTOMERS),
			icon: "mdi-account-school-outline",
			path: customersRoute.getPath()
		},
		{
			name: t(AppLabels.LOANS),
			icon: "mdi-book-arrow-right-outline",
			path: loansRoute.getPath()
		}
	] : []),
	...(applicationService.canBorrow() ? [
		{
			name: t(AppLabels.MY_LOANS),
			icon: "mdi-book-arrow-left-outline",
			path: myLoansRoute.getPath()
		}
	] : []),
	{
		name: t(AppLabels.CATEGORIES),
		icon: "mdi-shape-outline",
		path: categoriesRoute.getPath()
	},
	{
		name: t(AppLabels.AUTHORS),
		icon: "mdi-account-tie",
		path: authorsRoute.getPath()
	}
])

watch(() => route.path, (path) => {
	selectedItem.value = path || null;
	if (path === SearchRoute.PATH && !opened.value.includes("library")) {
		opened.value = [...opened.value, "library"];
	}
}, {immediate: true})

</script>

<style scoped>
.app-menu {
	background: var(--pb-nav-bg) !important;
	color: var(--pb-nav-text);
	border-right: 1px solid var(--pb-nav-border-strong) !important;
}

.app-menu-header {
	transition: padding 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.app-menu-title {
	white-space: nowrap;
	overflow: hidden;
	opacity: 0;
	transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	flex: 1;
	font-weight: 600;
	font-size: 17px;
	color: var(--pb-nav-text);
}

.app-menu-title--visible {
	opacity: 1;
}

.app-menu-list {
	flex: 1;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	padding-top: 4px;
}

.app-menu-item {
	border-radius: 10px;
	margin: 2px 8px;
	color: var(--pb-nav-text-muted);
}

.app-menu-subitem {
	font-size: 13px;
	min-height: 34px;
}

.app-menu-count {
	background: transparent !important;
	color: var(--pb-nav-text-muted) !important;
	font-size: 11px;
	pointer-events: none;
}

.app-menu :deep(.v-list-item--active) .app-menu-count {
	color: var(--pb-nav-accent) !important;
}

.app-menu-expand-icon {
	color: var(--pb-nav-text-muted);
}

.app-menu-divider {
	border-color: var(--pb-nav-border) !important;
}

.app-menu :deep(.v-list-item--active) {
	background: var(--pb-nav-active-bg);
	color: var(--pb-nav-accent);
	font-weight: 600;
	/*
	 * An inset box-shadow (not a real border) doesn't take up box-model
	 * space, so it never needs a padding-left compensation - which,
	 * for a sub-item, previously clobbered Vuetify's own inline indent
	 * style and made the active sub-item's left edge jump out to the
	 * same position as a top-level item.
	 */
	box-shadow: inset 3px 0 0 0 var(--pb-nav-accent);
}

.app-menu :deep(.v-list-item--active .v-icon) {
	color: var(--pb-nav-accent);
}

.app-menu >>> .v-navigation-drawer__border {
	display: none;
}

.app-menu >>> .v-navigation-drawer__content {
	display: flex;
	flex-direction: column;
}
</style>
