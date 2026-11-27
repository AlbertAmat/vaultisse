<template>
	<div class="page">
		<page-header title="Data requests" subtitle="People can ask what is held about them (access) or ask for it to be erased. Each request has a one-month deadline (GDPR art. 12) and is answered step by step.">
			<v-btn v-if="canWrite()" color="primary" variant="flat" prepend-icon="mdi-plus" @click="openCreate()">Log a request</v-btn>
		</page-header>

		<v-alert v-if="counts && counts.overdue > 0" type="error" variant="tonal" class="mb-4" icon="mdi-clock-alert-outline">
			{{ counts.overdue }} {{ counts.overdue === 1 ? "request is" : "requests are" }} past the deadline. Answer them now, or record why an extension applies.
		</v-alert>

		<v-tabs v-model="tab" color="primary" class="mb-4" @update:model-value="load">
			<v-tab value="active">Open<v-chip v-if="counts?.open" size="x-small" class="ml-2" :color="counts.overdue ? 'error' : undefined" variant="tonal">{{ counts.open }}</v-chip></v-tab>
			<v-tab value="closed">Closed</v-tab>
		</v-tabs>

		<v-card>
			<div class="table-wrap">
				<v-table density="comfortable">
					<thead><tr><th>Request</th><th>Person</th><th>Received</th><th>Deadline</th><th>Status</th></tr></thead>
					<tbody>
						<tr v-for="r in shown" :key="r.id" class="row-click" @click="open(r)">
							<td><v-chip size="small" variant="tonal" :color="r.kind === 'erasure' ? 'error' : 'info'" :prepend-icon="r.kind === 'erasure' ? 'mdi-eraser' : 'mdi-folder-download-outline'">{{ r.kind === "erasure" ? "Erasure" : "Access" }}</v-chip></td>
							<td><div class="font-weight-medium">{{ r.subjectName ?? r.subjectEmail }}</div><div class="text-caption text-medium-emphasis">{{ r.subjectEmail }}<template v-if="r.userCode"> · {{ r.userCode }}</template><template v-else> · no account</template></div></td>
							<td class="text-no-wrap">{{ dateOnly(r.receivedAt) }}</td>
							<td class="text-no-wrap">
								{{ dateOnly(r.dueAt) }}
								<v-chip v-if="r.daysLeft !== null" size="x-small" variant="tonal" class="ml-1" :color="r.overdue ? 'error' : r.daysLeft <= 5 ? 'warning' : undefined">{{ r.overdue ? `${-r.daysLeft} d late` : `${r.daysLeft} d left` }}</v-chip>
								<v-chip v-if="r.extendedAt" size="x-small" variant="tonal" class="ml-1">extended</v-chip>
							</td>
							<td><v-chip size="x-small" variant="tonal" :color="statusColor[r.status]">{{ statusText[r.status] }}</v-chip></td>
						</tr>
						<tr v-if="!shown.length"><td colspan="5" class="text-center text-medium-emphasis pa-8">{{ tab === "active" ? "No open request." : "Nothing closed yet." }}</td></tr>
					</tbody>
				</v-table>
			</div>
		</v-card>
		<p class="text-caption text-medium-emphasis mt-3">
			A request stays on record after the account is erased: that record is your proof that it was answered. Under GDPR you may refuse a request that is manifestly unfounded or excessive, but you must say why.
		</p>

		<!-- Log a request -->
		<v-dialog v-model="creating" max-width="520">
			<v-card class="pa-2">
				<v-card-title>Log a data request</v-card-title>
				<v-card-text>
					<v-select v-model="form.kind" :items="[{title: 'Access: they want to see their data', value: 'access'}, {title: 'Erasure: they want it deleted', value: 'erasure'}]" label="What do they ask for?" class="mb-3"/>
					<v-autocomplete v-model="form.account" :items="found" item-title="label" item-value="id" return-object clearable no-filter label="Their account" placeholder="Search by name, username or email" :loading="searching" class="mb-3" @update:search="searchAccounts"/>
					<v-text-field v-if="!form.account" v-model="form.email" label="Or just their email address" type="email" hint="For someone who has no account, or whose account can't be found." persistent-hint class="mb-3"/>
					<v-text-field v-model="form.receivedAt" type="date" label="Date received" :max="today" hint="The deadline counts from here." persistent-hint class="mb-3"/>
					<v-textarea v-model="form.notes" label="Notes (how it arrived, what they wrote)" rows="2" auto-grow maxlength="4000"/>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="creating = false">Cancel</v-btn><v-btn color="primary" variant="flat" :loading="saving" :disabled="!form.account && !form.email" @click="create">Log it</v-btn></v-card-actions>
			</v-card>
		</v-dialog>

		<!-- One request, step by step -->
		<v-dialog v-model="dialog" max-width="640" scrollable>
			<v-card v-if="current">
				<v-card-title class="d-flex align-center ga-2">{{ current.kind === "erasure" ? "Erasure request" : "Access request" }}<v-spacer/><v-chip size="small" variant="tonal" :color="statusColor[current.status]">{{ statusText[current.status] }}</v-chip></v-card-title>
				<v-card-text>
					<div class="text-body-2 mb-1"><strong>{{ current.subjectName ?? current.subjectEmail }}</strong> · {{ current.subjectEmail }}</div>
					<div class="text-body-2 text-medium-emphasis mb-3">Received {{ dateOnly(current.receivedAt) }} · due {{ dateOnly(current.dueAt) }}<template v-if="current.daysLeft !== null"> ({{ current.overdue ? `${-current.daysLeft} days late` : `${current.daysLeft} days left` }})</template></div>
					<p v-if="current.notes" class="text-body-2 mb-3" style="white-space: pre-wrap">{{ current.notes }}</p>
					<v-alert v-if="current.extensionReason" type="info" variant="tonal" density="compact" class="mb-3">Deadline extended: {{ current.extensionReason }}</v-alert>
					<v-alert v-if="current.resolution" :type="current.status === 'rejected' ? 'warning' : 'success'" variant="tonal" density="compact" class="mb-3">{{ current.resolution }}</v-alert>

					<template v-if="open_ && canWrite()">
						<div class="text-subtitle-2 mb-1">Steps</div>
						<v-checkbox v-model="steps.identity" density="compact" hide-details label="I checked that the request really comes from this person (for example by replying to the address on their account, or asking them to sign in)."/>

						<template v-if="current.kind === 'access'">
							<div class="step mt-2">
								<div class="text-body-2 mb-2">Download everything held about them (profile, sign-ins, memberships, notes). Vault contents are not included.</div>
								<v-btn variant="tonal" prepend-icon="mdi-folder-zip-outline" :disabled="!current.userId" :loading="exporting" @click="exportData">Download their data (ZIP)</v-btn>
								<span v-if="!current.userId" class="text-caption text-medium-emphasis ml-2">There is no account with this email.</span>
							</div>
							<v-checkbox v-model="steps.sent" density="compact" hide-details label="I sent it to them in a safe way (not as a plain attachment to an unverified address)."/>
						</template>

						<template v-else>
							<v-checkbox v-model="steps.legal" density="compact" hide-details label="I checked that nothing obliges us to keep the data (a legal duty, an open dispute)."/>
							<div v-if="memberships" class="step mt-2">
								<div class="text-body-2 mb-1">Their vaults:</div>
								<div v-for="m in memberships" :key="m.vaultId" class="text-body-2"><v-icon size="14">mdi-bookshelf</v-icon> {{ m.vaultName }} <span class="text-medium-emphasis">({{ m.role }})</span></div>
								<p v-if="!memberships.length" class="text-body-2 text-medium-emphasis">None.</p>
								<p class="text-caption text-medium-emphasis mt-2">A vault only they belong to is deleted with them. A vault shared with others is protected: the deletion is refused until another member is admin.</p>
							</div>
							<div v-if="current.status === 'processing'" class="mt-3">
								<v-alert type="info" variant="tonal" density="compact">The account is locked out and will be deleted {{ current.deletionScheduledFor ? `on ${dateOnly(current.deletionScheduledFor)}` : "soon" }}. This request closes by itself when that happens. You can cancel the deletion under Deletions.</v-alert>
							</div>
							<div v-else class="mt-3">
								<v-checkbox v-model="immediate" density="compact" hide-details label="Delete right away, without the grace period"/>
								<v-btn color="error" variant="flat" class="mt-2" prepend-icon="mdi-eraser" :disabled="!steps.identity || !steps.legal || !current.userId" :loading="erasing" @click="erase">Erase the account…</v-btn>
								<span v-if="!current.userId" class="text-caption text-medium-emphasis ml-2">There is no account to erase: close the request and tell them.</span>
							</div>
						</template>

						<v-divider class="my-4"/>
						<v-textarea v-model="resolution" label="How was it answered? (kept on record)" rows="2" auto-grow maxlength="4000" hide-details class="mb-3"/>
						<div class="d-flex flex-wrap ga-2">
							<v-btn color="success" variant="flat" prepend-icon="mdi-check" :loading="closing" @click="close('completed')">Mark as answered</v-btn>
							<v-btn variant="tonal" color="warning" @click="rejecting = true">Refuse…</v-btn>
							<v-btn v-if="!current.extendedAt" variant="text" prepend-icon="mdi-calendar-plus" @click="extending = true">Extend the deadline…</v-btn>
						</div>
					</template>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="dialog = false">Close</v-btn></v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="extending" max-width="460">
			<v-card class="pa-2">
				<v-card-title>Extend the deadline</v-card-title>
				<v-card-text>
					<p class="text-body-2 mb-3">GDPR allows up to two more months for a complex request or many requests. You must tell the person about the extension, and why, within the first month. This can be done once.</p>
					<v-textarea v-model="reason" label="Why is more time needed?" rows="2" auto-grow maxlength="1000"/>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="extending = false">Cancel</v-btn><v-btn color="primary" variant="flat" :disabled="!reason.trim()" @click="extend">Extend to three months</v-btn></v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="rejecting" max-width="460">
			<v-card class="pa-2">
				<v-card-title>Refuse this request</v-card-title>
				<v-card-text>
					<p class="text-body-2 mb-3">You must tell the person why, and that they may complain to the data protection authority.</p>
					<v-textarea v-model="reason" label="Reason" rows="2" auto-grow maxlength="4000"/>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="rejecting = false">Cancel</v-btn><v-btn color="warning" variant="flat" :disabled="!reason.trim()" @click="reject">Refuse the request</v-btn></v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref} from "vue";
