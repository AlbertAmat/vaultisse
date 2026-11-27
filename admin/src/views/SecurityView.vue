<template>
	<div class="page">
		<page-header title="Security" subtitle="What the app sees: traffic, failed logins, rate limiting. It can refuse addresses you block, but a real DDoS has to be stopped in front of the app (CDN, reverse proxy or firewall).">
			<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="refresh"/>
		</page-header>

		<v-row v-if="summary" class="mb-1">
			<v-col cols="6" md="3"><stat-card label="Requests, last hour" :value="num(summary.lastHour.total)" icon="mdi-swap-vertical" :hint="`${num(summary.lastHour.serverErrors)} server errors`"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Rate limited, last hour" :value="num(summary.lastHour.rateLimited)" icon="mdi-speedometer" :color="summary.lastHour.rateLimited ? 'warning' : undefined"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Locked accounts" :value="num(summary.lockedAccounts)" icon="mdi-account-lock-outline" :color="summary.lockedAccounts ? 'warning' : undefined"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Blocked addresses" :value="num(summary.blockedIps)" icon="mdi-shield-off-outline"/></v-col>
		</v-row>

		<v-card>
			<v-tabs v-model="tab" color="primary" show-arrows>
				<v-tab value="traffic">Live traffic</v-tab>
				<v-tab value="events">Events</v-tab>
				<v-tab value="lockouts">Locked accounts</v-tab>
				<v-tab value="blocked">Blocked addresses</v-tab>
				<v-tab value="sessions">Sessions</v-tab>
			</v-tabs>
			<v-divider/>

			<v-tabs-window v-model="tab">
				<!-- Traffic -->
				<v-tabs-window-item value="traffic">
					<div v-if="traffic" class="pa-4">
						<div class="text-subtitle-2 mb-2">Requests per minute, last hour <span class="text-caption text-medium-emphasis">(this server, resets on restart · refreshes every 15 s)</span></div>
						<chart-panel
							type="bar"
							stacked
							:height="240"
							:labels="traffic.series.map((p) => clock(p.minute))"
							:series="[
								{label: 'OK', data: traffic.series.map((p) => p.total - p.clientErrors - p.serverErrors - p.rateLimited), color: 'success'},
								{label: '4xx', data: traffic.series.map((p) => p.clientErrors), color: 'warning'},
								{label: 'Rate limited', data: traffic.series.map((p) => p.rateLimited), color: 'secondary'},
								{label: '5xx', data: traffic.series.map((p) => p.serverErrors), color: 'error'},
							]"
						/>
						<div class="text-subtitle-2 mt-5 mb-1">Busiest addresses, last 10 minutes</div>
						<v-table density="compact">
							<thead><tr><th>Address</th><th>Requests</th><th></th></tr></thead>
							<tbody>
								<tr v-for="ip in traffic.topIps" :key="ip.ipAddress">
									<td class="mono">{{ ip.ipAddress }}</td>
									<td>{{ num(ip.requests) }}</td>
									<td class="text-right">
										<v-btn v-if="canWrite()" size="small" variant="text" color="error" @click="blockDialog(ip.ipAddress)">Block…</v-btn>
										<v-btn size="small" variant="text" @click="filterEvents(ip.ipAddress)">Events</v-btn>
									</td>
								</tr>
								<tr v-if="!traffic.topIps.length"><td colspan="3" class="text-medium-emphasis text-center pa-4">No traffic yet.</td></tr>
							</tbody>
						</v-table>
					</div>
				</v-tabs-window-item>

				<!-- Events -->
				<v-tabs-window-item value="events">
					<div class="d-flex flex-wrap ga-3 pa-4">
						<v-select v-model="eventType" :items="eventTypes" clearable placeholder="Any type" style="max-width: 240px" @update:model-value="loadEvents(true)"/>
						<v-text-field v-model="eventIp" placeholder="Filter by address" clearable style="max-width: 240px" @update:model-value="loadEvents(true)"/>
					</div>
					<div class="table-wrap">
						<v-table density="compact">
							<thead><tr><th>Minute</th><th>Type</th><th>Address</th><th>Count</th><th>Detail</th></tr></thead>
							<tbody>
								<tr v-for="(event, i) in events" :key="i">
									<td class="text-no-wrap">{{ dateTime(event.bucket) }}</td>
									<td><v-chip size="x-small" variant="tonal" :color="typeColor(event.type)">{{ typeLabel(event.type) }}</v-chip></td>
									<td class="mono">{{ event.ipAddress }}</td>
									<td>{{ num(event.count) }}</td>
									<td class="text-caption text-medium-emphasis">{{ [event.detail, event.lastPath].filter(Boolean).join(" · ") }}</td>
								</tr>
								<tr v-if="!events.length"><td colspan="5" class="text-center text-medium-emphasis pa-6">No events.</td></tr>
							</tbody>
						</v-table>
					</div>
					<pager :page="eventPage" :page-size="25" :total="eventTotal" @update:page="eventPage = $event; loadEvents(false)"/>
				</v-tabs-window-item>

				<!-- Lockouts -->
				<v-tabs-window-item value="lockouts">
					<div class="table-wrap">
						<v-table>
							<thead><tr><th>Account</th><th>Failed attempts</th><th>Locked until</th><th></th></tr></thead>
							<tbody>
								<tr v-for="lock in lockouts" :key="lock.userId">
									<td><div class="font-weight-medium">{{ lock.code }}</div><div class="text-caption text-medium-emphasis">{{ lock.email }}</div></td>
									<td>{{ lock.failedLoginCount }}</td>
									<td>{{ dateTime(lock.lockoutUntil ?? lock.totpLockoutUntil) }}</td>
									<td class="text-right"><v-btn v-if="canWrite()" size="small" variant="tonal" @click="clearLock(lock.userId)">Unlock</v-btn></td>
								</tr>
								<tr v-if="!lockouts.length"><td colspan="4" class="text-center text-medium-emphasis pa-6">No account is locked.</td></tr>
							</tbody>
						</v-table>
					</div>
				</v-tabs-window-item>

				<!-- Blocked IPs -->
				<v-tabs-window-item value="blocked">
					<!-- Automatic blocking -->
					<div class="pa-4 pb-0">
						<div class="auto pa-4">
							<div class="d-flex flex-wrap align-center ga-3">
								<v-icon color="primary">mdi-shield-lock-outline</v-icon>
								<div style="flex: 1; min-width: 220px">
									<div class="font-weight-medium">Automatic blocking</div>
									<div class="text-body-2 text-medium-emphasis">Blocks an address that keeps failing to sign in, so you don't have to do it by hand.</div>
								</div>
								<v-switch v-model="auto.ADMIN_AUTOBLOCK_ENABLED" color="primary" hide-details :label="auto.ADMIN_AUTOBLOCK_ENABLED ? 'On' : 'Off'" :disabled="!canWrite()"/>
							</div>
							<div v-if="auto.ADMIN_AUTOBLOCK_ENABLED" class="d-flex flex-wrap align-start ga-3 mt-3">
								<span class="mt-2">Block an address after</span>
								<v-text-field v-model="auto.ADMIN_AUTOBLOCK_THRESHOLD" type="number" min="3" style="width: 90px" :disabled="!canWrite()"/>
								<span class="mt-2">failed logins within</span>
								<v-text-field v-model="auto.ADMIN_AUTOBLOCK_WINDOW_MIN" type="number" min="1" suffix="min" style="width: 120px" :disabled="!canWrite()"/>
								<span class="mt-2">, for</span>
								<v-text-field v-model="auto.ADMIN_AUTOBLOCK_HOURS" type="number" min="1" suffix="h" style="width: 110px" :disabled="!canWrite()"/>
							</div>
							<div class="d-flex flex-wrap align-center ga-3 mt-2">
								<p class="text-caption text-medium-emphasis" style="flex: 1; min-width: 240px">
									Never blocks private or local addresses, or one that signed in successfully in the last 24 hours. Behind a reverse proxy, set <span class="mono">TRUST_PROXY=true</span> so real visitor addresses are seen. The admins are emailed when one is blocked.
								</p>
								<v-btn v-if="canWrite()" color="primary" variant="flat" size="small" :loading="savingAuto" :disabled="!autoDirty" @click="saveAuto">Save</v-btn>
							</div>
						</div>
					</div>

					<div v-if="canWrite()" class="d-flex flex-wrap ga-3 pa-4 align-start">
						<v-text-field v-model="blockForm.ip" label="IP address" placeholder="203.0.113.7" style="max-width: 220px"/>
						<v-text-field v-model="blockForm.reason" label="Reason" style="max-width: 280px"/>
						<v-text-field v-model="blockForm.hours" label="Hours" type="number" min="1" placeholder="No end" style="max-width: 130px"/>
						<v-btn color="error" variant="flat" class="mt-1" :disabled="!blockForm.ip" @click="block">Block</v-btn>
					</div>
					<div class="table-wrap">
						<v-table>
							<thead><tr><th>Address</th><th>Reason</th><th>By</th><th>Until</th><th></th></tr></thead>
							<tbody>
								<tr v-for="b in blocked" :key="b.ipAddress">
									<td class="mono">{{ b.ipAddress }} <v-chip v-if="b.automatic" size="x-small" color="primary" variant="tonal" class="ml-1">auto</v-chip></td>
									<td>{{ b.reason ?? "—" }}</td>
									<td class="text-caption">{{ b.automatic ? "Automatic" : (b.blockedBy ?? "—") }}<div class="text-medium-emphasis">{{ relative(b.createdDate) }}</div></td>
									<td>{{ b.expiresAt ? dateTime(b.expiresAt) : "Until unblocked" }}</td>
									<td class="text-right"><v-btn v-if="canWrite()" size="small" variant="tonal" @click="unblock(b.ipAddress)">Unblock</v-btn></td>
								</tr>
								<tr v-if="!blocked.length"><td colspan="5" class="text-center text-medium-emphasis pa-6">No address is blocked.</td></tr>
							</tbody>
						</v-table>
					</div>
					<p class="text-caption text-medium-emphasis pa-4">Exact addresses only. Blocked addresses get an empty 403 on both the app and this console. Behind a reverse proxy, turn on TRUST_PROXY so the real client address is seen.</p>
				</v-tabs-window-item>

				<!-- Sessions -->
				<v-tabs-window-item value="sessions">
					<div class="table-wrap">
						<v-table density="compact">
							<thead><tr><th>Account</th><th>Address</th><th>Browser</th><th>Signed in</th><th>Last seen</th><th></th></tr></thead>
							<tbody>
								<tr v-for="s in sessions" :key="s.id">
									<td class="font-weight-medium">{{ s.userCode }}</td>
									<td class="mono">{{ s.ipAddress ?? "—" }}</td>
									<td class="text-caption text-medium-emphasis" style="max-width: 260px">{{ s.userAgent ?? "—" }}</td>
									<td>{{ relative(s.createdDate) }}</td>
									<td>{{ relative(s.lastSeenDate) }}</td>
									<td class="text-right"><v-btn v-if="canWrite()" size="small" variant="text" color="error" @click="revoke(s.id)">End</v-btn></td>
								</tr>
								<tr v-if="!sessions.length"><td colspan="6" class="text-center text-medium-emphasis pa-6">No live sessions.</td></tr>
							</tbody>
						</v-table>
					</div>
					<pager :page="sessionPage" :page-size="25" :total="sessionTotal" @update:page="sessionPage = $event; loadSessions()"/>
				</v-tabs-window-item>
			</v-tabs-window>
		</v-card>

		<v-dialog v-model="confirmBlock" max-width="420">
			<v-card class="pa-2">
				<v-card-title>Block {{ blockForm.ip }}?</v-card-title>
				<v-card-text>
					<v-text-field v-model="blockForm.reason" label="Reason (optional)" class="mb-3"/>
					<v-text-field v-model="blockForm.hours" label="Hours (empty = until unblocked)" type="number" min="1"/>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="confirmBlock = false">Cancel</v-btn><v-btn color="error" variant="flat" @click="block().then(() => (confirmBlock = false))">Block</v-btn></v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, reactive, ref, watch} from "vue";
