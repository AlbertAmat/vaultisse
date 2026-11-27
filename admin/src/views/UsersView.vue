<template>
	<div class="page">
		<page-header title="Accounts" subtitle="Everyone with an account on this installation."/>

		<v-card>
			<div class="d-flex flex-wrap ga-3 pa-4">
				<v-text-field v-model="search" prepend-inner-icon="mdi-magnify" placeholder="Search by name, username or email" clearable style="max-width: 360px" @update:model-value="debounced"/>
				<v-select v-model="status" :items="statuses" clearable placeholder="Any status" style="max-width: 220px" @update:model-value="reload"/>
				<v-select v-if="allTags.length" v-model="tag" :items="allTags.map((t) => ({title: `${t.tag} (${t.count})`, value: t.tag}))" clearable placeholder="Any tag" prepend-inner-icon="mdi-tag-outline" style="max-width: 220px" @update:model-value="reload"/>
				<v-select v-model="sort" :items="sorts" style="max-width: 200px" @update:model-value="reload"/>
				<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="load"/>
				<v-btn v-if="canWrite() && status === 'pending' && total > 0" color="success" variant="flat" prepend-icon="mdi-check-all" @click="approveAllOpen = true">Approve all {{ total }}</v-btn>
			</div>

			<!-- Selection bar -->
			<div v-if="selected.size > 0" class="selection d-flex flex-wrap align-center ga-2 px-4 py-2">
				<strong>{{ selected.size }} selected</strong>
				<v-spacer/>
				<template v-if="canWrite()">
					<v-btn size="small" variant="tonal" prepend-icon="mdi-check" @click="bulk('approve')">Approve</v-btn>
					<v-btn size="small" variant="tonal" prepend-icon="mdi-account-lock-outline" @click="bulk('disable')">Disable</v-btn>
					<v-btn size="small" variant="tonal" prepend-icon="mdi-account-check-outline" @click="bulk('enable')">Enable</v-btn>
					<v-btn size="small" variant="tonal" prepend-icon="mdi-logout-variant" @click="bulk('force-logout')">Sign out</v-btn>
					<v-btn size="small" variant="tonal" color="error" prepend-icon="mdi-delete-outline" @click="bulkDeleteOpen = true">Delete…</v-btn>
				</template>
				<v-btn size="small" variant="text" @click="selected = new Set()">Clear</v-btn>
			</div>
			<v-divider/>
			<div class="table-wrap">
				<v-table hover>
					<thead>
						<tr>
							<th style="width: 44px"><v-checkbox-btn :model-value="allSelected" :indeterminate="selected.size > 0 && !allSelected" aria-label="Select all on this page" @update:model-value="toggleAll"/></th>
							<th>Account</th><th>Status</th><th>Vaults</th><th>Last sign-in</th><th>Created</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="user in items" :key="user.id" class="row-click" :class="{picked: selected.has(user.id)}" @click="open(user.id)">
							<td @click.stop><v-checkbox-btn :model-value="selected.has(user.id)" :aria-label="`Select ${user.name}`" @update:model-value="toggle(user.id)"/></td>
							<td>
								<div class="font-weight-medium">{{ user.name }}<v-icon v-if="user.noteCount" size="14" class="ml-1 text-medium-emphasis" title="Has private notes">mdi-note-text-outline</v-icon></div>
								<div class="text-caption text-medium-emphasis">{{ user.code }} · {{ user.email }}</div>
								<div v-if="user.tags.length" class="mt-1"><v-chip v-for="t in user.tags" :key="t" size="x-small" variant="tonal" color="primary" class="mr-1" @click.stop="tag = t; reload()">{{ t }}</v-chip></div>
							</td>
							<td><status-chips :user="user"/></td>
							<td>{{ user.vaultCount }}</td>
							<td>{{ relative(user.lastLoginDate) }}</td>
							<td>{{ dateOnly(user.createdDate) }}</td>
						</tr>
						<tr v-if="!items.length && !loading"><td colspan="6" class="text-center text-medium-emphasis pa-8">No accounts match.</td></tr>
					</tbody>
				</v-table>
			</div>
			<pager :page="page" :page-size="pageSize" :total="total" @update:page="page = $event; load()"/>
		</v-card>

		<!-- Detail -->
		<v-navigation-drawer v-model="drawer" location="right" temporary width="440">
			<div v-if="detail" class="pa-5">
				<div class="d-flex align-start">
					<div>
						<div class="text-h6 font-weight-bold">{{ detail.user.name }}</div>
						<div class="text-body-2 text-medium-emphasis">{{ detail.user.code }} · {{ detail.user.email }}</div>
					</div>
					<v-spacer/>
					<v-btn icon="mdi-close" variant="text" aria-label="Close" @click="drawer = false"/>
				</div>
				<status-chips :user="detail.user" class="mt-2"/>

				<v-alert v-if="detail.user.deletionScheduledFor" type="warning" variant="tonal" density="compact" class="mt-4" icon="mdi-delete-clock-outline">
					Will be deleted {{ relative(detail.user.deletionScheduledFor) }} ({{ dateTime(detail.user.deletionScheduledFor) }}).
					<template #append><v-btn size="small" variant="text" to="/deletions">Deletions</v-btn></template>
				</v-alert>

				<dl class="facts mt-4">
					<dt>Created</dt><dd>{{ dateTime(detail.user.createdDate) }}</dd>
					<dt>Last sign-in</dt><dd>{{ dateTime(detail.user.lastLoginDate) }}</dd>
					<dt>Last activity</dt><dd>{{ dateTime(detail.user.lastActivityDate) }}</dd>
					<dt>Live sessions</dt><dd>{{ detail.sessionCount }}</dd>
					<dt>Sign-in method</dt><dd>{{ detail.user.sso ? "Single sign-on" : "Password" }}</dd>
					<dt>Two-factor</dt><dd>{{ detail.user.totpEnabled ? "On" : "Off" }}</dd>
					<dt>Email</dt><dd>{{ detail.user.emailVerified ? "Verified" : "Not verified" }}</dd>
				</dl>

				<div v-if="canWrite()" class="d-flex flex-wrap ga-2 mt-5">
					<v-btn v-if="detail.user.disabledReason === 'pending_approval'" color="success" variant="flat" prepend-icon="mdi-check" @click="act(() => api.users.approve(detail!.user.id), 'Approved.')">Approve</v-btn>
					<v-btn v-else-if="!detail.user.disabled" variant="tonal" prepend-icon="mdi-account-lock-outline" @click="act(() => api.users.disable(detail!.user.id), 'Account disabled.')">Disable</v-btn>
					<v-btn v-else-if="detail.user.disabledReason !== 'pending_deletion'" variant="tonal" prepend-icon="mdi-account-check-outline" @click="act(() => api.users.enable(detail!.user.id), 'Account enabled.')">Enable</v-btn>
					<v-btn variant="tonal" prepend-icon="mdi-logout-variant" @click="act(() => api.users.forceLogout(detail!.user.id), 'Every session was ended.')">Sign out everywhere</v-btn>
					<v-btn v-if="detail.user.totpEnabled" variant="tonal" prepend-icon="mdi-shield-off-outline" @click="act(() => api.users.resetTwoFactor(detail!.user.id), 'Two-factor removed.')">Reset two-factor</v-btn>
				</div>

				<div class="text-subtitle-2 mt-6 mb-2">Tags <span class="text-caption text-medium-emphasis">only admins see these</span></div>
				<v-combobox v-if="canWrite()" v-model="editTags" :items="allTags.map((t) => t.tag)" multiple chips closable-chips density="compact" placeholder="vip, abuse warning, pending refund…" hide-details @update:model-value="saveTags"/>
				<div v-else-if="detail.user.tags.length"><v-chip v-for="t in detail.user.tags" :key="t" size="small" variant="tonal" class="mr-1">{{ t }}</v-chip></div>
				<p v-else class="text-body-2 text-medium-emphasis">No tags.</p>

				<div class="text-subtitle-2 mt-6 mb-2">Notes <span class="text-caption text-medium-emphasis">private, never shown to the user</span></div>
				<div v-if="canWrite()" class="d-flex ga-2 align-start">
					<v-textarea v-model="newNote" rows="2" auto-grow maxlength="2000" placeholder="What should the next admin know?" hide-details/>
					<v-btn color="primary" variant="flat" :disabled="!newNote.trim()" :loading="savingNote" @click="addNote">Add</v-btn>
				</div>
				<div v-for="n in detail.notes" :key="n.id" class="note mt-3">
					<div class="text-body-2" style="white-space: pre-wrap">{{ n.body }}</div>
					<div class="text-caption text-medium-emphasis d-flex align-center">{{ n.createdBy ?? "an admin who was since removed" }} · {{ relative(n.createdDate) }}<v-spacer/>
						<v-btn v-if="canWrite()" size="x-small" variant="text" icon="mdi-close" aria-label="Remove note" @click="removeNote(n.id)"/></div>
				</div>
				<p v-if="!detail.notes.length" class="text-body-2 text-medium-emphasis mt-2">No notes.</p>

				<div class="text-subtitle-2 mt-6 mb-2">Personal data (GDPR)</div>
				<div class="d-flex flex-wrap ga-2">
					<v-btn variant="tonal" prepend-icon="mdi-folder-zip-outline" :loading="exporting" @click="exportData">Download their data</v-btn>
					<v-btn v-if="canWrite()" variant="tonal" prepend-icon="mdi-clipboard-text-clock-outline" :to="`/data-requests?new=1&user=${detail.user.id}`">Log a request…</v-btn>
				</div>

				<div class="text-subtitle-2 mt-6 mb-2">Vaults</div>
				<v-list v-if="detail.memberships.length" density="compact" class="pa-0" bg-color="transparent">
					<v-list-item v-for="m in detail.memberships" :key="m.vaultId" :title="m.vaultName" :subtitle="`${m.role}${m.status === 0 ? ' · pending' : m.status === 2 ? ' · rejected' : ''}`" :to="`/vaults?search=${encodeURIComponent(m.vaultName)}`">
						<template #append><v-chip v-if="m.suspended" size="x-small" color="warning" variant="tonal">suspended</v-chip></template>
					</v-list-item>
				</v-list>
				<p v-else class="text-body-2 text-medium-emphasis">Not a member of any vault.</p>

				<div class="text-subtitle-2 mt-6 mb-2">Recent sign-in activity</div>
				<div v-for="entry in detail.recentActivity" :key="entry.id" class="d-flex justify-space-between text-body-2 py-1">
					<span>{{ entry.action.replace('_', ' ') }}<span v-if="entry.metadata.ip" class="text-medium-emphasis"> · {{ entry.metadata.ip }}</span></span>
					<span class="text-medium-emphasis">{{ relative(entry.createdDate) }}</span>
				</div>
				<p v-if="!detail.recentActivity.length" class="text-body-2 text-medium-emphasis">Nothing recorded.</p>

				<template v-if="canWrite() && detail.user.disabledReason !== 'pending_deletion'">
					<v-divider class="my-6"/>
					<div class="text-subtitle-2 text-error mb-2">Danger zone</div>
					<v-btn color="error" variant="tonal" prepend-icon="mdi-delete-outline" @click="removing = true">Delete account…</v-btn>
				</template>
			</div>
		</v-navigation-drawer>

		<!-- Bulk: approve everyone waiting -->
		<v-dialog v-model="approveAllOpen" max-width="440">
			<v-card class="pa-2">
				<v-card-title>Approve all {{ total }} waiting accounts?</v-card-title>
				<v-card-text class="text-body-2">They can sign in right away{{ " " }}and, if email is set up, each gets a message saying so.</v-card-text>
				<v-card-actions>
					<v-spacer/>
					<v-btn variant="text" @click="approveAllOpen = false">Cancel</v-btn>
					<v-btn color="success" variant="flat" :loading="working" @click="approveAll">Approve all</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Bulk: delete -->
		<confirm-danger-dialog v-model="bulkDeleteOpen" :title="`Delete ${selected.size} accounts?`" action-label="Delete accounts" confirm-text="DELETE" :action="bulkDelete">
			The {{ selected.size }} selected accounts are locked out now and deleted after the grace period, together with every library only they belong to. Until then each can be cancelled under Deletions.
		</confirm-danger-dialog>

		<!-- Bulk: what happened -->
		<v-dialog v-model="resultOpen" max-width="520" scrollable>
			<v-card v-if="result" class="pa-2">
				<v-card-title class="d-flex align-center ga-2">
					<v-icon :color="result.failed ? 'warning' : 'success'">{{ result.failed ? "mdi-alert-outline" : "mdi-check-circle-outline" }}</v-icon>
					{{ result.ok }} done{{ result.failed ? `, ${result.failed} not done` : "" }}
				</v-card-title>
				<v-card-text v-if="result.failed">
					<p class="text-body-2 text-medium-emphasis mb-2">These were skipped; everything else went through.</p>
					<v-list density="compact" bg-color="transparent" class="pa-0">
						<v-list-item v-for="r in result.results.filter((x) => !x.ok)" :key="r.id" :title="r.code ?? `#${r.id}`" :subtitle="r.message"/>
					</v-list>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="flat" color="primary" @click="resultOpen = false">Close</v-btn></v-card-actions>
			</v-card>
		</v-dialog>

		<confirm-danger-dialog
			v-if="detail"
			v-model="removing"
			title="Delete this account?"
			action-label="Delete account"
			:confirm-text="detail.user.code"
			allow-immediate
			:action="remove"
		>
			<strong>{{ detail.user.name }}</strong> is locked out straight away and the account is deleted after the grace period,
			together with every library that only they belong to. Until then you can cancel it under Deletions.
		</confirm-danger-dialog>
	</div>
