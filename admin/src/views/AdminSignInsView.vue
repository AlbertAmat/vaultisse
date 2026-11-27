<template>
	<!--
	  Admin sign-ins (route /admin-signins, menu: Security & compliance > Admin sign-ins)

	  Who tried to sign in to THIS console, from where, and whether it worked. For spotting an attack on the console:
	  a burst of failures from one address, one address trying many emails, a country nobody signs in from.
	  Example of what it shows: "95.173.136.70 · Russia · 5 failed · 3 refused by the limiter · 2 emails tried -> Block".

	  Data:   GET /api/admin/admin-signins?days=1|7|30|90       the summary, the timeline and one row per address
	          GET /api/admin/admin-signins/attempts?result=&ip=  the individual attempts
	  Source: the audit trail (auth.login / auth.login_failed) and the attempts the login rate limiter refused.
	  Places: an offline IP database on this server (no address is sent to anyone); "unknown" for private addresses.
	  Rights: every admin can read it; only a superadmin can block an address (from here or under Security).
	-->
	<div class="page">
		<page-header title="Admin sign-ins" subtitle="Who tried to sign in to this console, from where, and whether it worked. Failed attempts from one address, or one address trying many emails, are how an attack looks.">
			<v-select v-model="days" :items="periods" density="compact" style="width: 170px" hide-details @update:model-value="load"/>
			<v-btn icon="mdi-refresh" variant="text" aria-label="Reload" :loading="loading" @click="load"/>
		</page-header>

		<!-- Plain words for the worst case: addresses with five or more failures that are not blocked yet. -->
		<v-alert v-if="attackers.length" type="error" variant="tonal" class="mb-4" icon="mdi-shield-alert-outline">
			<strong>{{ attackers.length }} {{ attackers.length === 1 ? "address" : "addresses" }}</strong> made five or more failed attempts and {{ attackers.length === 1 ? "isn't" : "aren't" }} blocked:
			{{ attackers.slice(0, 3).map((s) => `${s.ip} (${placeName(s)}, ${s.failed})`).join(" · ") }}<template v-if="attackers.length > 3"> …</template>
		</v-alert>

		<!-- The four numbers. Red when something is wrong. -->
		<v-row v-if="data" class="mb-1">
			<v-col cols="6" md="3"><stat-card label="Successful sign-ins" :value="data.summary.ok" icon="mdi-login" color="success"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Failed attempts" :value="data.summary.failed" icon="mdi-shield-alert-outline" :color="data.summary.failed > 0 ? 'error' : undefined" :hint="`from ${data.summary.failedIps} ${data.summary.failedIps === 1 ? 'address' : 'addresses'}`"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Refused by the limiter" :value="data.summary.limited" icon="mdi-speedometer" :color="data.summary.limited > 0 ? 'warning' : undefined" hint="Too many tries too fast"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Countries" :value="data.summary.countries" icon="mdi-earth" color="info"/></v-col>
		</v-row>

		<!-- Timeline: green = successful, red = failed (per hour for the last 24 hours, otherwise per day). -->
		<v-card v-if="data" class="pa-4 mt-2">
			<div class="text-subtitle-1 font-weight-medium mb-2">Attempts over time</div>
			<chart-panel stacked :labels="data.timeline.map((b) => label(b.bucket))" :series="[{label: 'Successful', data: data.timeline.map((b) => b.ok), color: 'success'}, {label: 'Failed', data: data.timeline.map((b) => b.failed), color: 'error'}]"/>
		</v-card>

		<!-- Where it comes from: one row per address, the most failures first. Click a row to see its attempts below. -->
		<v-card class="mt-4">
			<div class="d-flex align-center pa-4 pb-0">
				<div class="text-subtitle-1 font-weight-medium">Addresses</div>
				<v-spacer/>
				<span class="text-caption text-medium-emphasis">Click a row to see its attempts</span>
			</div>
			<div class="table-wrap">
				<v-table density="comfortable" hover>
					<thead><tr><th>Address</th><th>Place</th><th class="text-right">Failed</th><th class="text-right">Successful</th><th class="text-right">Refused</th><th class="text-right">Emails tried</th><th>Failed at</th><th>Last attempt</th><th>State</th><th></th></tr></thead>
					<tbody>
						<tr v-for="s in data?.sources ?? []" :key="s.ip" class="row-click" :class="{hot: s.failed >= 5 && !s.blocked, picked: ip === s.ip}" @click="pick(s.ip)">
							<td class="text-no-wrap mono">{{ s.ip }}</td>
							<td class="text-no-wrap">{{ flag(s.country) }} {{ placeName(s) }}</td>
							<td class="text-right text-no-wrap" :class="{'text-error font-weight-bold': s.failed >= 3}">{{ s.failed || "—" }}</td>
							<td class="text-right text-no-wrap">{{ s.ok || "—" }}</td>
							<td class="text-right text-no-wrap" :class="{'text-warning': s.limited > 0}">{{ s.limited || "—" }}</td>
							<td class="text-right text-no-wrap" :class="{'text-warning': s.emails >= 3}">{{ s.emails || "—" }}</td>
							<td class="text-no-wrap text-medium-emphasis">{{ s.stages.join(", ") || "—" }}</td>
							<td class="text-no-wrap">{{ s.failed || s.ok ? relative(s.lastSeen) : "—" }}</td>
							<td class="text-no-wrap">
								<v-chip v-if="s.blocked" size="x-small" variant="tonal" color="error">blocked</v-chip>
								<v-chip v-else-if="s.suspicious" size="x-small" variant="tonal" color="warning">suspicious</v-chip>
								<v-chip v-else size="x-small" variant="tonal" color="success">normal</v-chip>
							</td>
							<td class="text-right text-no-wrap" @click.stop>
								<v-btn v-if="canWrite() && !s.blocked && s.failed + s.limited > 0" size="small" variant="tonal" color="error" prepend-icon="mdi-cancel" @click="blocking = s">Block</v-btn>
							</td>
						</tr>
						<tr v-if="!data?.sources.length"><td colspan="10" class="text-center text-medium-emphasis pa-6">{{ loading ? "Loading…" : "Nobody tried to sign in during this period." }}</td></tr>
					</tbody>
				</v-table>
			</div>
			<!-- Countries at a glance: the biggest failure counts first. -->
			<div v-if="data?.countries.length" class="d-flex flex-wrap ga-2 pa-4 pt-2">
				<v-chip v-for="c in data.countries.slice(0, 8)" :key="c.country" size="small" variant="tonal" :color="c.failed > 0 ? 'error' : 'success'">{{ flag(c.country) }} {{ countryName(c.country) }}: {{ c.failed }} failed, {{ c.ok }} ok</v-chip>
			</div>
		</v-card>

		<!-- Every attempt, newest first. Filter by result or by one address. -->
		<v-card class="mt-4">
			<div class="d-flex flex-wrap align-center ga-3 pa-4 pb-0">
				<div class="text-subtitle-1 font-weight-medium">Attempts</div>
				<v-select v-model="result" :items="results" clearable placeholder="Any result" density="compact" style="max-width: 190px" hide-details @update:model-value="reloadAttempts"/>
				<v-chip v-if="ip" closable variant="tonal" color="primary" @click:close="pick(null)">{{ ip }}</v-chip>
			</div>
			<div class="table-wrap">
				<v-table density="compact">
					<thead><tr><th>When</th><th>Result</th><th>Email typed</th><th>Address</th><th>Place</th><th>Failed at</th></tr></thead>
					<tbody>
						<tr v-for="a in attempts" :key="a.id">
							<td class="text-no-wrap">{{ dateTime(a.at) }}</td>
							<td class="text-no-wrap"><v-chip size="x-small" variant="tonal" :color="a.result === 'ok' ? 'success' : 'error'">{{ a.result === "ok" ? "signed in" : "failed" }}</v-chip></td>
							<td class="text-no-wrap">{{ a.email ?? "—" }}</td>
							<td class="text-no-wrap mono">{{ a.ip ?? "—" }}</td>
							<td class="text-no-wrap">{{ flag(a.country) }} {{ placeName(a) }}</td>
							<td class="text-no-wrap text-medium-emphasis">{{ a.stage ?? "—" }}</td>
						</tr>
						<tr v-if="!attempts.length"><td colspan="6" class="text-center text-medium-emphasis pa-6">Nothing to show.</td></tr>
					</tbody>
				</v-table>
			</div>
			<pager :page="page" :page-size="25" :total="total" @update:page="page = $event; loadAttempts()"/>
		</v-card>
		<p class="text-caption text-medium-emphasis mt-3">
			"Email typed" is what was entered in the sign-in form, so it can be a wrong guess, a typo or someone else's address. "Refused" counts attempts the login rate limiter stopped before checking them.
			The console also emails the admins when failed attempts pile up (Notifications > Security), and the same events are in the Audit trail. How long this history is kept is set under Data retention.
		</p>

		<!-- Block an address (24 hours), with the evidence in front of the admin. -->
		<v-dialog :model-value="!!blocking" max-width="460" @update:model-value="blocking = null">
			<v-card v-if="blocking" class="pa-2">
				<v-card-title class="d-flex align-center ga-2"><v-icon color="error">mdi-cancel</v-icon>Block {{ blocking.ip }}?</v-card-title>
				<v-card-text>
					<p class="text-body-2 mb-2">{{ flag(blocking.country) }} {{ placeName(blocking) }}: {{ blocking.failed }} failed attempts<template v-if="blocking.limited">, {{ blocking.limited }} refused by the limiter</template><template v-if="blocking.emails > 1">, {{ blocking.emails }} different emails tried</template>.</p>
					<p class="text-body-2 text-medium-emphasis">It will be refused by the whole app, not just the console, for 24 hours. You can unblock it earlier under Security > Blocked addresses.</p>
					<p v-if="blocking.ok > 0" class="text-body-2 text-warning mt-2">Somebody also signed in successfully from this address. Make sure it isn't you or a colleague.</p>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="blocking = null">Cancel</v-btn><v-btn color="error" variant="flat" :loading="working" @click="block">Block for 24 hours</v-btn></v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