import type {IBlockedIp, ISettingGroup, ILockout, ISecurityEvent, ISecuritySummary, ITraffic, IUserSession, SecurityEventType} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateTime, num, relative} from "@/utils/format";
import ChartPanel from "@/components/ChartPanel.vue";
import PageHeader from "@/components/PageHeader.vue";
import Pager from "@/components/Pager.vue";
import StatCard from "@/components/StatCard.vue";

const tab = ref("traffic");
const summary = ref<ISecuritySummary | null>(null);
const traffic = ref<ITraffic | null>(null);
const events = ref<ISecurityEvent[]>([]);
const eventTotal = ref(0);
const eventPage = ref(1);
const eventType = ref<string | null>(null);
const eventIp = ref("");
const lockouts = ref<ILockout[]>([]);
const blocked = ref<IBlockedIp[]>([]);
const sessions = ref<IUserSession[]>([]);
const sessionTotal = ref(0);
const sessionPage = ref(1);
const blockForm = reactive({ip: "", reason: "", hours: ""});
const auto = reactive({ADMIN_AUTOBLOCK_ENABLED: false, ADMIN_AUTOBLOCK_THRESHOLD: "20", ADMIN_AUTOBLOCK_WINDOW_MIN: "10", ADMIN_AUTOBLOCK_HOURS: "24"});
const autoSaved = ref("");
const savingAuto = ref(false);
const autoSnapshot = () => JSON.stringify(auto);
const autoDirty = computed(() => autoSnapshot() !== autoSaved.value);