import {useRoute, useRouter} from "vue-router";
import type {DataRequestStatus, IAccountMembership, IDataRequest} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateOnly} from "@/utils/format";
import PageHeader from "@/components/PageHeader.vue";

const route = useRoute();
const router = useRouter();
const statusText: Record<DataRequestStatus, string> = {open: "Open", processing: "Being erased", completed: "Answered", rejected: "Refused"};
const statusColor: Record<DataRequestStatus, string | undefined> = {open: "info", processing: "warning", completed: "success", rejected: undefined};

const items = ref<IDataRequest[]>([]);
const counts = ref<{open: number; overdue: number} | null>(null);
const tab = ref("active");
const shown = computed(() => items.value.filter((r) => (tab.value === "active") === (r.status === "open" || r.status === "processing")));
const today = new Date().toISOString().slice(0, 10);

// ---- create
const creating = ref(false);
const saving = ref(false);
const searching = ref(false);
const found = ref<{id: number; label: string}[]>([]);
const form = reactive({kind: "access" as "access" | "erasure", account: null as {id: number; label: string} | null, email: "", receivedAt: today, notes: ""});
let searchTimer: ReturnType<typeof setTimeout> | undefined;

function openCreate(userId?: number) {
	form.kind = "access";
	form.account = null;
	form.email = "";
	form.receivedAt = today;
	form.notes = "";
	found.value = [];
	creating.value = true;
	if (userId) {
		void api.users.get(userId).then(({user}) => {
			form.account = {id: user.id, label: `${user.name} (${user.code})`};
			found.value = [form.account];
		});
	}
}

