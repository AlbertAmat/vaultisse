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
							<v-btn v-if="detail.vault.suspendedReason !== 'pending_deletion'" variant="tonal" prepend-icon="mdi-account-switch-outline" @click="openTransfer">Transfer ownership…</v-btn>
							<v-btn v-if="detail.vault.suspendedReason !== 'pending_deletion'" color="warning" variant="tonal" prepend-icon="mdi-broom" @click="openClear">Clear content…</v-btn>
							<v-btn v-if="detail.vault.suspendedReason !== 'pending_deletion'" color="error" variant="tonal" prepend-icon="mdi-delete-outline" @click="removing = true">Delete vault…</v-btn>
						</div>
					</template>
				</v-card-text>
			</v-card>
		</v-dialog>

		<!-- Transfer ownership -->
		<v-dialog v-model="transferOpen" max-width="520">
			<v-card v-if="detail" class="pa-2">
				<v-card-title>Transfer ownership of {{ detail.vault.name }}</v-card-title>
				<v-card-text>
					<p class="text-body-2 mb-3">For when the owner leaves: another member becomes admin of the vault. Only members who accepted can take over; add anyone else as a member first.</p>
					<v-select v-model="transferTo" :items="eligible" item-title="label" item-value="userId" label="New admin" class="mb-3" :no-data-text="'No other member has accepted the membership.'"/>
					<div class="text-subtitle-2 mb-1">The current admins ({{ currentAdmins }})</div>
					<v-radio-group v-model="previous" density="compact" hide-details>
						<v-radio value="keep" label="Stay admins"/>
						<v-radio value="demote" label="Become normal members"/>
						<v-radio value="remove" label="Leave the vault (their access ends)"/>
					</v-radio-group>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="transferOpen = false">Cancel</v-btn><v-btn color="primary" variant="flat" :loading="transferring" :disabled="!transferTo" @click="transfer">Transfer</v-btn></v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Clear content -->
		<v-dialog v-model="clearOpen" max-width="600" scrollable>
			<v-card v-if="detail" class="pa-2">
				<v-card-title class="d-flex align-center ga-2"><v-icon color="warning">mdi-broom</v-icon>Clear content of {{ detail.vault.name }}</v-card-title>
				<v-card-text>
					<p class="text-body-2 mb-2">Empties the parts you choose and keeps the vault, its members, its plan and its settings. You see how many items there are, never which. <strong>Deleted items cannot be brought back</strong>: tell the owner first.</p>
					<div v-if="counts" class="d-flex align-center mb-1">
						<div class="text-subtitle-2">Delete…</div><v-spacer/>
						<v-btn size="x-small" variant="text" @click="selectAll">{{ picked.size === clearable.length ? "None" : "Everything" }}</v-btn>
					</div>
					<div v-for="c in clearable" :key="c.scope" class="d-flex align-start">
						<v-checkbox :model-value="picked.has(c.scope) || forced.has(c.scope)" :disabled="c.count === 0 || forced.has(c.scope)" density="compact" hide-details color="error" @update:model-value="toggleScope(c.scope)">
							<template #label><span>{{ c.label }} <span class="text-medium-emphasis">({{ num(c.count) }})</span></span></template>
						</v-checkbox>
						<v-icon v-if="c.hint" size="16" class="mt-3 ml-1 text-medium-emphasis" :aria-label="c.hint">mdi-information-outline<v-tooltip activator="parent" location="end" max-width="320">{{ c.hint }}</v-tooltip></v-icon>
					</div>
					<template v-if="picked.size > 0">
						<v-divider class="my-3"/>
						<p class="text-body-2 mb-2">Type the vault name <strong class="mono">{{ detail.vault.name }}</strong> to confirm.</p>
						<v-text-field v-model="clearConfirm" autocomplete="off"/>
					</template>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="clearOpen = false">Cancel</v-btn><v-btn color="error" variant="flat" :loading="clearing" :disabled="picked.size === 0 || clearConfirm !== detail.vault.name" @click="clear">Delete the selected</v-btn></v-card-actions>
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
import type {ClearScope, IAdminVault, IClearCounts, IPlan, IVaultDetail} from "@vaultisse/types/admin/IAdmin";
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
const transferOpen = ref(false);
const transferTo = ref<number | null>(null);
const previous = ref<"keep" | "demote" | "remove">("demote");
const transferring = ref(false);
const clearOpen = ref(false);
const counts = ref<IClearCounts | null>(null);
const picked = ref(new Set<ClearScope>());
const clearConfirm = ref("");
const clearing = ref(false);

