<template>
	<div class="page">
		<page-header title="Deletions" subtitle="Accounts and vaults waiting out their grace period, and who the automatic cleanup of inactive accounts will delete next.">
			<template v-if="tab === 'scheduled'">
				<v-switch v-model="showAll" label="Show history" hide-details density="compact" color="primary" @update:model-value="reload"/>
				<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="load"/>
			</template>
		</page-header>

		<v-tabs v-model="tab" color="primary" class="mb-4">
			<v-tab value="scheduled">Scheduled</v-tab>
			<v-tab value="inactive">Inactive accounts</v-tab>
		</v-tabs>

		<inactive-accounts-panel v-if="tab === 'inactive'"/>

		<v-card v-else>
			<div class="table-wrap">
				<v-table>
					<thead>
						<tr><th>What</th><th>Requested</th><th>Deleted</th><th>State</th><th></th></tr>
					</thead>
					<tbody>
						<tr v-for="d in items" :key="d.id">
							<td>
								<v-icon size="18" class="mr-1">{{ d.entityType === "user" ? "mdi-account-outline" : "mdi-bookshelf" }}</v-icon>
								<span class="font-weight-medium">{{ d.entityLabel }}</span>
								<div class="text-caption text-medium-emphasis">{{ d.entityType === "user" ? "Account" : "Vault" }} #{{ d.entityId }}</div>
							</td>
							<td>{{ dateTime(d.requestedAt) }}<div class="text-caption text-medium-emphasis">{{ d.requestedBy ?? "—" }}</div></td>
							<td>{{ d.executedAt ? dateTime(d.executedAt) : dateTime(d.executeAfter) }}<div v-if="!d.executedAt && !d.cancelledAt" class="text-caption text-medium-emphasis">{{ relative(d.executeAfter) }}</div></td>
							<td>
								<v-chip v-if="d.executedAt" size="x-small" color="error" variant="tonal">Deleted</v-chip>
								<v-chip v-else-if="d.cancelledAt" size="x-small" variant="tonal">Cancelled</v-chip>
								<v-chip v-else size="x-small" color="warning" variant="tonal">Waiting</v-chip>
								<div v-if="d.lastError" class="text-caption text-error mt-1" style="max-width: 320px">{{ d.lastError }}</div>
							</td>
							<td class="text-right text-no-wrap">
								<template v-if="canWrite() && !d.executedAt && !d.cancelledAt">
									<v-btn size="small" variant="tonal" @click="cancel(d.id)">Cancel deletion</v-btn>
									<v-btn size="small" variant="text" color="error" @click="executing = d">Delete now</v-btn>
								</template>
							</td>
						</tr>
						<tr v-if="!items.length && !loading"><td colspan="5" class="text-center text-medium-emphasis pa-8">Nothing is waiting to be deleted.</td></tr>
					</tbody>
				</v-table>
			</div>
			<pager :page="page" :page-size="pageSize" :total="total" @update:page="page = $event; load()"/>
		</v-card>

		<confirm-danger-dialog :model-value="!!executing" title="Delete it now?" action-label="Delete now" :action="executeNow" @update:model-value="executing = null">
			<template v-if="executing">
				<strong>{{ executing.entityLabel }}</strong> will be deleted immediately, without waiting for the rest of the grace period. This can't be undone.
			</template>
		</confirm-danger-dialog>
	</div>
</template>

<script setup lang="ts">
import {onMounted, ref} from "vue";
import type {IScheduledDeletion} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateTime, relative} from "@/utils/format";
import ConfirmDangerDialog from "@/components/ConfirmDangerDialog.vue";
import InactiveAccountsPanel from "@/components/InactiveAccountsPanel.vue";
import PageHeader from "@/components/PageHeader.vue";
import Pager from "@/components/Pager.vue";

const tab = ref<"scheduled" | "inactive">("scheduled");
const items = ref<IScheduledDeletion[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 25;
const loading = ref(false);
const showAll = ref(false);
const executing = ref<IScheduledDeletion | null>(null);

async function load() {
	loading.value = true;
	try {
		const result = await api.deletions.list({open: !showAll.value, page: page.value, pageSize});
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

async function cancel(id: number) {
	await api.deletions.cancel(id);
	notify("Deletion cancelled. It is back as it was.");
	await load();
}

async function executeNow() {
	await api.deletions.execute(executing.value!.id);
	notify("Deleted.");
	await load();
}

onMounted(load);
</script>
