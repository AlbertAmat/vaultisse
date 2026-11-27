<template>
	<div class="page">
		<page-header title="Compliance" subtitle="ISO/IEC 27001:2022 controls measured against this installation, with GDPR and SOC 2 references. A working aid for your audit file, not a certificate.">
			<v-btn variant="tonal" prepend-icon="mdi-download-outline" href="/api/admin/compliance/export.csv" download>Statement of applicability</v-btn>
			<v-btn icon="mdi-refresh" variant="text" aria-label="Reload" :loading="loading" @click="load"/>
		</page-header>

		<v-row v-if="overview" class="mb-1">
			<v-col cols="12" md="4">
				<v-card class="pa-5 h-100 d-flex align-center ga-5">
					<v-progress-circular :model-value="overview.score" :size="96" :width="10" :color="overview.score >= 80 ? 'success' : overview.score >= 50 ? 'warning' : 'error'">
						<span class="text-h6 font-weight-bold">{{ overview.score }}%</span>
					</v-progress-circular>
					<div>
						<div class="text-subtitle-1 font-weight-medium">Readiness</div>
						<div class="text-body-2 text-medium-emphasis">of the {{ applicable }} controls that apply to you</div>
					</div>
				</v-card>
			</v-col>
			<v-col cols="12" md="8">
				<v-card class="pa-5 h-100">
					<div class="d-flex flex-wrap ga-2 mb-3">
						<v-chip v-for="o in outcomes" :key="o.value" :color="o.color" variant="tonal" :prepend-icon="o.icon" :class="{selected: outcome === o.value}" @click="outcome = outcome === o.value ? null : o.value">{{ overview.counts[o.value] }} {{ o.label }}</v-chip>
					</div>
					<div class="text-subtitle-2 mb-1">Needs attention</div>
					<p v-if="!overview.attention.length" class="text-body-2 text-medium-emphasis">Nothing is overdue.</p>
					<div v-for="item in overview.attention" :key="item.text" class="attention text-body-2" @click="tab = item.link"><v-icon size="16" color="warning">mdi-alert-circle-outline</v-icon> {{ item.text }}</div>
				</v-card>
			</v-col>
		</v-row>

		<v-tabs v-model="tab" color="primary" class="my-3">
			<v-tab value="controls">Controls</v-tab>
			<v-tab value="registers">Registers</v-tab>
			<v-tab value="incidents">Incidents</v-tab>
			<v-tab value="access">Access review</v-tab>
		</v-tabs>

		<v-card v-if="tab === 'controls'">
			<div class="d-flex flex-wrap ga-3 pa-4">
				<v-text-field v-model="search" prepend-inner-icon="mdi-magnify" placeholder="Search controls" clearable style="max-width: 320px"/>
				<v-select v-model="area" :items="areas" clearable placeholder="Any area" style="max-width: 200px"/>
				<v-select v-model="outcome" :items="outcomes.map((o) => ({title: o.label, value: o.value}))" clearable placeholder="Any status" style="max-width: 220px"/>
			</div>
			<div class="table-wrap">
				<v-table density="comfortable">
					<thead><tr><th>Control</th><th>Status</th><th>What the portal found</th><th>Owner</th><th>Review</th></tr></thead>
					<tbody>
						<tr v-for="c in filtered" :key="c.id" class="row-click" @click="open(c)">
							<td><div class="font-weight-medium">{{ c.id }} · {{ c.title }}</div><div class="text-caption text-medium-emphasis">{{ c.area }}<template v-if="c.refs.gdpr"> · GDPR {{ c.refs.gdpr }}</template><template v-if="c.refs.soc2"> · SOC 2 {{ c.refs.soc2 }}</template></div></td>
							<td><v-chip size="x-small" variant="tonal" :color="meta[c.outcome].color">{{ meta[c.outcome].label }}</v-chip></td>
							<td class="text-body-2" style="max-width: 420px">{{ c.measured?.detail ?? "Declared by a person: no automatic check." }}</td>
							<td>{{ c.record?.owner ?? "—" }}</td>
							<td class="text-no-wrap"><span :class="{'text-error': c.reviewOverdue}">{{ c.record?.nextReviewAt ? dateOnly(c.record.nextReviewAt) : "—" }}</span></td>
						</tr>
						<tr v-if="!filtered.length"><td colspan="5" class="text-center text-medium-emphasis pa-6">No control matches.</td></tr>
					</tbody>
				</v-table>
			</div>
			<p class="text-caption text-medium-emphasis pa-4 pt-2">Click a control to see what it asks for, record its owner and evidence, or declare that it doesn't apply (with a reason). Checks that run by themselves can't be turned green by hand: fix the cause.</p>
		</v-card>

		<register-panel v-else-if="tab === 'registers'" @changed="load"/>
		<incidents-panel v-else-if="tab === 'incidents'" @changed="load"/>
		<access-review-panel v-else @changed="load"/>

		<v-dialog v-model="dialog" max-width="640" scrollable>
			<v-card v-if="current">
				<v-card-title class="d-flex align-center ga-2">{{ current.id }} · {{ current.title }}<v-spacer/><v-chip size="small" variant="tonal" :color="meta[current.outcome].color">{{ meta[current.outcome].label }}</v-chip></v-card-title>
				<v-card-text>
					<p class="text-body-2 mb-2">{{ current.summary }}</p>
					<v-alert v-if="current.measured" :type="current.measured.state === 'pass' ? 'success' : current.measured.state === 'warn' ? 'warning' : 'error'" variant="tonal" density="compact" class="mb-3">{{ current.measured.detail }}</v-alert>
					<p v-if="current.howTo" class="text-body-2 mb-3"><strong>What to keep or do:</strong> {{ current.howTo }}</p>
					<p class="text-caption text-medium-emphasis mb-4">{{ current.refs.iso }}<template v-if="current.refs.gdpr"> · GDPR {{ current.refs.gdpr }}</template><template v-if="current.refs.soc2"> · SOC 2 {{ current.refs.soc2 }}</template></p>
					<v-select v-model="form.status" :items="statusItems" :label="current.measured ? 'Applicability' : 'Status'" clearable class="mb-3" :disabled="!canWrite()" :hint="current.measured ? 'Leave empty: the portal measures it. Choose “Not applicable” only with a reason.' : ''" persistent-hint/>
					<v-text-field v-model="form.owner" label="Owner" class="mb-3" maxlength="100" :disabled="!canWrite()"/>
					<v-textarea v-model="form.justification" label="Notes / justification" rows="3" auto-grow class="mb-3" maxlength="4000" :disabled="!canWrite()"/>
					<v-text-field v-model="form.evidenceUrl" label="Evidence link (policy, report, certificate)" placeholder="https://" class="mb-3" :disabled="!canWrite()"/>
					<v-text-field v-model="form.nextReviewAt" type="date" label="Next review" class="mb-1" :disabled="!canWrite()"/>
					<v-checkbox v-model="form.reviewed" label="I reviewed this control today" hide-details :disabled="!canWrite()"/>
					<p v-if="current.record?.reviewedAt" class="text-caption text-medium-emphasis">Last reviewed {{ dateTime(current.record.reviewedAt) }} by {{ current.record.reviewedBy ?? "an admin who was since removed" }}.</p>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="dialog = false">Close</v-btn><v-btn v-if="canWrite()" color="primary" variant="flat" :loading="saving" @click="save">Save</v-btn></v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref} from "vue";
