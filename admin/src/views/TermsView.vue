<template>
	<div class="page">
		<page-header title="Terms & notices" subtitle="Who has accepted the Terms of Service and the security notice, who was asked but hasn't answered, and who hasn't been asked yet.">
			<v-btn variant="tonal" prepend-icon="mdi-download-outline" :href="exportUrl" download>Export CSV</v-btn>
		</page-header>

		<v-row v-if="summary">
			<v-col v-for="d in docs" :key="d.value" cols="12" md="6">
				<v-card class="pa-5 h-100 doc" :class="{selected: doc === d.value}" @click="select(d.value)">
					<div class="d-flex align-center ga-2 mb-3">
						<v-icon>{{ d.icon }}</v-icon>
						<div class="text-subtitle-1 font-weight-medium">{{ d.label }}</div>
						<v-spacer/>
						<span class="text-h5 font-weight-bold">{{ percent(summary[d.value]) }}%</span>
					</div>
					<v-progress-linear :model-value="percent(summary[d.value])" color="success" height="8" rounded/>
					<div class="d-flex flex-wrap ga-2 mt-3">
						<v-chip size="small" color="success" variant="tonal" prepend-icon="mdi-check">{{ summary[d.value].accepted }} accepted</v-chip>
						<v-chip size="small" color="warning" variant="tonal" prepend-icon="mdi-clock-outline">{{ summary[d.value].pending }} asked, no answer</v-chip>
						<v-chip size="small" variant="tonal" prepend-icon="mdi-help-circle-outline">{{ summary[d.value].never }} not asked yet</v-chip>
					</div>
				</v-card>
			</v-col>
		</v-row>

		<v-card class="mt-4">
			<div class="d-flex flex-wrap ga-3 pa-4">
				<v-select v-model="doc" :items="docs.map((d) => ({title: d.label, value: d.value}))" style="max-width: 260px" @update:model-value="reload"/>
				<v-select v-model="status" :items="statuses" clearable placeholder="Any status" style="max-width: 240px" @update:model-value="reload"/>
				<v-text-field v-model="search" prepend-inner-icon="mdi-magnify" placeholder="Search by name, username or email" clearable style="max-width: 340px" @update:model-value="debounced"/>
			</div>
			<div class="table-wrap">
				<v-table density="comfortable">
					<thead><tr><th>Account</th><th>Status</th><th>Asked</th><th>Accepted</th></tr></thead>
					<tbody>
						<tr v-for="row in items" :key="row.id">
							<td><div class="font-weight-medium">{{ row.name }}<v-chip v-if="row.disabled" size="x-small" variant="tonal" class="ml-2">disabled</v-chip></div><div class="text-caption text-medium-emphasis">{{ row.code }} · {{ row.email }}</div></td>
							<td><v-chip size="x-small" variant="tonal" :color="color[row.status]">{{ text[row.status] }}</v-chip></td>
							<td>{{ dateOnly(row.askedDate) }}</td>
							<td>{{ dateOnly(row.acceptedDate) }}</td>
						</tr>
						<tr v-if="!items.length && !loading"><td colspan="4" class="text-center text-medium-emphasis pa-8">Nobody matches.</td></tr>
					</tbody>
				</v-table>
			</div>
			<pager :page="page" :page-size="pageSize" :total="total" @update:page="page = $event; load()"/>
		</v-card>
		<p class="text-caption text-medium-emphasis mt-3">"Not asked yet" usually means the account hasn't signed in since the document was introduced: the app asks at the next sign-in. The CSV has every account matching the current filter.</p>
	</div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import type {ITermsCounts, ITermsRow, TermsDocument, TermsStatus} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {dateOnly} from "@/utils/format";
import PageHeader from "@/components/PageHeader.vue";
import Pager from "@/components/Pager.vue";

const docs: {value: TermsDocument; label: string; icon: string}[] = [
	{value: "tos", label: "Terms of Service", icon: "mdi-file-sign"},
	{value: "security", label: "Security notice", icon: "mdi-shield-check-outline"},
];
const statuses = [{title: "Accepted", value: "accepted"}, {title: "Asked, no answer yet", value: "pending"}, {title: "Not asked yet", value: "never"}];
const text: Record<TermsStatus, string> = {accepted: "Accepted", pending: "Asked", never: "Not asked"};
const color: Record<TermsStatus, string | undefined> = {accepted: "success", pending: "warning", never: undefined};

const summary = ref<Record<TermsDocument, ITermsCounts> | null>(null);
const doc = ref<TermsDocument>("tos");
const status = ref<TermsStatus | null>(null);
const search = ref("");
const items = ref<ITermsRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 25;
const loading = ref(false);

const percent = (counts: ITermsCounts) => (counts.total === 0 ? 0 : Math.round((counts.accepted * 100) / counts.total));
const exportUrl = computed(() => api.terms.exportUrl({doc: doc.value, status: status.value ?? undefined, search: search.value || undefined}));

async function load() {
	loading.value = true;
	try {
		const result = await api.terms.list({doc: doc.value, status: status.value ?? undefined, search: search.value ?? "", page: page.value, pageSize});
		items.value = result.items;
		total.value = result.total;
	} finally {
		loading.value = false;
	}
}

function reload() {
	page.value = 1;
	return load();
}

function select(value: TermsDocument) {
	doc.value = value;
	reload();
}

let timer: ReturnType<typeof setTimeout> | undefined;
const debounced = () => {
	clearTimeout(timer);
	timer = setTimeout(reload, 300);
};

onMounted(async () => {
	summary.value = await api.terms.summary();
	await load();
});
</script>

<style scoped>
.doc {
	cursor: pointer;
}

.doc.selected {
	border-color: rgb(var(--v-theme-primary)) !important;
}
</style>