</template>

<script setup lang="ts">
import {computed, defineComponent, h, onMounted, ref} from "vue";
import {useRoute} from "vue-router";
import {VChip} from "vuetify/components";
import type {BulkAccountAction, IAccount, IAccountDetail, IBulkResult, UserStatus} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateOnly, dateTime, relative} from "@/utils/format";
import ConfirmDangerDialog from "@/components/ConfirmDangerDialog.vue";
import PageHeader from "@/components/PageHeader.vue";
import Pager from "@/components/Pager.vue";

/** The state of an account as chips. */
const StatusChips = defineComponent({
	props: {user: {type: Object as () => IAccount, required: true}},
	setup(props) {
		return () => {
			const user = props.user;
			const chips: [string, string][] = [];
			if (user.disabledReason === "pending_approval") chips.push(["Awaiting approval", "info"]);
			else if (user.disabledReason === "pending_deletion") chips.push(["Deletion scheduled", "warning"]);
			else if (user.disabled) chips.push(["Disabled", "error"]);
			else if (!user.emailVerified) chips.push(["Unverified", "warning"]);
			else chips.push(["Active", "success"]);
			if (user.totpEnabled) chips.push(["2FA", "secondary"]);
			if (user.sso) chips.push(["SSO", "secondary"]);
			return h("div", {class: "d-flex flex-wrap ga-1"}, chips.map(([label, color]) => h(VChip, {size: "x-small", color, variant: "tonal"}, () => label)));
		};
	},
});

