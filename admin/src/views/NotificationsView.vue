<template>
	<!--
	  Notifications (route /notifications, menu: Platform > Notifications)

	  Which events email the admins, who receives them, and the history of what was sent.
	  Events: new account to approve, security alerts, database problems, email failures, deletions, new version, anomalies, data requests,
	  failed background jobs, server start. Each has an on/off switch (and sometimes a threshold, e.g. 5 failed emails).
	  The same alert is not repeated within its cooldown. Webhooks receive the same events independently of these switches.
	  Data:   GET /notifications, PUT /notifications/me, PATCH /notifications/recipients/:id, POST /notifications/test
	-->
	<div class="page">
		<page-header title="Notifications" subtitle="Emails the console sends to the admins: things that need approval, and problems, so you hear about them without watching the console.">
			<v-btn variant="tonal" prepend-icon="mdi-email-fast-outline" :loading="testing" :disabled="!overview?.mailEnabled" @click="sendTest">Send me a test</v-btn>
		</page-header>

		<v-alert v-if="overview && !overview.mailEnabled" type="warning" variant="tonal" class="mb-4" icon="mdi-email-off-outline">
			Email isn't set up, so nothing can be sent. Events are still listed in the history as skipped.
			<template #append><v-btn variant="text" to="/settings">Set up email</v-btn></template>
		</v-alert>

		<!-- Events: grouped by subject, one row per event with its switch on the right and its number, if any, under the text. -->
		<v-card class="mb-4">
			<div class="pa-4 pb-3">
				<div class="text-subtitle-1 font-weight-medium">What to be told about</div>
				<p class="text-body-2 text-medium-emphasis mt-1">The same alert isn't repeated for a while, so a problem that lasts doesn't fill your inbox. Problems are checked every five minutes.</p>
			</div>
			<section v-for="group in eventGroups" :key="group.title">
				<h3 class="event-group">{{ group.title }}</h3>
				<div v-for="item in group.items" :key="item.key" class="event">
					<div class="event-main">
						<label class="event-text" :for="item.key">
							<span class="d-block text-body-2 font-weight-medium">{{ item.label }}</span>
							<span class="d-block text-caption text-medium-emphasis">{{ item.description }}</span>
						</label>
						<v-switch
							:id="item.key"
							:model-value="form[item.key] === 'true'"
							color="primary"
							hide-details
							class="flex-grow-0"
							:disabled="!canWrite()"
							@update:model-value="form[item.key] = $event ? 'true' : 'false'"
						/>
					</div>
					<div v-for="extra in extras(item.key)" :key="extra.key" class="event-extra">
						<label class="event-text" :for="extra.key">
							<span class="d-block text-body-2">{{ extra.label }}</span>
							<span class="d-block text-caption text-medium-emphasis">{{ extra.description }}</span>
						</label>
						<v-text-field :id="extra.key" v-model="form[extra.key]" type="number" min="1" hide-details :placeholder="extra.defaultValue ?? 'Off'" :disabled="!canWrite() || form[item.key] !== 'true'" class="event-number"/>
					</div>
				</div>
			</section>
			<div v-if="canWrite()" class="event-actions">
				<v-btn variant="text" :disabled="!dirty" @click="reset">Discard changes</v-btn>
				<v-btn color="primary" variant="flat" :loading="saving" :disabled="!dirty" @click="save">Save</v-btn>
			</div>
		</v-card>

		<!-- Recipients -->
		<v-card class="pa-5 mb-4">
			<div class="text-subtitle-1 font-weight-medium mb-1">Who receives them</div>
			<p class="text-body-2 text-medium-emphasis mb-3">Sent to each admin's sign-in email address. Everyone chooses for themselves; a superadmin can also change it for others.</p>
			<v-table v-if="overview">
				<thead><tr><th>Admin</th><th>Role</th><th class="text-right">Receives notifications</th></tr></thead>
				<tbody>
					<tr v-for="admin in overview.recipients" :key="admin.id">
						<td>
							<div class="font-weight-medium">{{ admin.name }} <v-chip v-if="admin.id === overview.me" size="x-small" variant="tonal" class="ml-1">you</v-chip> <v-chip v-if="admin.disabled" size="x-small" color="error" variant="tonal" class="ml-1">disabled</v-chip></div>
							<div class="text-caption text-medium-emphasis">{{ admin.email }}</div>
						</td>
						<td>{{ admin.role === "superadmin" ? "Superadmin" : "Read-only" }}</td>
						<td class="text-right">
							<v-switch
								:model-value="admin.notifyEmail"
								color="primary"
								hide-details
								density="compact"
								class="d-inline-flex"
								:disabled="admin.disabled || (admin.id !== overview.me && !canWrite())"
								@update:model-value="subscribe(admin.id, !!$event)"
							/>
						</td>
					</tr>
				</tbody>
			</v-table>
			<p class="text-caption text-medium-emphasis mt-2">The address is the one used to sign in. Make sure it can receive mail.</p>
		</v-card>

		<!-- History -->
		<v-card>
			<div class="d-flex align-center pa-4 pb-0">
				<div class="text-subtitle-1 font-weight-medium">What was sent</div>
				<v-spacer/>
				<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="loadHistory"/>
			</div>
			<div class="table-wrap">
				<v-table density="compact">
					<thead><tr><th>When</th><th>Event</th><th>Subject</th><th>Result</th></tr></thead>
					<tbody>
						<tr v-for="entry in history" :key="entry.id">
							<td class="text-no-wrap">{{ dateTime(entry.createdDate) }}</td>
							<td><v-chip size="x-small" variant="tonal">{{ typeLabel[entry.type] ?? entry.type }}</v-chip></td>
							<td>{{ entry.subject.replace("[Vaultisse] ", "") }}</td>
							<td>
								<v-chip size="x-small" variant="tonal" :color="entry.status === 'sent' ? 'success' : entry.status === 'failed' ? 'error' : undefined">
									{{ entry.status === "sent" ? `Sent to ${entry.recipients}` : entry.status === "failed" ? "Failed" : "Not sent" }}
								</v-chip>
								<div v-if="entry.detail" class="text-caption text-medium-emphasis mt-1" style="max-width: 360px">{{ entry.detail }}</div>
							</td>
						</tr>
						<tr v-if="!history.length"><td colspan="4" class="text-center text-medium-emphasis pa-6">Nothing yet.</td></tr>
					</tbody>
				</v-table>
			</div>
			<pager :page="page" :page-size="25" :total="total" @update:page="page = $event; loadHistory()"/>
		</v-card>
	</div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref} from "vue";