function searchAccounts(text: string | null) {
	clearTimeout(searchTimer);
	if (!text || text.length < 2 || form.account?.label === text) return;
	searchTimer = setTimeout(async () => {
		searching.value = true;
		try {
			found.value = (await api.users.list({search: text, pageSize: 8})).items.map((u) => ({id: u.id, label: `${u.name} (${u.code}) · ${u.email}`}));
		} finally {
			searching.value = false;
		}
	}, 250);
}

async function create() {
	saving.value = true;
	try {
		const made = await api.dataRequests.create({
			kind: form.kind, userId: form.account?.id, email: form.account ? undefined : form.email.trim(), receivedAt: new Date(`${form.receivedAt}T12:00:00`).toISOString(), notes: form.notes.trim() || undefined,
		});
		creating.value = false;
		notify("The request is logged. The clock is running.");
		await load();
		await open(made);
	} finally {
		saving.value = false;
	}
}

// ---- one request
const dialog = ref(false);
const current = ref<IDataRequest | null>(null);
const memberships = ref<IAccountMembership[] | null>(null);
const steps = reactive({identity: false, sent: false, legal: false});
const immediate = ref(false);
const resolution = ref("");
const reason = ref("");
const exporting = ref(false);
const erasing = ref(false);
const closing = ref(false);
const extending = ref(false);
const rejecting = ref(false);
const open_ = computed(() => current.value?.status === "open" || current.value?.status === "processing");