/**
 * State: `data` is the summary/timeline/addresses of the chosen period; `attempts` is the page of individual attempts, optionally for one
 * address (`ip`, set by clicking a row) and one result (`result`). Both reload when the period changes.
 */
import {computed, onMounted, ref} from "vue";
import type {IAdminSignInAttempt, IAdminSignInSource, IAdminSignIns} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateTime, relative} from "@/utils/format";
import ChartPanel from "@/components/ChartPanel.vue";
import PageHeader from "@/components/PageHeader.vue";
import Pager from "@/components/Pager.vue";
import StatCard from "@/components/StatCard.vue";

const periods = [{title: "Last 24 hours", value: 1}, {title: "Last 7 days", value: 7}, {title: "Last 30 days", value: 30}, {title: "Last 90 days", value: 90}];
const results = [{title: "Failed", value: "failed"}, {title: "Signed in", value: "ok"}];
const days = ref(7);
const data = ref<IAdminSignIns | null>(null);
const attempts = ref<IAdminSignInAttempt[]>([]);
const total = ref(0);
const page = ref(1);
const result = ref<"ok" | "failed" | null>(null);
const ip = ref<string | null>(null);
const loading = ref(false);
const blocking = ref<IAdminSignInSource | null>(null);
const working = ref(false);