const eligible = computed(() => (detail.value?.members ?? []).filter((m) => m.status === 1 && m.role !== "admin").map((m) => ({userId: m.userId, label: `${m.name} (${m.code})`})));
const currentAdmins = computed(() => (detail.value?.members ?? []).filter((m) => m.role === "admin" && m.status === 1).map((m) => m.name).join(", ") || "none");

/** What can be cleared, in the order the customer thinks of it. */
const clearable = computed(() => {
	const c = counts.value;
	if (!c) return [];
	return [
		{scope: "books" as ClearScope, label: "Books", count: c.books, hint: `With their ${num(c.copies)} copies, ${num(c.files)} ebook files, reading status and the loan history.`},
		{scope: "customers" as ClearScope, label: "Borrowers", count: c.customers, hint: "Copies on loan to them go back on the shelf, and their loan history is removed."},
		{scope: "authors" as ClearScope, label: "Authors", count: c.authors, hint: ""},
		{scope: "categories" as ClearScope, label: "Categories", count: c.categories, hint: "Books stay, without a category."},
		{scope: "locations" as ClearScope, label: "Locations", count: c.locations, hint: "Copies stay, without a location."},
		{scope: "groups" as ClearScope, label: "Borrower groups", count: c.groups, hint: ""},
		{scope: "history" as ClearScope, label: "Loan history", count: c.history, hint: "Only the record of past loans."},
		{scope: "card" as ClearScope, label: "Library card design", count: c.card, hint: "The background image and text of the borrower cards."},
	];
});
/** Clearing books or borrowers also removes the loan history: a loan can't outlive its copy or borrower. */
const forced = computed(() => new Set<ClearScope>(picked.value.has("books") || picked.value.has("customers") ? ["history"] : []));

function openTransfer() {
	transferTo.value = eligible.value[0]?.userId ?? null;
	previous.value = "demote";
	transferOpen.value = true;
}

async function transfer() {
	transferring.value = true;
	try {
		const result = await api.vaults.transfer(detail.value!.vault.id, transferTo.value!, previous.value);
		transferOpen.value = false;
		notify(`${result.newAdmin} is now the admin of ${result.vault}.`);
		detail.value = await api.vaults.get(detail.value!.vault.id);
		await load();
	} finally {
		transferring.value = false;
	}
}

async function openClear() {
	counts.value = (await api.vaults.content(detail.value!.vault.id)).counts;
	picked.value = new Set();
	clearConfirm.value = "";
	clearOpen.value = true;
}

function toggleScope(scope: ClearScope) {
	const next = new Set(picked.value);
	if (next.has(scope)) next.delete(scope);
	else next.add(scope);
	picked.value = next;
}

function selectAll() {
	const everything = clearable.value.filter((c) => c.count > 0).map((c) => c.scope);
	picked.value = picked.value.size === everything.length ? new Set() : new Set(everything);
}

async function clear() {
	clearing.value = true;
	try {
		const result = await api.vaults.clear(detail.value!.vault.id, [...picked.value], clearConfirm.value);
		clearOpen.value = false;
		const total = Object.values(result.removed).reduce((sum, n) => sum + n, 0);
		notify(`${num(total)} items were deleted from ${detail.value!.vault.name}.`);
		detail.value = await api.vaults.get(detail.value!.vault.id);
		await load();
	} finally {
		clearing.value = false;
	}
}

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