/** Loads the automatic-blocking settings into the form. */
function fillAuto(groups: ISettingGroup[]) {
	for (const item of groups.find((group) => group.id === "security")?.items ?? []) {
		if (item.key === "ADMIN_AUTOBLOCK_ENABLED") auto.ADMIN_AUTOBLOCK_ENABLED = item.value === "true";
		if (item.key === "ADMIN_AUTOBLOCK_THRESHOLD") auto.ADMIN_AUTOBLOCK_THRESHOLD = item.value ?? "";
		if (item.key === "ADMIN_AUTOBLOCK_WINDOW_MIN") auto.ADMIN_AUTOBLOCK_WINDOW_MIN = item.value ?? "";
		if (item.key === "ADMIN_AUTOBLOCK_HOURS") auto.ADMIN_AUTOBLOCK_HOURS = item.value ?? "";
	}
	autoSaved.value = autoSnapshot();
}

async function saveAuto() {
	savingAuto.value = true;
	try {
		fillAuto(await api.settings.update({
			ADMIN_AUTOBLOCK_ENABLED: String(auto.ADMIN_AUTOBLOCK_ENABLED),
			ADMIN_AUTOBLOCK_THRESHOLD: String(auto.ADMIN_AUTOBLOCK_THRESHOLD),
			ADMIN_AUTOBLOCK_WINDOW_MIN: String(auto.ADMIN_AUTOBLOCK_WINDOW_MIN),
			ADMIN_AUTOBLOCK_HOURS: String(auto.ADMIN_AUTOBLOCK_HOURS),
		}));
		notify(auto.ADMIN_AUTOBLOCK_ENABLED ? "Automatic blocking is on." : "Automatic blocking is off.");
	} finally {
		savingAuto.value = false;
	}
}
const confirmBlock = ref(false);