const route = useRoute();
const items = ref<IAccount[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 25;
const loading = ref(false);
const search = ref("");
const status = ref<UserStatus | null>((route.query.status as UserStatus) ?? null);
const sort = ref("created");
const drawer = ref(false);
const detail = ref<IAccountDetail | null>(null);
const removing = ref(false);
const selected = ref(new Set<number>());
const tag = ref<string | null>(null);
const allTags = ref<{tag: string; count: number}[]>([]);
const editTags = ref<string[]>([]);
const newNote = ref("");
const savingNote = ref(false);
const exporting = ref(false);
const approveAllOpen = ref(false);
const bulkDeleteOpen = ref(false);
const working = ref(false);
const resultOpen = ref(false);
const result = ref<IBulkResult | null>(null);

const allSelected = computed(() => items.value.length > 0 && items.value.every((user) => selected.value.has(user.id)));
function toggle(id: number) {
	const next = new Set(selected.value);
	next.has(id) ? next.delete(id) : next.add(id);
	selected.value = next;
}
function toggleAll(value: boolean | null) {
	selected.value = value ? new Set(items.value.map((user) => user.id)) : new Set();
}

/** Runs an action on the selection and shows what happened. */
async function bulk(action: BulkAccountAction) {
	working.value = true;
	try {
		await showResult(await api.users.bulk(action, {ids: [...selected.value]}));
	} finally {
		working.value = false;
	}
}

async function bulkDelete() {
	await showResult(await api.users.bulk("delete", {ids: [...selected.value]}, {confirm: "DELETE"}));
}

async function approveAll() {
	working.value = true;
	try {
		approveAllOpen.value = false;
		await showResult(await api.users.bulk("approve", {status: "pending"}));
	} finally {
		working.value = false;
	}
}

async function showResult(outcome: IBulkResult) {
	result.value = outcome;
	selected.value = new Set();
	if (outcome.failed > 0) {
		resultOpen.value = true;
	} else {
		notify(`Done: ${outcome.ok} ${outcome.ok === 1 ? "account" : "accounts"}.`);
	}
	await load();
}

const statuses = [
	{title: "Active", value: "active"},
	{title: "Awaiting approval", value: "pending"},
	{title: "Disabled", value: "disabled"},
	{title: "Deletion scheduled", value: "pending_deletion"},
	{title: "Email not verified", value: "unverified"},
];
const sorts = [
	{title: "Newest first", value: "created"},
	{title: "Last sign-in", value: "lastLogin"},
	{title: "Name", value: "name"},
];

let timer: ReturnType<typeof setTimeout> | undefined;
const debounced = () => {
	clearTimeout(timer);
	timer = setTimeout(reload, 300);
};

async function load() {
	loading.value = true;
	selected.value = new Set();
	try {
		const result = await api.users.list({search: search.value ?? "", status: status.value ?? undefined, tag: tag.value ?? undefined, sort: sort.value, page: page.value, pageSize});
		items.value = result.items;
		total.value = result.total;
		allTags.value = await api.users.tags();
	} finally {
		loading.value = false;
	}
}

async function saveTags(value: string[]) {
	const id = detail.value!.user.id;
	try {
		editTags.value = await api.users.setTags(id, value.map((t) => String(t)));
	} catch {
		editTags.value = detail.value!.user.tags;
		return;
	}
	detail.value = await api.users.get(id);
	await load();
}

async function addNote() {
	savingNote.value = true;
	try {
		detail.value!.notes = await api.users.addNote(detail.value!.user.id, newNote.value.trim());
		detail.value!.user.noteCount = detail.value!.notes.length;
		newNote.value = "";
		await load();
	} finally {
		savingNote.value = false;
	}
}

async function removeNote(noteId: number) {
	detail.value!.notes = await api.users.removeNote(detail.value!.user.id, noteId);
	await load();
}

/** A fresh verification buys a one-minute link; following it downloads the ZIP. */
async function exportData() {
	exporting.value = true;
	try {
		const url = await api.dataRequests.exportLink(detail.value!.user.id);
		const link = document.createElement("a");
		link.href = url;
		link.download = "";
		document.body.append(link);
		link.click();
		link.remove();
		notify("The download started.");
	} finally {
		exporting.value = false;
	}
}

function reload() {
	page.value = 1;
	return load();
}

async function open(id: number) {
	detail.value = await api.users.get(id);
	editTags.value = [...detail.value.user.tags];
	newNote.value = "";
	drawer.value = true;
}

/** Runs an action on the open account, then refreshes it and the list. */
async function act(work: () => Promise<unknown>, message: string) {
	const id = detail.value!.user.id;
	await work();
	notify(message);
	detail.value = await api.users.get(id);
	editTags.value = [...detail.value.user.tags];
	await load();
}

async function remove(immediate: boolean) {
	const user = detail.value!.user;
	const result = await api.users.remove(user.id, user.code, immediate);
	notify(result.executed ? "Account deleted." : `Account locked. It will be deleted ${relative(result.executeAfter)}.`);
	drawer.value = false;
	await load();
}

onMounted(load);
</script>

<style scoped>
.selection {
	background: rgba(var(--v-theme-primary), 0.1);
}

tr.picked {
	background: rgba(var(--v-theme-primary), 0.06);
}

.facts {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 6px 16px;
	font-size: 0.875rem;
}

.facts dt {
	opacity: 0.65;
}

.note {
	padding: 8px 12px;
	border: 1px solid var(--pb-border);
	border-radius: 10px;
	background: var(--pb-surface-alt);
}
</style>
