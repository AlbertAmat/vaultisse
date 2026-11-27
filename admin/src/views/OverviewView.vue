<template>
	<!--
	  Overview (route /, menu: Overview)

	  The state of the installation at a glance: alerts, headline numbers, trends, system card. Metadata only.
	  Data:   GET /api/admin/overview            headline counts (accounts, vaults, books, failed jobs, ...)
	          GET /api/admin/overview/charts?days=7|30|90   everything the charts draw
	          GET /api/admin/system              the system card at the bottom
	  The 7/30/90 switch only reloads the charts (loadCharts); the counts above them don't depend on the period.
	-->
	<div class="page">
		<page-header title="Overview" subtitle="The state of this installation at a glance. Only metadata is shown, never what is inside a library.">
			<v-btn variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="load">Refresh</v-btn>
		</page-header>

		<!-- Shown only while accounts wait for approval; links to the filtered Accounts list. -->
		<v-alert v-if="counts && counts.usersPending > 0" type="info" variant="tonal" class="mb-4" icon="mdi-account-clock-outline">
			{{ counts.usersPending }} new {{ counts.usersPending === 1 ? "account is" : "accounts are" }} waiting for approval.
			<template #append><v-btn variant="text" to="/users?status=pending">Review</v-btn></template>
		</v-alert>
		<!-- A background job failed on its last run: see Jobs. -->
		<!-- Attacks on this console: failed sign-in attempts in the last 24 hours (from three), with a link to who and from where. -->
		<v-alert v-if="counts && counts.adminFailed24h >= 3" type="warning" variant="tonal" class="mb-4" icon="mdi-shield-alert-outline">
			{{ counts.adminFailed24h }} failed attempts to sign in to this console in the last 24 hours, from {{ counts.adminFailedIps24h }} {{ counts.adminFailedIps24h === 1 ? "address" : "addresses" }}.
			<template #append><v-btn variant="text" to="/admin-signins">See who</v-btn></template>
		</v-alert>
		<v-alert v-if="counts && counts.failedJobs > 0" type="error" variant="tonal" class="mb-4" icon="mdi-timer-alert-outline">
			{{ counts.failedJobs }} background {{ counts.failedJobs === 1 ? "job" : "jobs" }} failed on the last run.
			<template #append><v-btn variant="text" to="/jobs">See jobs</v-btn></template>
		</v-alert>
		<v-alert v-if="system && system.database !== 'ok'" type="error" variant="tonal" class="mb-4">The database is not reachable.</v-alert>

		<!-- Headline numbers. Each card with a link goes to the page that explains it. -->
		<v-row v-if="counts">
			<v-col cols="6" md="3"><stat-card label="Accounts" :value="num(counts.users)" icon="mdi-account-multiple-outline" to="/users" :hint="`${num(counts.signupsWeek)} new this week`"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Online now" :value="num(counts.activeNow)" icon="mdi-circle-medium" color="success" :hint="`${num(counts.activeDay)} today · ${num(counts.activeWeek)} this week`"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Vaults" :value="num(counts.vaults)" icon="mdi-bookshelf" to="/vaults" :hint="`${num(counts.vaultsShared)} shared · ${num(counts.vaultsSuspended)} suspended`"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Books" :value="num(counts.books)" icon="mdi-book-multiple-outline" :hint="`${num(counts.stocks)} copies · ${bytes(counts.fileBytes)} of files`"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Active this month" :value="num(counts.activeMonth)" icon="mdi-calendar-month-outline"/></v-col>
			<v-col cols="6" md="3"><stat-card label="With two-factor" :value="num(counts.usersWithTwoFactor)" icon="mdi-shield-check-outline" :hint="counts.users ? `${Math.round(counts.usersWithTwoFactor * 100 / counts.users)}% of accounts` : ''"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Disabled or unverified" :value="num(counts.usersDisabled + counts.usersUnverified)" icon="mdi-account-off-outline" :hint="`${num(counts.usersDisabled)} disabled · ${num(counts.usersUnverified)} unverified`"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Pending deletions" :value="num(counts.pendingDeletions)" icon="mdi-delete-clock-outline" to="/deletions" :color="counts.pendingDeletions ? 'warning' : undefined"/></v-col>
		</v-row>

		<!-- Period switch for the charts below (7, 30 or 90 days). -->
		<div class="d-flex flex-wrap align-center ga-3 mt-2 mb-1">
			<div class="text-subtitle-1 font-weight-medium">Trends</div>
			<v-chip-group v-model="days" mandatory selected-class="text-primary" @update:model-value="loadCharts">
				<v-chip v-for="p in periods" :key="p.value" :value="p.value" variant="text" filter>{{ p.label }}</v-chip>
			</v-chip-group>
		</div>

		<!--
		  Charts. Row 1: new accounts, sign-ins.  Row 2: accounts by status, vaults by plan, security events.
		  Row 3: library growth, failed sign-ins (users and admins), emails sent.  Row 4: vaults near their plan limit, biggest vaults.
		  Days without data are drawn as 0, so the bars always cover the whole period.
		-->
		<v-row v-if="charts">
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="text-subtitle-1 font-weight-medium mb-2">New accounts</div>
					<chart-panel :labels="charts.signups.map((p) => shortDay(p.day))" :series="[{label: 'Sign-ups', data: charts.signups.map((p) => p.count), color: 'primary'}]"/>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="text-subtitle-1 font-weight-medium mb-2">Sign-ins</div>
					<chart-panel type="line" :labels="charts.logins.map((p) => shortDay(p.day))" :series="[{label: 'Sign-ins', data: charts.logins.map((p) => p.count), color: 'secondary'}]"/>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="text-subtitle-1 font-weight-medium mb-2">Accounts by status</div>
					<chart-panel type="doughnut" :labels="['Active', 'Awaiting approval', 'Disabled', 'Email not verified']" :colors="['success', 'info', 'error', 'warning']"
						:series="[{label: 'Accounts', data: [charts.accountStatus.active, charts.accountStatus.pending, charts.accountStatus.disabled, charts.accountStatus.unverified], color: 'primary'}]"/>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="text-subtitle-1 font-weight-medium mb-2">Vaults by plan</div>
					<chart-panel v-if="charts.plans.length" type="doughnut" :labels="charts.plans.map((p) => p.name)" :series="[{label: 'Vaults', data: charts.plans.map((p) => p.vaults), color: 'primary'}]"/>
					<p v-else class="text-body-2 text-medium-emphasis">No vaults yet.</p>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="text-subtitle-1 font-weight-medium mb-2">Library growth <span class="text-caption text-medium-emphasis">books in all vaults</span></div>
					<chart-panel type="line" :labels="charts.growth.map((p) => shortDay(p.day))" :series="[{label: 'Books', data: charts.growth.map((p) => p.total), color: 'primary'}]"/>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="text-subtitle-1 font-weight-medium mb-2">Failed sign-ins</div>
					<chart-panel stacked :labels="charts.failedLogins.map((p) => shortDay(p.day))" :series="[{label: 'Users', data: charts.failedLogins.map((p) => p.users), color: 'warning'}, {label: 'Admins', data: charts.failedLogins.map((p) => p.admins), color: 'error'}]"/>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="d-flex align-center mb-2"><div class="text-subtitle-1 font-weight-medium">Emails sent</div><v-spacer/><v-btn size="x-small" variant="text" to="/logs">Logs</v-btn></div>
					<chart-panel stacked :labels="charts.emails.map((p) => shortDay(p.day))" :series="[{label: 'Delivered', data: charts.emails.map((p) => p.sent), color: 'success'}, {label: 'Failed', data: charts.emails.map((p) => p.failed), color: 'error'}]"/>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="d-flex align-center mb-2"><div class="text-subtitle-1 font-weight-medium">Closest to their plan limit</div><v-spacer/><v-btn size="x-small" variant="text" to="/plans">Plans</v-btn></div>
					<div v-for="q in charts.quota" :key="q.id" class="mb-3">
						<div class="d-flex text-body-2"><router-link :to="`/vaults?search=${encodeURIComponent(q.name)}`" class="vault-link">{{ q.name }}</router-link><span class="text-medium-emphasis ml-2">{{ q.plan }} · {{ q.limiting }}</span><v-spacer/><strong :class="q.percent >= 100 ? 'text-error' : q.percent >= 80 ? 'text-warning' : ''">{{ q.percent }}%</strong></div>
						<v-progress-linear :model-value="Math.min(q.percent, 100)" :color="q.percent >= 100 ? 'error' : q.percent >= 80 ? 'warning' : 'primary'" height="6" rounded/>
					</div>
					<p v-if="!charts.quota.length" class="text-body-2 text-medium-emphasis">No vault has a plan with limits yet.</p>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="text-subtitle-1 font-weight-medium mb-2">Biggest vaults by storage <span class="text-caption text-medium-emphasis">MB</span></div>
					<chart-panel v-if="charts.topByStorage.length" horizontal :labels="charts.topByStorage.map((v) => v.name)" :series="[{label: 'MB', data: charts.topByStorage.map((v) => Math.round(v.bytes / 1048576 * 10) / 10), color: 'secondary'}]"/>
					<p v-else class="text-body-2 text-medium-emphasis">Nothing stored yet.</p>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="text-subtitle-1 font-weight-medium mb-2">Biggest vaults by books</div>
					<chart-panel v-if="charts.topByBooks.length" horizontal :labels="charts.topByBooks.map((v) => v.name)" :series="[{label: 'Books', data: charts.topByBooks.map((v) => v.books), color: 'primary'}]"/>
					<p v-else class="text-body-2 text-medium-emphasis">No books yet.</p>
				</v-card>
			</v-col>
			<!-- Sign-ins to THIS console: green = successful (password and code), red = failed. A red spike is someone guessing; Admin sign-ins shows who. -->
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="d-flex align-center mb-2"><div class="text-subtitle-1 font-weight-medium">Admin sign-ins</div><v-spacer/><v-btn size="x-small" variant="text" to="/admin-signins">Who</v-btn></div>
					<chart-panel stacked :labels="charts.adminSignIns.map((p) => shortDay(p.day))" :series="[{label: 'Successful', data: charts.adminSignIns.map((p) => p.ok), color: 'success'}, {label: 'Failed', data: charts.adminSignIns.map((p) => p.failed), color: 'error'}]"/>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4 h-100">
					<div class="d-flex align-center mb-2"><div class="text-subtitle-1 font-weight-medium">Security events by type</div><v-spacer/><v-btn size="x-small" variant="text" to="/security">Security</v-btn></div>
					<chart-panel v-if="charts.securityByType.length" horizontal :labels="charts.securityByType.map((t) => eventNames[t.type] ?? t.type)" :series="[{label: 'Events', data: charts.securityByType.map((t) => t.total), color: 'warning'}]"/>
					<p v-else class="text-body-2 text-medium-emphasis">No security events in this period.</p>
				</v-card>
			</v-col>
		</v-row>

		<!-- System card: version, instance id, uptime, database latency and which features are on. -->
		<v-card v-if="system" class="pa-4 mt-4">
			<div class="d-flex align-center mb-3">
				<div class="text-subtitle-1 font-weight-medium">System</div>
				<v-spacer/>
				<v-btn size="small" variant="text" to="/system" append-icon="mdi-arrow-right">Details</v-btn>
			</div>
			<v-row dense>
				<v-col cols="6" md="3"><div class="text-caption text-medium-emphasis">Version</div><div class="mono">{{ system.version }}</div></v-col>
				<v-col cols="12" md="6"><div class="text-caption text-medium-emphasis">Instance id</div><div class="mono" style="word-break: break-all">{{ system.instanceUuid }}</div></v-col>
				<v-col cols="6" md="3"><div class="text-caption text-medium-emphasis">Uptime</div>{{ duration(system.uptimeSeconds) }}</v-col>
				<v-col cols="6" md="3"><div class="text-caption text-medium-emphasis">Database</div>
					<v-chip size="small" :color="system.database === 'ok' ? 'success' : 'error'" variant="tonal">{{ system.database }} · {{ system.databaseLatencyMs }} ms</v-chip>
				</v-col>
				<v-col cols="6" md="3"><div class="text-caption text-medium-emphasis">Memory</div>{{ system.memoryMb }} MB · Node {{ system.node }}</v-col>
			</v-row>
			<v-divider class="my-3"/>
			<div class="d-flex flex-wrap ga-2">
				<v-chip size="small" :color="system.features.mail ? 'success' : undefined" variant="tonal" prepend-icon="mdi-email-outline">Email {{ system.features.mail ? "on" : "off" }}</v-chip>
				<v-chip size="small" :color="system.features.sso ? 'success' : undefined" variant="tonal" prepend-icon="mdi-account-key-outline">SSO {{ system.features.sso ? "on" : "off" }}</v-chip>
				<v-chip size="small" :color="system.features.registration ? 'success' : 'warning'" variant="tonal" prepend-icon="mdi-account-plus-outline">Registration {{ system.features.registration ? "open" : "closed" }}</v-chip>
				<v-chip v-if="system.features.approvalRequired" size="small" color="info" variant="tonal" prepend-icon="mdi-check-decagram-outline">Approval required</v-chip>
				<v-chip v-if="system.bootstrap.demoMode" size="small" color="warning" variant="tonal">Demo mode</v-chip>
				<v-chip v-if="system.bootstrap.debugLogging" size="small" color="warning" variant="tonal" prepend-icon="mdi-bug-outline">Debug logging on</v-chip>
				<v-chip v-if="!system.bootstrap.encryptionKeySeparate" size="small" color="warning" variant="tonal" prepend-icon="mdi-key-alert-outline">No separate SETTINGS_ENCRYPTION_KEY</v-chip>
			</div>
		</v-card>
	</div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import type {IChartsData, IOverview, ISystemInfo} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {bytes, duration, num} from "@/utils/format";