async function open(request: IDataRequest) {
	current.value = request;
	steps.identity = steps.sent = steps.legal = false;
	immediate.value = false;
	resolution.value = "";
	reason.value = "";
	memberships.value = null;
	dialog.value = true;
	if (request.kind === "erasure" && request.userId) {
		memberships.value = (await api.users.get(request.userId)).memberships;
	}
}

async function refresh(id: number) {
	await load();
	current.value = items.value.find((r) => r.id === id) ?? current.value;
}

async function exportData() {
	exporting.value = true;
	try {
		const url = await api.dataRequests.exportLink(current.value!.userId!);
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

async function erase() {
	erasing.value = true;
	try {
		const result = await api.dataRequests.erase(current.value!.id, immediate.value);
		notify(result.executed ? "The account was erased." : "The account is locked and will be deleted after the grace period.");
		await refresh(current.value!.id);
	} finally {
		erasing.value = false;
	}
}

async function close(outcome: "completed" | "rejected", text: string = resolution.value) {
	closing.value = true;
	try {
		await api.dataRequests.close(current.value!.id, outcome, text);
		notify(outcome === "completed" ? "Marked as answered." : "The request was refused and the reason recorded.");
		rejecting.value = false;
		await refresh(current.value!.id);
	} finally {
		closing.value = false;
	}
}

const reject = () => close("rejected", reason.value);

async function extend() {
	await api.dataRequests.extend(current.value!.id, reason.value.trim());
	notify("The deadline is now three months from receipt.");
	extending.value = false;
	reason.value = "";
	await refresh(current.value!.id);
}

async function load() {
	const result = await api.dataRequests.list();
	items.value = result.items;
	counts.value = result.counts;
}

onMounted(async () => {
	await load();
	if (route.query.new) {
		openCreate(route.query.user ? Number(route.query.user) : undefined);
		void router.replace({query: {}});
	}
});
</script>

<style scoped>
.step {
	padding: 10px 12px;
	border: 1px solid var(--pb-border);
	border-radius: 10px;
	background: var(--pb-surface-alt);
}
</style>
