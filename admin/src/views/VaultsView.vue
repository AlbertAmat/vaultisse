<template>
	<div class="page">
		<page-header title="Vaults" subtitle="Libraries and who shares them. You see names, sizes and members, never the books or borrowers inside."/>

		<v-card>
			<div class="d-flex flex-wrap ga-3 pa-4">
				<v-text-field v-model="search" prepend-inner-icon="mdi-magnify" placeholder="Search by vault name" clearable style="max-width: 360px" @update:model-value="debounced"/>
				<v-select v-model="status" :items="statuses" clearable placeholder="Any state" style="max-width: 220px" @update:model-value="reload"/>
				<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="load"/>
			</div>
			<v-divider/>
			<div class="table-wrap">
				<v-table hover>
					<thead>
						<tr><th>Vault</th><th>Admins</th><th>Members</th><th>Books</th><th>Storage</th><th>Plan</th><th>State</th></tr>
					</thead>
					<tbody>
						<tr v-for="vault in items" :key="vault.id" class="row-click" @click="open(vault.id)">
							<td><div class="font-weight-medium">{{ vault.name }}</div><div class="text-caption text-medium-emphasis">Created {{ dateOnly(vault.createdDate) }}</div></td>
							<td class="text-body-2">{{ vault.admins.join(", ") || "—" }}</td>
							<td>{{ vault.memberCount }}</td>
							<td>{{ num(vault.bookCount) }}</td>
							<td>{{ bytes(vault.storageBytes) }}</td>
							<td>{{ vault.planName ?? "default" }}</td>
							<td>
								<v-chip v-if="vault.suspendedReason === 'pending_deletion'" size="x-small" color="warning" variant="tonal">Deletion scheduled</v-chip>
								<v-chip v-else-if="vault.suspendedAt" size="x-small" color="error" variant="tonal">Suspended</v-chip>
								<v-chip v-else size="x-small" color="success" variant="tonal">Active</v-chip>
							</td>
						</tr>
						<tr v-if="!items.length && !loading"><td colspan="7" class="text-center text-medium-emphasis pa-8">No vaults match.</td></tr>
					</tbody>
				</v-table>
			</div>
			<pager :page="page" :page-size="pageSize" :total="total" @update:page="page = $event; load()"/>
		</v-card>

		<v-dialog v-model="dialog" max-width="640" scrollable>
			<v-card v-if="detail">
				<v-card-title class="d-flex align-center">
					{{ detail.vault.name }}
					<v-spacer/>
					<v-btn icon="mdi-close" variant="text" aria-label="Close" @click="dialog = false"/>
				</v-card-title>
				<v-card-text>
					<v-alert v-if="detail.vault.deletionScheduledFor" type="warning" variant="tonal" density="compact" class="mb-4" icon="mdi-delete-clock-outline">
						Will be deleted {{ relative(detail.vault.deletionScheduledFor) }}.
						<template #append><v-btn size="small" variant="text" to="/deletions">Deletions</v-btn></template>
					</v-alert>
					<v-alert v-else-if="detail.vault.suspendedAt" type="error" variant="tonal" density="compact" class="mb-4">
						Suspended {{ relative(detail.vault.suspendedAt) }}: its members can't open it.
					</v-alert>

					<div class="text-subtitle-2 mb-2">Usage</div>
					<div v-for="row in usageRows" :key="row.label" class="mb-3">
						<div class="d-flex justify-space-between text-body-2">
							<span>{{ row.label }}</span>
							<span>{{ row.text }}</span>
						</div>
						<v-progress-linear v-if="row.percent !== null" :model-value="row.percent" :color="row.percent >= 90 ? 'error' : row.percent >= 70 ? 'warning' : 'primary'" height="6" rounded/>
					</div>

					<div class="text-subtitle-2 mt-5 mb-2">Plan</div>
					<div class="d-flex ga-2 align-start">
						<v-select v-model="planId" :items="planItems" :disabled="!canWrite()" style="max-width: 320px"/>
						<v-btn v-if="canWrite()" variant="tonal" class="mt-1" :disabled="planId === (detail.vault.planId ?? null)" @click="savePlan">Save plan</v-btn>
					</div>

					<div class="text-subtitle-2 mt-5 mb-2">Members ({{ detail.members.length }})</div>
					<v-list density="compact" bg-color="transparent" class="pa-0">
						<v-list-item v-for="member in detail.members" :key="member.userId" :title="member.name" :subtitle="`${member.code} · ${member.role}${member.status === 0 ? ' · pending' : member.status === 2 ? ' · rejected' : ''}`" :to="`/users?search=${encodeURIComponent(member.code)}`"/>
					</v-list>

					<template v-if="canWrite()">
						<v-divider class="my-5"/>
						<div class="d-flex flex-wrap ga-2">
							<v-btn v-if="detail.vault.suspendedReason !== 'pending_deletion' && !detail.vault.suspendedAt" variant="tonal" prepend-icon="mdi-pause-circle-outline" @click="act(() => api.vaults.suspend(detail!.vault.id), 'Vault suspended.')">Suspend</v-btn>
							<v-btn v-else-if="detail.vault.suspendedReason !== 'pending_deletion'" variant="tonal" prepend-icon="mdi-play-circle-outline" @click="act(() => api.vaults.unsuspend(detail!.vault.id), 'Vault restored.')">Restore</v-btn>
							<v-btn v-if="detail.vault.suspendedReason !== 'pending_deletion'" color="error" variant="tonal" prepend-icon="mdi-delete-outline" @click="removing = true">Delete vault…</v-btn>
						</div>
					</template>
				</v-card-text>
			</v-card>
		</v-dialog>

		<confirm-danger-dialog
			v-if="detail"
			v-model="removing"
			title="Delete this vault?"
			action-label="Delete vault"
			:confirm-text="detail.vault.name"
			allow-immediate
			:action="remove"
		>
			The vault is suspended straight away and deleted after the grace period, with every book, location, customer and loan in it.
			Its members keep their accounts. Until then you can cancel it under Deletions.
		</confirm-danger-dialog>
	</div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import {useRoute} from "vue-router";
