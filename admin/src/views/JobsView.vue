<template>
	<!--
	  Jobs (route /jobs, menu: Platform > Jobs)

	  What runs in the background and how it went: clean-ups, reminders, deletions, health checks. Each run is recorded, so a
	  failure shows up here (and on the Overview, and by email) instead of only in the server log.
	  Data:   GET /jobs (every job with its last run), POST /jobs/:id/run (run now), GET /jobs/:id/history (last 30 runs)
	  Run now: jobs that change or delete data (warning triangle) ask for a fresh verification first.
	  Refreshes itself every 15 seconds, so a running job turns into its result without reloading.
	-->
	<div class="page">
		<page-header title="Jobs" subtitle="What runs in the background: clean-ups, reminders, deletions and checks. Each run is recorded here, so a failure shows up in the console instead of only in the server log.">
			<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" :loading="loading" @click="load"/>
		</page-header>

		<!-- Lists the jobs whose last run failed. -->
		<v-alert v-if="failing.length" type="error" variant="tonal" class="mb-4" icon="mdi-alert-circle-outline">
			{{ failing.length === 1 ? "A job" : `${failing.length} jobs` }} failed on the last run: {{ failing.map((j) => j.name).join(", ") }}.
		</v-alert>

		<!-- One row per job, most frequent first. The result is cut to one line; hover for all of it. "Next run" is an estimate. -->
		<v-card>
			<div class="table-wrap">
				<v-table>
					<thead><tr><th>Job</th><th>Runs</th><th>Last run</th><th>Status</th><th>Result</th><th>Next run</th><th></th></tr></thead>
					<tbody>
						<tr v-for="job in items" :key="job.id">
							<td class="text-no-wrap font-weight-medium">
								{{ job.name }}
								<v-icon size="16" class="ml-1 text-medium-emphasis" aria-label="What it does">mdi-information-outline<v-tooltip activator="parent" location="top" max-width="320">{{ job.description }}</v-tooltip></v-icon>
								<v-icon v-if="job.dangerous" size="16" class="ml-1" color="warning">mdi-alert-outline<v-tooltip activator="parent" location="top">Changes or deletes data. Running it by hand asks you to verify again.</v-tooltip></v-icon>
							</td>
							<td class="text-no-wrap">{{ job.schedule }}</td>
							<td class="text-no-wrap">
								<template v-if="job.lastRun">{{ relative(job.lastRun.startedAt) }}<v-tooltip activator="parent" location="top">{{ dateTime(job.lastRun.startedAt) }} · took {{ duration(job.lastRun.durationMs) }}{{ job.lastRun.trigger === "manual" ? ` · started by ${job.lastRun.runBy ?? "an admin"}` : " · scheduled" }}</v-tooltip></template>
								<span v-else class="text-medium-emphasis">not yet</span>
							</td>
							<td class="text-no-wrap">
								<v-progress-circular v-if="job.running" indeterminate size="16" width="2" color="primary" class="mr-2"/>
								<v-chip v-if="job.running" size="x-small" variant="tonal" color="primary">running</v-chip>
								<v-chip v-else-if="job.lastRun" size="x-small" variant="tonal" :color="job.lastRun.status === 'ok' ? 'success' : 'error'">{{ job.lastRun.status === "ok" ? "ok" : "failed" }}</v-chip>
								<span v-else class="text-medium-emphasis">—</span>
								<v-chip v-if="job.recentFailures > 0 && job.lastRun?.status === 'ok'" size="x-small" variant="text" color="warning" class="ml-1">{{ job.recentFailures }} failed lately</v-chip>
							</td>
							<td class="result" :class="{'text-error': job.lastRun?.status === 'failed'}">
								<span v-if="job.lastRun?.message" class="d-inline-block text-truncate result-text">{{ job.lastRun.message }}<v-tooltip activator="parent" location="top" max-width="420">{{ job.lastRun.message }}</v-tooltip></span>
								<span v-else class="text-medium-emphasis">—</span>
							</td>
							<td class="text-no-wrap text-medium-emphasis">{{ job.nextRunAt ? `≈ ${relative(job.nextRunAt)}` : "—" }}</td>
							<td class="text-right text-no-wrap">
								<v-btn v-if="canWrite()" size="small" variant="tonal" prepend-icon="mdi-play-outline" :loading="running === job.id" :disabled="job.running" @click="run(job)">Run now</v-btn>
								<v-btn size="small" variant="text" icon="mdi-history" aria-label="History" @click="showHistory(job)"/>
							</td>
						</tr>
					</tbody>
				</v-table>
			</div>
		</v-card>
		<p class="text-caption text-medium-emphasis mt-3">
			Times in "Next run" are estimates: a run starts at the planned time, or a little later when the server was busy or just started. A failing job also emails the admins (Notifications > A background job failed), at most every six hours.
		</p>

		<!-- The last 30 runs of one job: when, who started it ("schedule" or an admin), status, how long, result. -->
		<v-dialog v-model="historyOpen" max-width="760" scrollable>
			<v-card v-if="viewing">
				<v-card-title>{{ viewing.name }}: last runs</v-card-title>
				<v-card-text>
					<v-table density="compact">
						<thead><tr><th>When</th><th>Started by</th><th>Status</th><th>Took</th><th>Result</th></tr></thead>
						<tbody>
							<tr v-for="r in history" :key="r.id">
								<td class="text-no-wrap">{{ dateTime(r.startedAt) }}</td>
								<td class="text-no-wrap">{{ r.trigger === "manual" ? (r.runBy ?? "an admin") : "schedule" }}</td>
								<td class="text-no-wrap"><v-chip size="x-small" variant="tonal" :color="r.status === 'ok' ? 'success' : 'error'">{{ r.status === "ok" ? "ok" : "failed" }}</v-chip></td>
								<td class="text-no-wrap">{{ duration(r.durationMs) }}</td>
								<td :class="{'text-error': r.status === 'failed'}">{{ r.message ?? "—" }}</td>
							</tr>
							<tr v-if="!history.length"><td colspan="5" class="text-center text-medium-emphasis pa-4">It hasn't run yet.</td></tr>
						</tbody>
					</v-table>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="historyOpen = false">Close</v-btn></v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from "vue";