import type {ControlOutcome, ControlStatus, IComplianceOverview, IControl} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateOnly, dateTime} from "@/utils/format";
import PageHeader from "@/components/PageHeader.vue";
import RegisterPanel from "@/components/RegisterPanel.vue";
import IncidentsPanel from "@/components/IncidentsPanel.vue";
import AccessReviewPanel from "@/components/AccessReviewPanel.vue";

const meta: Record<ControlOutcome, {label: string; color?: string; icon: string}> = {
	compliant: {label: "Implemented", color: "success", icon: "mdi-check-circle-outline"},
	partial: {label: "Partly", color: "warning", icon: "mdi-circle-half-full"},
	gap: {label: "Gap", color: "error", icon: "mdi-alert-circle-outline"},
	planned: {label: "Planned", color: "info", icon: "mdi-calendar-clock-outline"},
	not_assessed: {label: "Not assessed", icon: "mdi-help-circle-outline"},
	not_applicable: {label: "Not applicable", icon: "mdi-minus-circle-outline"},
};
const outcomes = (Object.keys(meta) as ControlOutcome[]).map((value) => ({value, ...meta[value]}));
const statusItems: {title: string; value: ControlStatus}[] = [
	{title: "Implemented", value: "implemented"}, {title: "Partly implemented", value: "partial"},
	{title: "Planned", value: "planned"}, {title: "Not applicable", value: "not_applicable"},
];
const areas = ["Organisational", "People", "Physical", "Technological"];

const overview = ref<IComplianceOverview | null>(null);
const loading = ref(false);
const tab = ref("controls");
const search = ref("");
const area = ref<string | null>(null);
const outcome = ref<ControlOutcome | null>(null);
const dialog = ref(false);
const current = ref<IControl | null>(null);
const saving = ref(false);
const form = reactive({status: null as ControlStatus | null, owner: "", justification: "", evidenceUrl: "", nextReviewAt: "", reviewed: false});

const applicable = computed(() => overview.value ? Object.entries(overview.value.counts).filter(([key]) => key !== "not_applicable").reduce((sum, [, n]) => sum + n, 0) : 0);
const filtered = computed(() => {
	const q = search.value?.trim().toLowerCase() ?? "";
	return (overview.value?.controls ?? []).filter((c) =>
		(!area.value || c.area === area.value) && (!outcome.value || c.outcome === outcome.value)
		&& (!q || `${c.id} ${c.title} ${c.summary} ${c.measured?.detail ?? ""}`.toLowerCase().includes(q)));
});

function open(control: IControl) {
	current.value = control;
	form.status = control.record?.status ?? null;
	form.owner = control.record?.owner ?? "";
	form.justification = control.record?.justification ?? "";
	form.evidenceUrl = control.record?.evidenceUrl ?? "";
	form.nextReviewAt = control.record?.nextReviewAt ?? "";
	form.reviewed = false;
	dialog.value = true;
}

async function save() {
	if (!current.value) return;
	saving.value = true;
	try {
		await api.compliance.saveControl(current.value.id, {
			status: form.status, owner: form.owner.trim() || null, justification: form.justification.trim() || null,
			evidenceUrl: form.evidenceUrl.trim() || null, nextReviewAt: form.nextReviewAt || null, reviewed: form.reviewed,
		});
		notify("Saved.");
		dialog.value = false;
		await load();
	} finally {
		saving.value = false;
	}
}

async function load() {
	loading.value = true;
	try {
		overview.value = await api.compliance.overview();
	} finally {
		loading.value = false;
	}
}

onMounted(load);
</script>

<style scoped>
.attention {
	cursor: pointer;
	padding: 2px 0;
}

.attention:hover {
	text-decoration: underline;
}

.selected {
	outline: 2px solid currentColor;
}
</style>
