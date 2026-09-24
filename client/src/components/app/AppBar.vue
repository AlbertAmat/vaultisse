<template>
	<v-app-bar
		app
		density="compact"
		class="app-bar"
		:class="smAndDown ? 'px-2' : 'px-5'"
		border
		:elevation="0"
	>
		<v-app-bar-nav-icon
			v-if="smAndDown"
			@click="navDrawerOpen = !navDrawerOpen"
		/>

		<vault-switcher/>

		<v-text-field
			v-model="searchInput"
			:placeholder="t(AppLabels.SEARCH_BOOKS)"
			density="compact"
			:details="false"
			hide-details
			prepend-inner-icon="mdi-magnify"
			variant="solo"
			flat
			rounded="pill"
			@keydown.enter="doSearch()"
			class="app-bar-search"
		>
			<template v-slot:append-inner>
				<search-toolbar-filter-menu/>
				<barcode-scanner @value="searchBarcode"/>
			</template>
		</v-text-field>

		<v-spacer v-if="!smAndDown"></v-spacer>

		<user-menu/>
	</v-app-bar>
</template>

<script setup lang="ts">
/**
 * Top app bar: the global book search box (typed or via barcode scan) and
 * the user menu. Submitting navigates to the search/library route with the
 * query string set, letting `SearchController` pick it up.
 */
import {ref, Ref} from "vue";
import {useDisplay} from "vuetify";
import {SearchRoute, searchRoute} from "@/router/routes/SearchRoute";
import router from "@/router/Router";
import UserMenu from "@/components/app/UserMenu.vue";
import VaultSwitcher from "@/components/app/VaultSwitcher.vue";
import BarcodeScanner from "@/components/barcodeScanner/BarcodeScanner.vue";
import SearchToolbarFilterMenu from "@/components/app/SearchToolbarFilterMenu.vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {navDrawerOpen} from "@/components/app/navDrawerState";

const {t} = useI18n();

const {smAndDown} = useDisplay();

const params = router.currentRoute.value.query;
const query = params[SearchRoute.QUERY_PARAM] ? params[SearchRoute.QUERY_PARAM] as string || "" : "";

const searchInput: Ref<string> = ref(query);

function doSearch() {
	const search = searchInput.value.trim();
	router.push(searchRoute.getPath(search));
}

function searchBarcode(value: string) {
	searchInput.value = value;
	doSearch()
}
</script>

<style scoped lang="scss">
.app-bar {
	background: var(--pb-surface) !important;
	border-color: var(--pb-border) !important;
}

.app-bar :deep(.v-toolbar__content) {
	position: relative;
}

.app-bar-search {
	position: absolute;
	left: 50%;
	transform: translateX(-50%);
	width: 100%;
	max-width: 340px;
}

.app-bar-search :deep(.v-field) {
	background: var(--pb-surface-alt);
	border: 1px solid var(--pb-border);
}

/*
 * Below the phone breakpoint there isn't room to both center this absolutely
 * and reserve flex space for the nav icon/user menu either side of it - it
 * would overlap them. Drop it back into normal flow instead, sized to
 * whatever's left between the two.
 */
@media (max-width: 600px) {
	.app-bar-search {
		position: static;
		transform: none;
		width: auto;
		max-width: none;
		flex: 1 1 auto;
		min-width: 0;
	}
}
</style>