/** Addresses with five or more failures that nobody has blocked yet: the ones to act on. */
const attackers = computed(() => (data.value?.sources ?? []).filter((s) => s.failed >= 5 && !s.blocked));

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], {type: "region"}) : null;

/** "RU" -> "Russia". */
function countryName(code: string): string {
	try {
		return regionNames?.of(code) ?? code;
	} catch {
		return code;
	}
}

/** "RU" -> the flag emoji (two regional-indicator letters); empty for no country. */
function flag(code: string | null): string {
	return code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
}

/** "Chita, Russia", "Russia", or "Private or unknown". */
function placeName(item: {country: string | null; city: string}): string {
	return item.country ? [item.city, countryName(item.country)].filter(Boolean).join(", ") : "Private or unknown";
}

/** "2026-11-27T14:00:00" -> "14:00" for an hourly timeline, "27 Nov" for a daily one. */
function label(bucket: string): string {
	const date = new Date(bucket);
	return data.value?.unit === "hour" ? date.toLocaleTimeString(undefined, {hour: "2-digit", minute: "2-digit"}) : date.toLocaleDateString(undefined, {day: "numeric", month: "short"});
}

async function loadAttempts() {
	const found = await api.adminSignIns.attempts({days: days.value, result: result.value ?? undefined, ip: ip.value ?? undefined, page: page.value, pageSize: 25});
	attempts.value = found.items;
	total.value = found.total;
}

function reloadAttempts() {
	page.value = 1;
	return loadAttempts();
}

/** Shows only the attempts of one address (null = all). */
function pick(address: string | null) {
	ip.value = ip.value === address ? null : address;
	void reloadAttempts();
}

async function load() {
	loading.value = true;
	try {
		data.value = await api.adminSignIns.overview(days.value);
		await reloadAttempts();
	} finally {
		loading.value = false;
	}
}

async function block() {
	working.value = true;
	try {
		await api.security.blockIp(blocking.value!.ip, "Failed admin sign-ins", 24);
		notify(`${blocking.value!.ip} is blocked for 24 hours.`);
		blocking.value = null;
		await load();
	} finally {
		working.value = false;
	}
}

onMounted(load);
</script>

<style scoped>
.hot {
	background: rgba(var(--v-theme-error), 0.07);
}

tr.picked {
	outline: 2px solid rgba(var(--v-theme-primary), 0.6);
	outline-offset: -2px;
}
</style>
