<template>
	<div class="page">
		<page-header title="Data retention" subtitle="How long each kind of record is kept. Personal data should not be kept longer than needed (GDPR art. 5(1)(e)): you decide how long that is.">
			<v-btn v-if="canWrite()" variant="tonal" prepend-icon="mdi-broom" :disabled="dirty || totalOverdue === 0" :loading="purging" @click="confirmPurge = true">Purge now<template v-if="totalOverdue"> ({{ num(totalOverdue) }})</template></v-btn>
			<v-btn v-if="canWrite()" color="primary" variant="flat" prepend-icon="mdi-content-save-outline" :disabled="!dirty || !valid" :loading="saving" @click="save">Save</v-btn>
		</page-header>

		<v-alert type="info" variant="tonal" class="mb-4" icon="mdi-information-outline">
			Records older than their period are deleted by the hourly job <router-link to="/jobs">Purge old records</router-link>. <strong>0 keeps a record forever.</strong>
			Shortening a period deletes the older records at the next run, and they cannot be brought back.
		</v-alert>

		<v-card>
			<div class="table-wrap">
				<v-table density="comfortable">
					<thead><tr><th>Records</th><th>Personal data</th><th style="width: 190px">Kept for</th><th>Default</th><th class="text-right">Stored</th><th>Oldest</th><th class="text-right">Past the period</th></tr></thead>
					<tbody>
						<tr v-for="item in items" :key="item.id">
							<td class="text-no-wrap font-weight-medium">
								{{ item.label }}
								<v-icon size="16" class="ml-1 text-medium-emphasis" aria-label="What it holds">mdi-information-outline<v-tooltip activator="parent" location="top" max-width="340">{{ item.description }}</v-tooltip></v-icon>
							</td>
							<td class="text-no-wrap"><v-icon v-if="item.personal" size="18" color="warning" aria-label="Holds personal data">mdi-account-alert-outline<v-tooltip activator="parent" location="top">Addresses, emails or who did what</v-tooltip></v-icon><span v-else class="text-medium-emphasis">no</span></td>
							<td>
								<v-text-field v-model="draft[item.key]" type="number" min="0" suffix="days" density="compact" hide-details :disabled="!canWrite()" :error="!isValid(item)" :aria-label="`${item.label}: days kept`"/>
								<div v-if="draft[item.key] === '0' || draft[item.key] === ''" class="text-caption text-warning mt-1">Kept forever</div>
								<div v-else-if="!isValid(item)" class="text-caption text-error mt-1">{{ item.minDays > 1 ? `0 or at least ${item.minDays}` : "0 or more" }}</div>
							</td>
							<td class="text-no-wrap text-medium-emphasis">{{ item.defaultDays === 0 ? "forever" : `${item.defaultDays} days` }}</td>
							<td class="text-right text-no-wrap">{{ num(item.rows) }}</td>
							<td class="text-no-wrap">{{ item.oldest ? dateOnly(item.oldest) : "—" }}</td>
							<td class="text-right text-no-wrap"><v-chip v-if="item.overdue > 0" size="x-small" variant="tonal" color="warning">{{ num(item.overdue) }}</v-chip><span v-else class="text-medium-emphasis">0</span></td>
						</tr>
					</tbody>
				</v-table>
			</div>
		</v-card>
		<p class="text-caption text-medium-emphasis mt-3">
			The audit trail can't be edited: the database only lets it shrink after 90 days, and only through this setting. Shorter periods are refused. Accounts themselves are not covered here: they are removed by the inactive-account setting
			(<router-link to="/settings">Settings</router-link>) or on request (<router-link to="/data-requests">Data requests</router-link>).
		</p>

		<confirm-danger-dialog v-model="confirmPurge" title="Purge old records now?" action-label="Purge" :action="purge">
			This deletes {{ num(totalOverdue) }} records older than their period, right away instead of at the next hourly run. They cannot be brought back.
		</confirm-danger-dialog>
	</div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref} from "vue";
import type {IRetentionItem} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateOnly, num} from "@/utils/format";
import ConfirmDangerDialog from "@/components/ConfirmDangerDialog.vue";
import PageHeader from "@/components/PageHeader.vue";

const items = ref<IRetentionItem[]>([]);
const draft = reactive<Record<string, string>>({});
const saving = ref(false);
const purging = ref(false);
const confirmPurge = ref(false);

const isValid = (item: IRetentionItem): boolean => {
	const raw = draft[item.key];
	if (raw === undefined || raw === "") return true;
	const days = Number(raw);
	return Number.isInteger(days) && days >= 0 && (days === 0 || days >= item.minDays);
};
const valid = computed(() => items.value.every(isValid));
const dirty = computed(() => items.value.some((item) => (draft[item.key] === "" ? 0 : Number(draft[item.key])) !== item.days));
const totalOverdue = computed(() => items.value.reduce((sum, item) => sum + item.overdue, 0));

async function load() {
	const result = await api.retention.list();
	items.value = result.items;
	for (const item of result.items) draft[item.key] = String(item.days);
}

async function save() {
	saving.value = true;
	try {
		const changes: Record<string, string | null> = {};
		for (const item of items.value) {
			const days = draft[item.key] === "" ? 0 : Number(draft[item.key]);
			if (days !== item.days) changes[item.key] = String(days);
		}
		await api.settings.update(changes);
		notify("Saved. The next purge uses the new periods.");
		await load();
	} finally {
		saving.value = false;
	}
}

async function purge() {
	purging.value = true;
	try {
		const run = await api.jobs.run("retention");
		notify(run.status === "ok" ? (run.message ?? "Done") : `The purge failed: ${run.message}`, run.status === "ok" ? "success" : "error");
		await load();
	} finally {
		purging.value = false;
	}
}

onMounted(load);
</script>
