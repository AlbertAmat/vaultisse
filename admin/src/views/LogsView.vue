<template>
	<div class="page">
		<page-header title="Logs" subtitle="Sign-in activity of the accounts, and the server's own log. Both can contain names and addresses."/>

		<v-card>
			<v-tabs v-model="tab" color="primary">
				<v-tab value="activity">Sign-ins</v-tab>
				<v-tab value="server">Server log</v-tab>
			</v-tabs>
			<v-divider/>

			<v-tabs-window v-model="tab">
				<v-tabs-window-item value="activity">
					<div class="d-flex flex-wrap ga-3 pa-4">
						<v-select v-model="action" :items="actions" clearable placeholder="Any event" style="max-width: 240px" @update:model-value="loadActivity(true)"/>
						<v-text-field v-model="ip" placeholder="Filter by address" clearable style="max-width: 240px" @update:model-value="debounced"/>
						<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="loadActivity(false)"/>
					</div>
					<div class="table-wrap">
						<v-table density="compact">
							<thead><tr><th>When</th><th>Event</th><th>Account</th><th>Address</th><th>Detail</th></tr></thead>
							<tbody>
								<tr v-for="entry in activity" :key="entry.id">
									<td class="text-no-wrap">{{ dateTime(entry.createdDate) }}</td>
									<td><v-chip size="x-small" variant="tonal" :color="entry.action === 'login_failed' ? 'error' : entry.action === 'login' ? 'success' : undefined">{{ entry.action.replace("_", " ") }}</v-chip></td>
									<td>{{ entry.actorCode ?? (entry.metadata.attemptedUsername ? `“${entry.metadata.attemptedUsername}” (no such account)` : "—") }}</td>
									<td class="mono">{{ entry.metadata.ip ?? "—" }}</td>
									<td class="text-caption text-medium-emphasis">{{ detail(entry.metadata) }}</td>
								</tr>
								<tr v-if="!activity.length"><td colspan="5" class="text-center text-medium-emphasis pa-6">Nothing recorded.</td></tr>
							</tbody>
						</v-table>
					</div>
					<pager :page="page" :page-size="25" :total="total" @update:page="page = $event; loadActivity(false)"/>
				</v-tabs-window-item>

				<v-tabs-window-item value="server">
					<div class="d-flex flex-wrap ga-3 pa-4">
						<v-select v-model="level" :items="levels" clearable placeholder="All levels" style="max-width: 180px" @update:model-value="loadLog"/>
						<v-text-field v-model="query" prepend-inner-icon="mdi-magnify" placeholder="Search the log" clearable style="max-width: 320px" @update:model-value="debouncedLog"/>
						<v-select v-model="lines" :items="[100, 200, 500, 1000]" style="max-width: 130px" @update:model-value="loadLog"/>
						<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="loadLog"/>
					</div>
					<pre ref="logBox" class="log mono">{{ log.length ? log.join("\n") : "Nothing matches." }}</pre>
					<p class="text-caption text-medium-emphasis pa-4">The end of the log file, newest last.</p>
				</v-tabs-window-item>
			</v-tabs-window>
		</v-card>
	</div>
</template>

<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from "vue";
import type {IActivityEntry} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {dateTime} from "@/utils/format";
import PageHeader from "@/components/PageHeader.vue";
import Pager from "@/components/Pager.vue";

const tab = ref("activity");
const activity = ref<IActivityEntry[]>([]);
const total = ref(0);
const page = ref(1);
const action = ref<string | null>(null);
const ip = ref("");
const log = ref<string[]>([]);
const level = ref<string | null>(null);
const query = ref("");
const lines = ref(200);
const logBox = ref<HTMLElement | null>(null);

const actions = ["login", "login_failed", "logout", "password_changed"];
const levels = [{title: "Errors", value: "error"}, {title: "Warnings", value: "warn"}, {title: "Info", value: "info"}];

const detail = (metadata: Record<string, unknown>) =>
	Object.entries(metadata).filter(([key]) => key !== "ip" && key !== "attemptedUsername").map(([key, value]) => `${key}: ${value}`).join(" · ");

async function loadActivity(reset: boolean) {
	if (reset) {
		page.value = 1;
	}
	const result = await api.logs.activity({action: action.value ?? undefined, ip: ip.value ?? "", page: page.value});
	activity.value = result.items;
	total.value = result.total;
}

async function loadLog() {
	const result = await api.logs.server({lines: lines.value, level: level.value ?? undefined, q: query.value ?? ""});
	log.value = result.lines;
	await nextTick();
	if (logBox.value) {
		logBox.value.scrollTop = logBox.value.scrollHeight;
	}
}

let timer: ReturnType<typeof setTimeout> | undefined;
const debounced = () => {
	clearTimeout(timer);
	timer = setTimeout(() => loadActivity(true), 300);
};
const debouncedLog = () => {
	clearTimeout(timer);
	timer = setTimeout(loadLog, 300);
};

watch(tab, (value) => (value === "server" ? loadLog() : loadActivity(false)));
onMounted(() => loadActivity(false));
</script>

<style scoped>
.log {
	margin: 0 16px;
	padding: 12px;
	max-height: 60vh;
	overflow: auto;
	white-space: pre-wrap;
	word-break: break-word;
	font-size: 0.78rem;
	line-height: 1.5;
	border-radius: 8px;
	background: rgba(var(--v-theme-on-surface), 0.06);
}
</style>