import type {IJob, IJobRun} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateTime, relative} from "@/utils/format";
import PageHeader from "@/components/PageHeader.vue";

const items = ref<IJob[]>([]);
const loading = ref(false);
const running = ref<string | null>(null);
const failing = computed(() => items.value.filter((j) => j.lastRun?.status === "failed"));
const historyOpen = ref(false);
const viewing = ref<IJob | null>(null);
const history = ref<IJobRun[]>([]);
let timer: ReturnType<typeof setInterval> | undefined;

/** "850 ms", "4.2 s", "2 min 5 s". */
function duration(ms: number): string {
	if (ms < 1000) return `${ms} ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
	return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}

async function load() {
	loading.value = true;
	try {
		items.value = await api.jobs.list();
	} finally {
		loading.value = false;
	}
}

async function run(job: IJob) {
	running.value = job.id;
	try {
		const result = await api.jobs.run(job.id);
		notify(result.status === "ok" ? `${job.name}: ${result.message ?? "done"}` : `${job.name} failed: ${result.message}`, result.status === "ok" ? "success" : "error");
		await load();
	} finally {
		running.value = null;
	}
}

async function showHistory(job: IJob) {
	viewing.value = job;
	history.value = await api.jobs.history(job.id);
	historyOpen.value = true;
}

onMounted(() => {
	void load();
	timer = setInterval(() => void load(), 15000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<style scoped>
.result {
	max-width: 260px;
}

.result-text {
	max-width: 250px;
	vertical-align: bottom;
}
</style>
