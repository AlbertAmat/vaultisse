<template>
	<div>
		<v-alert type="info" variant="tonal" density="compact" class="mb-3" icon="mdi-clock-alert-outline">
			A breach of personal data must be reported to the data protection authority <strong>within 72 hours</strong> of becoming aware of it (GDPR art. 33), and to the people affected when the risk to them is high (art. 34). Incidents are closed, never deleted: the record is the evidence.
		</v-alert>
		<v-card>
			<div class="d-flex align-center pa-4 pb-0">
				<div class="text-subtitle-1 font-weight-medium">Security incidents</div>
				<v-spacer/>
				<v-btn v-if="canWrite()" color="primary" variant="flat" prepend-icon="mdi-plus" @click="edit(null)">Record an incident</v-btn>
			</div>
			<div class="table-wrap">
				<v-table density="comfortable">
					<thead><tr><th>Incident</th><th>Severity</th><th>Status</th><th>Detected</th><th>Personal data</th></tr></thead>
					<tbody>
						<tr v-for="item in items" :key="item.id" class="row-click" @click="edit(item)">
							<td><div class="font-weight-medium">{{ item.title }}</div><div class="text-caption text-medium-emphasis">{{ item.createdBy ?? "" }}</div></td>
							<td><v-chip size="x-small" variant="tonal" :color="severityColor[item.severity]">{{ item.severity }}</v-chip></td>
							<td><v-chip size="x-small" variant="tonal" :color="item.status === 'open' ? 'error' : item.status === 'contained' ? 'warning' : 'success'">{{ item.status }}</v-chip></td>
							<td class="text-no-wrap">{{ dateTime(item.detectedAt) }}</td>
							<td>
								<template v-if="item.personalData">
									<v-chip v-if="item.authorityNotifiedAt" size="x-small" color="success" variant="tonal">authority told {{ dateOnly(item.authorityNotifiedAt) }}</v-chip>
									<v-chip v-else size="x-small" :color="hoursSince(item.detectedAt) > 72 ? 'error' : 'warning'" variant="tonal">{{ hoursSince(item.detectedAt) > 72 ? "72 h passed" : `${Math.max(0, 72 - hoursSince(item.detectedAt))} h left` }}</v-chip>
								</template>
								<template v-else>—</template>
							</td>
						</tr>
						<tr v-if="!items.length"><td colspan="5" class="text-center text-medium-emphasis pa-6">No incident recorded.</td></tr>
					</tbody>
				</v-table>
			</div>
		</v-card>

		<v-dialog v-model="dialog" max-width="680" scrollable>
			<v-card>
				<v-card-title>{{ editing ? "Incident" : "Record an incident" }}</v-card-title>
				<v-card-text>
					<v-text-field v-model="form.title" label="What happened (short)" maxlength="200" class="mb-3" :disabled="!canWrite()"/>
					<div class="d-flex ga-3 mb-3">
						<v-select v-model="form.severity" :items="['low', 'medium', 'high', 'critical']" label="Severity" :disabled="!canWrite()"/>
						<v-select v-model="form.status" :items="['open', 'contained', 'resolved', 'closed']" label="Status" :disabled="!canWrite()"/>
					</div>
					<div class="d-flex ga-3 mb-3">
						<v-text-field v-model="form.detectedAt" type="datetime-local" label="Detected" :disabled="!canWrite()"/>
						<v-text-field v-model="form.resolvedAt" type="datetime-local" label="Resolved" :disabled="!canWrite()"/>
					</div>
					<v-textarea v-model="form.description" label="Description: what, when, how it was found, what was affected" rows="3" auto-grow maxlength="8000" class="mb-3" :disabled="!canWrite()"/>
					<v-textarea v-model="form.actions" label="What was done" rows="3" auto-grow maxlength="8000" class="mb-3" :disabled="!canWrite()"/>
					<v-textarea v-model="form.lessons" label="Lessons learned and what changes" rows="2" auto-grow maxlength="8000" class="mb-3" :disabled="!canWrite()"/>
					<v-checkbox v-model="form.personalData" label="Personal data was affected" hide-details :disabled="!canWrite()"/>
					<div v-if="form.personalData" class="d-flex ga-3 mt-3">
						<v-text-field v-model="form.authorityNotifiedAt" type="datetime-local" label="Authority notified" :disabled="!canWrite()"/>
						<v-text-field v-model="form.usersNotifiedAt" type="datetime-local" label="Affected people notified" :disabled="!canWrite()"/>
					</div>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="dialog = false">Cancel</v-btn><v-btn v-if="canWrite()" color="primary" variant="flat" :loading="saving" :disabled="!form.title.trim()" @click="save">Save</v-btn></v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import {onMounted, reactive, ref} from "vue";
import type {IIncident, IncidentSeverity, IncidentStatus} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateOnly, dateTime} from "@/utils/format";

const emit = defineEmits<{changed: []}>();

const severityColor = {low: undefined, medium: "info", high: "warning", critical: "error"} as const;
const items = ref<IIncident[]>([]);
const dialog = ref(false);
const editing = ref<IIncident | null>(null);
const saving = ref(false);
const form = reactive({
	title: "", severity: "medium" as IncidentSeverity, status: "open" as IncidentStatus, detectedAt: "", resolvedAt: "",
	description: "", actions: "", lessons: "", personalData: false, authorityNotifiedAt: "", usersNotifiedAt: "",
});

const hoursSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
/** `datetime-local` wants local time without a zone. */
const toLocal = (iso: string | null) => {
	if (!iso) return "";
	const d = new Date(iso);
	return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

function edit(item: IIncident | null) {
	editing.value = item;
	form.title = item?.title ?? "";
	form.severity = item?.severity ?? "medium";
	form.status = item?.status ?? "open";
	form.detectedAt = toLocal(item?.detectedAt ?? new Date().toISOString());
	form.resolvedAt = toLocal(item?.resolvedAt ?? null);
	form.description = item?.description ?? "";
	form.actions = item?.actions ?? "";
	form.lessons = item?.lessons ?? "";
	form.personalData = item?.personalData ?? false;
	form.authorityNotifiedAt = toLocal(item?.authorityNotifiedAt ?? null);
	form.usersNotifiedAt = toLocal(item?.usersNotifiedAt ?? null);
	dialog.value = true;
}

async function save() {
	saving.value = true;
	try {
		const input = {
			title: form.title.trim(), severity: form.severity, status: form.status, detectedAt: toIso(form.detectedAt) ?? new Date().toISOString(),
			resolvedAt: toIso(form.resolvedAt), description: form.description.trim() || null, actions: form.actions.trim() || null,
			lessons: form.lessons.trim() || null, personalData: form.personalData,
			authorityNotifiedAt: form.personalData ? toIso(form.authorityNotifiedAt) : null, usersNotifiedAt: form.personalData ? toIso(form.usersNotifiedAt) : null,
		};
		if (editing.value) await api.compliance.updateIncident(editing.value.id, input);
		else await api.compliance.createIncident(input);
		notify("Saved.");
		dialog.value = false;
		await load();
		emit("changed");
	} finally {
		saving.value = false;
	}
}

async function load() {
	items.value = await api.compliance.incidents();
}

onMounted(load);
</script>
