<template>
	<v-dialog
		v-model="dialog"
		width="480"
	>
		<v-card>
			<v-card-title>
				{{ t(AppLabels.LOAN_REPORT_TITLE) }}
			</v-card-title>

			<v-divider></v-divider>

			<v-card-text>
				<div class="loan-report-dates">
					<v-text-field
						v-model="dateFrom"
						type="date"
						:label="t(AppLabels.DATE_FROM)"
						density="compact"
						variant="outlined"
						autofocus
						hide-details
					/>
					<v-text-field
						v-model="dateTo"
						type="date"
						:label="t(AppLabels.DATE_TO)"
						density="compact"
						variant="outlined"
						hide-details
					/>
				</div>

				<v-select
					v-model="groupId"
					:items="groupItems"
					item-title="title"
					item-value="value"
					:label="t(AppLabels.GROUP)"
					density="compact"
					variant="outlined"
					hide-details
					class="mt-4"
				/>

				<v-select
					v-model="customerId"
					:items="customerItems"
					item-title="title"
					item-value="value"
					:label="t(AppLabels.CUSTOMER)"
					density="compact"
					variant="outlined"
					hide-details
					class="mt-4"
				/>
			</v-card-text>

			<v-divider></v-divider>

			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn
					variant="text"
					@click="closeDialog()"
					class="text-none"
				>
					{{ t(AppLabels.CLOSE) }}
				</v-btn>
				<v-btn
					color="primary"
					variant="elevated"
					:disabled="!canGenerate"
					:loading="loading"
					@click="generateReport()"
					class="text-none"
				>
					{{ t(AppLabels.GENERATE_REPORT) }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Excel report dialog for the Loans view: lets the user pick a (mandatory)
 * date range plus an optional group and customer, then downloads every
 * matching loan (returned or not, from `loan_history`) as an .xlsx file.
 */
import {computed, ref, Ref, watch} from 'vue';
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import LoansController from "@/controller/loans/LoansController";
import {api} from "@/plugins/api";
import {appSnackbarController, SnackbarType} from "@/components/appSnackbar/AppSnackbarController";

interface Props {
	controller: LoansController,
	modelValue: boolean
}

const props = defineProps<Props>();

const {t} = useI18n();

const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void
}>()

const dialog = computed({
	get: () => props.modelValue,
	set: (val: boolean) => emit('update:modelValue', val),
})

const loading: Ref<boolean> = ref(false);
const dateFrom: Ref<string | null> = ref(null);
const dateTo: Ref<string | null> = ref(null);
const groupId: Ref<number | null> = ref(null);
const customerId: Ref<number | null> = ref(null);

const groupItems = computed(() => [
	{title: t(AppLabels.ALL_GROUPS), value: null},
	...props.controller.getGroups().map((group) => ({title: group.name, value: group.id})),
]);

const customerItems = computed(() => [
	{title: t(AppLabels.ALL_CUSTOMERS), value: null},
	...props.controller.getCustomers()
		.filter((customer) => groupId.value === null || customer.group_id === groupId.value)
		.map((customer) => ({title: customer.name, value: customer.id})),
]);

const canGenerate = computed(() => !!dateFrom.value && !!dateTo.value && !loading.value);

// Changing the group can leave a previously-picked customer out of it.
watch(groupId, () => {
	if (!customerItems.value.some((item) => item.value === customerId.value)) {
		customerId.value = null;
	}
});

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString();
}

async function generateReport() {
	if (!canGenerate.value || !dateFrom.value || !dateTo.value) {
		return;
	}

	loading.value = true;
	try {
		const rows = await api.loans.getLoanHistory(dateFrom.value, dateTo.value, groupId.value, customerId.value);

		if (rows.length === 0) {
			appSnackbarController.show({message: t(AppLabels.NO_LOANS_FOUND), type: SnackbarType.ERROR});
			return;
		}

		// Lazily loaded: exceljs is ~900kB minified, not worth adding to the
		// Loans view's initial chunk for a feature used on demand.
		const {Workbook} = await import("exceljs");
		const workbook = new Workbook();
		const sheet = workbook.addWorksheet(t(AppLabels.LOANS));
		sheet.columns = [
			{header: t(AppLabels.BOOK), key: 'book', width: 32},
			{header: t(AppLabels.STOCK_CODE), key: 'stockCode', width: 14},
			{header: t(AppLabels.BOOKED_BY), key: 'customer', width: 24},
			{header: t(AppLabels.GROUP), key: 'group', width: 20},
			{header: t(AppLabels.LOANED_ON), key: 'loanedOn', width: 14},
			{header: t(AppLabels.RETURNED_ON), key: 'returnedOn', width: 16},
		];
		sheet.getRow(1).font = {bold: true};

		rows.forEach((row) => sheet.addRow({
			book: row.bookName,
			stockCode: row.stockCode,
			customer: row.customerName,
			group: row.groupName ?? '',
			loanedOn: formatDate(row.loanedAt),
			returnedOn: row.returnedAt ? formatDate(row.returnedAt) : t(AppLabels.STILL_ON_LOAN),
		}));

		const buffer = await workbook.xlsx.writeBuffer();
		const blob = new Blob([buffer], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `loans-${dateFrom.value}-to-${dateTo.value}.xlsx`;
		link.click();
		URL.revokeObjectURL(url);

		closeDialog();
	} finally {
		loading.value = false;
	}
}

function closeDialog() {
	dateFrom.value = null;
	dateTo.value = null;
	groupId.value = null;
	customerId.value = null;
	dialog.value = false;
}
</script>

<style scoped>
.loan-report-dates {
	display: flex;
	gap: 12px;
}

.loan-report-dates > * {
	flex: 1;
}
</style>
