<template>
	<page-component :model="controller">
		<template v-slot:append>
			<return-books-dialog @refresh="controller.refresh()"/>

			<v-btn
				@click="reportDialog = true"
				prepend-icon="mdi-file-excel-outline"
				class="text-none ml-3"
				color="primary"
				variant="elevated"
			>
				{{ t(AppLabels.GENERATE_REPORT) }}
			</v-btn>
		</template>

		<template v-slot:default>
			<div class="loans-filters">
				<v-select
					:model-value="controller.getGroupFilter()"
					@update:model-value="(value: number | null) => controller.setGroupFilter(value)"
					:items="groupItems"
					item-title="title"
					item-value="value"
					:label="t(AppLabels.GROUP)"
					density="compact"
					variant="outlined"
					class="loans-filter-group"
					hide-details
				/>

				<v-text-field
					:model-value="controller.getDateFrom()"
					@update:model-value="(value: string) => controller.setDateRange(value || null, controller.getDateTo())"
					type="date"
					:label="t(AppLabels.DATE_FROM)"
					density="compact"
					variant="outlined"
					class="loans-filter-date"
					hide-details
				/>

				<v-text-field
					:model-value="controller.getDateTo()"
					@update:model-value="(value: string) => controller.setDateRange(controller.getDateFrom(), value || null)"
					type="date"
					:label="t(AppLabels.DATE_TO)"
					density="compact"
					variant="outlined"
					class="loans-filter-date"
					hide-details
				/>
			</div>

			<empty-state
				v-if="controller.getLoans().length === 0"
				compact
				icon="mdi-book-check-outline"
				:title="t(AppLabels.EMPTY_LOANS_TITLE)"
				:description="t(AppLabels.EMPTY_LOANS_DESC)"
			/>

			<v-data-table-server
				v-else
				:headers="headers"
				:items="controller.getLoans()"
				:items-length="controller.getTotal()"
				:items-per-page="controller.getLimit() || 50"
				:items-per-page-options="[{title: String(controller.getLimit() || 50), value: controller.getLimit() || 50}]"
				:page="controller.getPage() + 1"
				@update:page="(page: number) => controller.setPage(page - 1)"
				density="compact"
				class="pb-card"
			>
				<template v-slot:item.cover="{ item }">
					<img
						:src="item.imageUrl ?? notFound"
						@error="onCoverError"
						class="loans-cover"
					/>
				</template>

				<template v-slot:item.bookName="{ item }">
					<router-link :to="bookRoute.getPath(item.bookId)" class="loans-book-link">
						{{ item.bookName }}
					</router-link>
				</template>

				<template v-slot:item.groupName="{ item }">
					<span v-if="item.groupName">{{ item.groupName }}</span>
					<span v-else class="loans-muted">—</span>
				</template>

				<template v-slot:item.loanedAt="{ item }">
					<span v-if="item.loanedAt">{{ formatDate(item.loanedAt) }}</span>
					<span v-else class="loans-muted">—</span>
				</template>

				<template v-slot:item.actions="{ item }">
					<v-btn
						@click="returnLoan(item.stockCode)"
						:loading="controller.getReturning().includes(item.stockCode)"
						:disabled="controller.getReturning().includes(item.stockCode)"
						class="text-none"
						size="small"
						variant="tonal"
						color="primary"
					>
						{{ t(AppLabels.RETURN) }}
					</v-btn>
				</template>
			</v-data-table-server>
		</template>
	</page-component>

	<loan-report-dialog
		v-model="reportDialog"
		:controller="controller"
	/>
</template>

<script setup lang="ts">
/**
 * Loans management view: a filterable (customer group, loan date range),
 * paginated table of every book currently on loan, with a per-row Return
 * action and a bulk `ReturnBooksDialog` in the toolbar, backed by
 * `LoansController`.
 */
import PageComponent from "@/views/PageComponent.vue";
import LoansController from "@/controller/loans/LoansController";
import EmptyState from "@/components/emptyState/EmptyState.vue";
import LoanReportDialog from "@/views/loans/LoanReportDialog.vue";
import ReturnBooksDialog from "@/views/loans/components/ReturnBooksDialog.vue";
import {computed, ref} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {bookRoute} from "@/router/routes/BookRoute";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
//@ts-ignore
import notFound from "@/assets/images/notFound.jpg";

const controller = new LoansController();
const reportDialog = ref(false);

const {t} = useI18n();

const headers = [
	{title: '', value: 'cover', sortable: false, width: 50},
	{title: t(AppLabels.BOOK), value: 'bookName', sortable: false},
	{title: t(AppLabels.BOOKED_BY), value: 'customerName', sortable: false},
	{title: t(AppLabels.GROUP), value: 'groupName', sortable: false},
	{title: t(AppLabels.LOANED_ON), value: 'loanedAt', sortable: false},
	{title: t(AppLabels.ACTIONS), value: 'actions', sortable: false, align: 'end' as const},
];

const groupItems = computed(() => [
	{title: t(AppLabels.ALL_GROUPS), value: null},
	...controller.getGroups().map((group) => ({title: group.name, value: group.id})),
]);

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString();
}

function onCoverError(event: Event) {
	const img = event.target as HTMLImageElement;
	img.onerror = null;
	img.src = notFound;
}

async function returnLoan(stockCode: string) {
	await controller.returnLoan(stockCode);
	appSnackbarController.show({message: t(AppLabels.SNACKBAR_RETURN_BOOKS)});
}
</script>

<style scoped lang="scss">
.loans-filters {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	margin-bottom: 16px;
}

.loans-filter-group {
	max-width: 220px;
}

.loans-filter-date {
	max-width: 170px;
}

.loans-cover {
	width: 30px;
	height: 42px;
	object-fit: cover;
	border-radius: 3px;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
	display: block;
	margin: 6px 0;
}

.loans-book-link {
	color: var(--pb-text);
	font-weight: 500;
	text-decoration: none;
}

.loans-book-link:hover {
	color: var(--pb-accent);
}

.loans-muted {
	color: var(--pb-text-muted);
}
</style>
