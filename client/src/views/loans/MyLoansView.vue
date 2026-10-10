<template>
	<page-component :model="controller">
		<template v-slot:default>
			<v-tabs v-model="activeTab" density="compact" class="mb-4" color="primary">
				<v-tab value="current" class="text-none">{{ t(AppLabels.LOANS) }}</v-tab>
				<v-tab value="history" class="text-none">{{ t(AppLabels.LOAN_HISTORY) }}</v-tab>
			</v-tabs>

			<template v-if="activeTab === 'current'">
				<empty-state
					v-if="controller.getLoans().length === 0"
					compact
					icon="mdi-book-check-outline"
					:title="t(AppLabels.EMPTY_LOANS_TITLE)"
					:description="t(AppLabels.MY_LOANS_EMPTY_DESC)"
				/>

				<v-data-table
					v-else
					:headers="loanHeaders"
					:items="controller.getLoans()"
					density="compact"
					class="pb-card"
				>
					<template v-slot:item.cover="{ item }">
						<img :src="item.imageUrl ?? notFound" @error="onCoverError" class="my-loans-cover"/>
					</template>

					<template v-slot:item.bookName="{ item }">
						<router-link :to="bookRoute.getPath(item.bookId)">{{ item.bookName }}</router-link>
					</template>

					<template v-slot:item.loanedAt="{ item }">
						<span v-if="item.loanedAt">{{ formatDate(item.loanedAt) }}</span>
						<span v-else class="my-loans-muted">—</span>
					</template>
				</v-data-table>
			</template>

			<template v-else>
				<empty-state
					v-if="controller.getHistory().length === 0"
					compact
					icon="mdi-history"
					:title="t(AppLabels.MY_LOAN_HISTORY_EMPTY)"
				/>

				<v-data-table
					v-else
					:headers="historyHeaders"
					:items="controller.getHistory()"
					density="compact"
					class="pb-card"
				>
					<template v-slot:item.bookName="{ item }">
						<router-link v-if="item.bookId !== null" :to="bookRoute.getPath(item.bookId)">{{ item.bookName }}</router-link>
						<span v-else>{{ item.bookName }}</span>
					</template>

					<template v-slot:item.loanedAt="{ item }">{{ formatDate(item.loanedAt) }}</template>

					<template v-slot:item.returnedAt="{ item }">
						<span v-if="item.returnedAt">{{ formatDate(item.returnedAt) }}</span>
						<v-chip v-else size="small" color="primary" variant="tonal">{{ t(AppLabels.STILL_ON_LOAN) }}</v-chip>
					</template>
				</v-data-table>
			</template>
		</template>
	</page-component>
</template>

<script setup lang="ts">
/**
 * "My loans" view for vault members who borrow books: a tab with the copies
 * currently on loan to them and a tab with their whole loan history, backed
 * by `MyLoansController`. Read-only - returning a book is done by whoever
 * runs the library.
 */
import PageComponent from "@/views/PageComponent.vue";
import EmptyState from "@/components/emptyState/EmptyState.vue";
import MyLoansController from "@/controller/loans/MyLoansController";
import {ref} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {bookRoute} from "@/router/routes/BookRoute";
//@ts-ignore
import notFound from "@/assets/images/notFound.jpg";

const controller = new MyLoansController();
const {t} = useI18n();

/** Which tab is showing: the copies on loan now, or the whole history. */
const activeTab = ref<"current" | "history">("current");

const loanHeaders = [
	{title: '', value: 'cover', sortable: false, width: 50},
	{title: t(AppLabels.BOOK), value: 'bookName', sortable: false},
	{title: t(AppLabels.STOCK_CODE), value: 'stockCode', sortable: false},
	{title: t(AppLabels.LOANED_ON), value: 'loanedAt', sortable: false},
];

const historyHeaders = [
	{title: t(AppLabels.BOOK), value: 'bookName', sortable: false},
	{title: t(AppLabels.STOCK_CODE), value: 'stockCode', sortable: false},
	{title: t(AppLabels.LOANED_ON), value: 'loanedAt', sortable: false},
	{title: t(AppLabels.RETURNED_ON), value: 'returnedAt', sortable: false},
];

/** @param iso ISO timestamp. @returns The date in the user's locale. */
function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString();
}

/** Falls back to the placeholder cover when an image fails to load. */
function onCoverError(event: Event) {
	const img = event.target as HTMLImageElement;
	img.onerror = null;
	img.src = notFound;
}
</script>

<style scoped lang="scss">
.my-loans-cover {
	width: 30px;
	height: 42px;
	object-fit: cover;
	border-radius: 3px;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
	display: block;
	margin: 6px 0;
}

.my-loans-muted {
	opacity: 0.6;
}
</style>
