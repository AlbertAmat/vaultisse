<template>
	<div class="page">
		<page-header title="Overview" subtitle="The state of this installation at a glance. Only metadata is shown, never what is inside a library.">
			<v-btn variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="load">Refresh</v-btn>
		</page-header>

		<v-alert v-if="counts && counts.usersPending > 0" type="info" variant="tonal" class="mb-4" icon="mdi-account-clock-outline">
			{{ counts.usersPending }} new {{ counts.usersPending === 1 ? "account is" : "accounts are" }} waiting for approval.
			<template #append><v-btn variant="text" to="/users?status=pending">Review</v-btn></template>
		</v-alert>
		<v-alert v-if="system && system.database !== 'ok'" type="error" variant="tonal" class="mb-4">The database is not reachable.</v-alert>

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

		<v-row v-if="overview">
			<v-col cols="12" md="6">
				<v-card class="pa-4">
					<div class="text-subtitle-1 font-weight-medium mb-2">New accounts, last 30 days</div>
					<chart-panel :labels="overview.signups.map((p) => shortDay(p.day))" :series="[{label: 'Sign-ups', data: overview.signups.map((p) => p.count), color: 'primary'}]"/>
				</v-card>
			</v-col>
			<v-col cols="12" md="6">
				<v-card class="pa-4">
					<div class="text-subtitle-1 font-weight-medium mb-2">Sign-ins, last 14 days</div>
					<chart-panel type="line" :labels="overview.logins.map((p) => shortDay(p.day))" :series="[{label: 'Sign-ins', data: overview.logins.map((p) => p.count), color: 'secondary'}]"/>
				</v-card>
			</v-col>
		</v-row>

		<v-card v-if="system" class="pa-4 mt-4">
			<div class="text-subtitle-1 font-weight-medium mb-3">System</div>
			<v-row dense>
				<v-col cols="6" md="3"><div class="text-caption text-medium-emphasis">Version</div><div class="mono">{{ system.version }}</div></v-col>
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
import type {IOverview, ISystemInfo} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {bytes, duration, num} from "@/utils/format";
import ChartPanel from "@/components/ChartPanel.vue";
import PageHeader from "@/components/PageHeader.vue";
import StatCard from "@/components/StatCard.vue";

const overview = ref<IOverview | null>(null);
const system = ref<ISystemInfo | null>(null);
const loading = ref(false);
const counts = computed(() => overview.value?.counts ?? null);

/** "2026-11-27" -> "27 Nov" in the local language. */
const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {day: "numeric", month: "short"});

async function load() {
	loading.value = true;
	try {
		[overview.value, system.value] = await Promise.all([api.overview(), api.system()]);
	} finally {
		loading.value = false;
	}
}

onMounted(load);
</script>
