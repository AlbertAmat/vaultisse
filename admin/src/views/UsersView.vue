<template>
	<div class="page">
		<page-header title="Accounts" subtitle="Everyone with an account on this installation."/>

		<v-card>
			<div class="d-flex flex-wrap ga-3 pa-4">
				<v-text-field v-model="search" prepend-inner-icon="mdi-magnify" placeholder="Search by name, username or email" clearable style="max-width: 360px" @update:model-value="debounced"/>
				<v-select v-model="status" :items="statuses" clearable placeholder="Any status" style="max-width: 220px" @update:model-value="reload"/>
				<v-select v-model="sort" :items="sorts" style="max-width: 200px" @update:model-value="reload"/>
				<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="load"/>
			</div>
			<v-divider/>
			<div class="table-wrap">
				<v-table hover>
					<thead>
						<tr><th>Account</th><th>Status</th><th>Vaults</th><th>Last sign-in</th><th>Created</th></tr>
					</thead>
					<tbody>
						<tr v-for="user in items" :key="user.id" class="row-click" @click="open(user.id)">
							<td>
								<div class="font-weight-medium">{{ user.name }}</div>
								<div class="text-caption text-medium-emphasis">{{ user.code }} · {{ user.email }}</div>
							</td>
							<td><status-chips :user="user"/></td>
							<td>{{ user.vaultCount }}</td>
							<td>{{ relative(user.lastLoginDate) }}</td>
							<td>{{ dateOnly(user.createdDate) }}</td>
						</tr>
						<tr v-if="!items.length && !loading"><td colspan="5" class="text-center text-medium-emphasis pa-8">No accounts match.</td></tr>
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
import {defineComponent, h, onMounted, ref} from "vue";
import {useRoute} from "vue-router";
import {VChip} from "vuetify/components";
import type {IAccount, IAccountDetail, UserStatus} from "@vaultisse/types/admin/IAdmin";
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
	try {
		const result = await api.users.list({search: search.value ?? "", status: status.value ?? undefined, sort: sort.value, page: page.value, pageSize});
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
	detail.value = await api.users.get(id);
	drawer.value = true;
}

/** Runs an action on the open account, then refreshes it and the list. */
async function act(work: () => Promise<unknown>, message: string) {
	const id = detail.value!.user.id;
	await work();
	notify(message);
	detail.value = await api.users.get(id);
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
.facts {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 6px 16px;
	font-size: 0.875rem;
}

.facts dt {
	opacity: 0.65;
}
</style>