import type {INotificationEntry, INotificationsOverview, ISetting} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateTime} from "@/utils/format";
import PageHeader from "@/components/PageHeader.vue";
import Pager from "@/components/Pager.vue";

const overview = ref<INotificationsOverview | null>(null);
const settings = ref<ISetting[]>([]);
const form = reactive<Record<string, string>>({});
const history = ref<INotificationEntry[]>([]);
const total = ref(0);
const page = ref(1);
const saving = ref(false);
const testing = ref(false);

const typeLabel: Record<string, string> = {
	user_pending: "Approval", security: "Security", database: "Database", mail_failures: "Email", deletions: "Deletion", updates: "Update", startup: "Start", anomaly: "Anomaly", data_requests: "Data request", test: "Test",
};

const switches = computed(() => settings.value.filter((item) => item.type === "boolean"));
/** Which events are listed under which heading; an event missing here is listed under "Other". */
const groupKeys: Record<string, string[]> = {
	"Accounts and data": ["ADMIN_NOTIFY_USER_PENDING", "ADMIN_NOTIFY_DELETIONS", "ADMIN_NOTIFY_DATA_REQUESTS"],
	"Security": ["ADMIN_NOTIFY_SECURITY", "ADMIN_NOTIFY_ANOMALY"],
	"System": ["ADMIN_NOTIFY_DATABASE", "ADMIN_NOTIFY_MAIL_FAILURES", "ADMIN_NOTIFY_JOBS", "ADMIN_NOTIFY_UPDATES", "ADMIN_NOTIFY_STARTUP"],
};
/** The switches under their headings, empty headings left out. */
const eventGroups = computed(() => {
	const known = Object.values(groupKeys).flat();
	return [
		...Object.entries(groupKeys).map(([title, keys]) => ({title, items: switches.value.filter((item) => keys.includes(item.key))})),
		{title: "Other", items: switches.value.filter((item) => !known.includes(item.key))},
	].filter((group) => group.items.length);
});
/** The number fields that belong to a switch (the security threshold, the size limit). */
const extras = (switchKey: string) => settings.value.filter((item) => item.type === "number" && item.key.startsWith(`${switchKey}_`) || (switchKey === "ADMIN_NOTIFY_DATABASE" && item.key === "ADMIN_NOTIFY_DB_SIZE_MB"));
const dirty = computed(() => settings.value.some((item) => (form[item.key] ?? "") !== (item.value ?? "")));

function fill(items: ISetting[]) {
	settings.value = items;
	for (const item of items) {
		form[item.key] = item.value ?? "";
	}
}

function reset() {
	fill(settings.value);
}

async function loadSettings() {
	const groups = await api.settings.list();
	fill(groups.find((group) => group.id === "notifications")?.items ?? []);
}

async function save() {
	const changes: Record<string, string> = {};
	for (const item of settings.value) {
		if ((form[item.key] ?? "") !== (item.value ?? "")) {
			changes[item.key] = form[item.key] ?? "";
		}
	}
	saving.value = true;
	try {
		const groups = await api.settings.update(changes);
		fill(groups.find((group) => group.id === "notifications")?.items ?? []);
		notify("Saved.");
	} finally {
		saving.value = false;
	}
}

async function subscribe(adminId: number, value: boolean) {
	await api.notifications.setSubscription(value, adminId === overview.value?.me ? undefined : adminId);
	overview.value = await api.notifications.overview();
}

async function sendTest() {
	testing.value = true;
	try {
		const result = await api.notifications.test();
		notify(result.ok ? `Test sent to ${result.to}.` : `The mail server refused it: ${result.error}`, result.ok ? "success" : "error");
	} finally {
		testing.value = false;
	}
}

async function loadHistory() {
	const result = await api.notifications.history({page: page.value});
	history.value = result.items;
	total.value = result.total;
}

onMounted(async () => {
	await Promise.all([api.notifications.overview().then((value) => (overview.value = value)), loadSettings(), loadHistory()]);
});
</script>

<style scoped>
.event-group {
	padding: 8px 16px;
	border-top: 1px solid var(--pb-border);
	background: rgba(var(--v-theme-on-surface), 0.03);
	font-family: var(--pb-font-mono);
	font-size: 11px;
	font-weight: 500;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--pb-text-muted);
}

.event {
	padding: 10px 16px;
	border-top: 1px solid var(--pb-border);
}

.event-main,
.event-extra {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 24px;
}

.event-extra {
	margin-top: 10px;
	padding-left: 14px;
	border-left: 2px solid var(--pb-border-strong);
}

.event-text {
	flex: 1;
	min-width: 0;
}

.event-main .v-switch {
	flex-shrink: 0;
	padding-right: 2px;
}

.event-number {
	flex: 0 0 110px;
}

.event-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	padding: 12px 16px;
	border-top: 1px solid var(--pb-border);
}
</style>