const eventTypes = [
	{title: "Rate limited", value: "rate_limited"},
	{title: "Failed login", value: "login_failed"},
	{title: "Account locked", value: "login_locked"},
	{title: "Failed admin login", value: "admin_login_failed"},
	{title: "Blocked address", value: "blocked_ip_hit"},
];
const typeLabel = (type: SecurityEventType) => eventTypes.find((t) => t.value === type)?.title ?? type;
const typeColor = (type: SecurityEventType) => ({rate_limited: "warning", login_failed: "secondary", login_locked: "warning", admin_login_failed: "error", blocked_ip_hit: "error"}[type]);
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, {hour: "2-digit", minute: "2-digit"});

async function loadTraffic() {
	[summary.value, traffic.value] = await Promise.all([api.security.summary(), api.security.traffic()]);
}

async function loadEvents(reset: boolean) {
	if (reset) {
		eventPage.value = 1;
	}
	const result = await api.security.events({type: eventType.value ?? undefined, ip: eventIp.value ?? "", page: eventPage.value});
	events.value = result.items;
	eventTotal.value = result.total;
}

async function loadSessions() {
	const result = await api.security.sessions({page: sessionPage.value});
	sessions.value = result.items;
	sessionTotal.value = result.total;
}

async function refresh() {
	await Promise.all([loadTraffic(), loadEvents(false), api.security.lockouts().then((l) => (lockouts.value = l)), api.security.blockedIps().then((b) => (blocked.value = b)), loadSessions()]);
}

function filterEvents(ip: string) {
	eventIp.value = ip;
	tab.value = "events";
	loadEvents(true);
}

function blockDialog(ip: string) {
	blockForm.ip = ip;
	blockForm.reason = "";
	blockForm.hours = "";
	confirmBlock.value = true;
}

async function block() {
	await api.security.blockIp(blockForm.ip, blockForm.reason || undefined, blockForm.hours === "" ? null : Number(blockForm.hours));
	notify(`${blockForm.ip} is blocked.`);
	blockForm.ip = blockForm.reason = blockForm.hours = "";
	blocked.value = await api.security.blockedIps();
	await loadTraffic();
}

async function unblock(ip: string) {
	await api.security.unblockIp(ip);
	notify(`${ip} is unblocked.`);
	blocked.value = await api.security.blockedIps();
}

async function clearLock(userId: number) {
	await api.security.clearLockout(userId);
	notify("Account unlocked.");
	lockouts.value = await api.security.lockouts();
}

async function revoke(id: number) {
	await api.security.revokeSession(id);
	notify("Session ended.");
	await loadSessions();
}

let timer: ReturnType<typeof setInterval> | undefined;
watch(tab, () => refresh());
onMounted(() => {
	api.settings.list().then(fillAuto);
	refresh();
	timer = setInterval(() => {
		if (tab.value === "traffic" && !document.hidden) {
			loadTraffic();
		}
	}, 15000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<style scoped>
.auto {
	border: 1px solid var(--pb-border);
	border-radius: 10px;
	background: var(--pb-surface-alt);
}
</style>