import type {IAdminVault, IPlan, IVaultDetail} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {bytes, dateOnly, num, relative} from "@/utils/format";
import ConfirmDangerDialog from "@/components/ConfirmDangerDialog.vue";
import PageHeader from "@/components/PageHeader.vue";
import Pager from "@/components/Pager.vue";

const route = useRoute();
const items = ref<IAdminVault[]>([]);
const plans = ref<IPlan[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 25;
const loading = ref(false);
const search = ref(typeof route.query.search === "string" ? route.query.search : "");
const status = ref<string | null>(null);
const dialog = ref(false);
const detail = ref<IVaultDetail | null>(null);
const planId = ref<number | null>(null);
const removing = ref(false);

const statuses = [
	{title: "Active", value: "active"},
	{title: "Suspended", value: "suspended"},
	{title: "Deletion scheduled", value: "pending_deletion"},
];

const planItems = computed(() => [
	{title: "Default plan", value: null as number | null},
	...plans.value.map((plan) => ({title: plan.name, value: plan.id as number | null})),
]);

const usageRows = computed(() => {
	if (!detail.value) {
		return [];
	}
	const {usage, plan} = detail.value;
	const row = (label: string, value: number, limit: number | null, format: (n: number) => string) => ({
		label,
		text: limit === null ? `${format(value)} · unlimited` : `${format(value)} of ${format(limit)}`,
		percent: limit === null || limit === 0 ? null : Math.min(100, Math.round((value * 100) / limit)),
	});
	return [
		row("Books", usage.books, plan?.maxBooks ?? null, num),
		row("Members", usage.members, plan?.maxMembers ?? null, num),
		row("Storage", usage.storageBytes, plan?.maxStorageMb != null ? plan.maxStorageMb * 1024 * 1024 : null, bytes),
	];
});

let timer: ReturnType<typeof setTimeout> | undefined;
const debounced = () => {
	clearTimeout(timer);
	timer = setTimeout(reload, 300);
};

async function load() {
	loading.value = true;
	try {
		const result = await api.vaults.list({search: search.value ?? "", status: status.value ?? undefined, page: page.value, pageSize});
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

async function open(id: number) {
	detail.value = await api.vaults.get(id);
	planId.value = detail.value.vault.planId;
	dialog.value = true;
}

async function act(work: () => Promise<unknown>, message: string) {
	const id = detail.value!.vault.id;
	await work();
	notify(message);
	detail.value = await api.vaults.get(id);
	await load();
}

const savePlan = () => act(() => api.vaults.setPlan(detail.value!.vault.id, planId.value), "Plan changed.");

async function remove(immediate: boolean) {
	const vault = detail.value!.vault;
	const result = await api.vaults.remove(vault.id, vault.name, immediate);
	notify(result.executed ? "Vault deleted." : `Vault suspended. It will be deleted ${relative(result.executeAfter)}.`);
	dialog.value = false;
	await load();
}

onMounted(async () => {
	await Promise.all([load(), api.plans.list().then((list) => (plans.value = list))]);
});
</script>