import ChartPanel from "@/components/ChartPanel.vue";
import PageHeader from "@/components/PageHeader.vue";
import StatCard from "@/components/StatCard.vue";

const overview = ref<IOverview | null>(null);
const charts = ref<IChartsData | null>(null);
const days = ref(30);
const periods = [{label: "7 days", value: 7}, {label: "30 days", value: 30}, {label: "90 days", value: 90}];
const eventNames: Record<string, string> = {rate_limited: "Rate limited", login_failed: "Failed sign-in", login_locked: "Account locked", admin_login_failed: "Failed admin sign-in", blocked_ip_hit: "Blocked address"};
const system = ref<ISystemInfo | null>(null);
const loading = ref(false);
const counts = computed(() => overview.value?.counts ?? null);

/** "2026-11-27" -> "27 Nov" in the local language. */
const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {day: "numeric", month: "short"});

async function loadCharts() {
	charts.value = await api.overviewCharts(days.value);
}

async function load() {
	loading.value = true;
	try {
		[overview.value, system.value, charts.value] = await Promise.all([api.overview(), api.system(), api.overviewCharts(days.value)]);
	} finally {
		loading.value = false;
	}
}

onMounted(load);
</script>

<style scoped>
.vault-link {
	color: inherit;
	font-weight: 500;
	text-decoration: none;
}

.vault-link:hover {
	text-decoration: underline;
}
</style>
