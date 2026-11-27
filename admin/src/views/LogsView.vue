<template>
	<!--
	  Logs (route /logs, menu: Security & compliance)

	  Three tabs.
	    Sign-ins       the activity log of the users (GET /logs/activity?action=&ip=): who signed in from which address
	    Emails sent    every email the app sent: recipient, subject, delivered or failed (never the text) (GET /logs/mail)
	    Server log     the tail of the server's log file (GET /logs/server?lines=200&level=error&q=...)
	  The server log can contain names and addresses: it is admin-only. How long each log is kept is set under Data retention.
	-->
	<div class="page">
		<page-header title="Logs" subtitle="Sign-in activity, the emails sent to users, and the server's own log. They can contain names and addresses."/>

		<v-card>
			<v-tabs v-model="tab" color="primary">
				<v-tab value="activity">Sign-ins</v-tab>
				<v-tab value="mail">Emails sent</v-tab>
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

				<v-tabs-window-item value="mail">
					<div class="d-flex flex-wrap ga-3 pa-4">
						<v-select v-model="mailStatus" :items="[{title: 'Delivered', value: 'sent'}, {title: 'Failed', value: 'failed'}]" clearable placeholder="Any result" style="max-width: 200px" @update:model-value="loadMail(true)"/>
						<v-text-field v-model="mailQuery" prepend-inner-icon="mdi-magnify" placeholder="Search recipient or subject" clearable style="max-width: 340px" @update:model-value="debouncedMail"/>
						<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="loadMail(false)"/>
					</div>
					<div class="table-wrap">
						<v-table density="compact">
							<thead><tr><th>When</th><th>To</th><th>Subject</th><th>Result</th></tr></thead>
							<tbody>
								<tr v-for="mail in mails" :key="mail.id">
									<td class="text-no-wrap">{{ dateTime(mail.createdDate) }}</td>
									<td>{{ mail.toAddress }}</td>
									<td>{{ mail.subject }}</td>
									<td>
										<v-chip size="x-small" variant="tonal" :color="mail.status === 'sent' ? 'success' : 'error'">{{ mail.status === "sent" ? "Delivered to the mail server" : "Failed" }}</v-chip>
										<div v-if="mail.error" class="text-caption text-error mt-1" style="max-width: 360px">{{ mail.error }}</div>
									</td>
								</tr>
								<tr v-if="!mails.length"><td colspan="4" class="text-center text-medium-emphasis pa-6">No emails sent yet.</td></tr>
							</tbody>
						</v-table>
					</div>
					<pager :page="mailPage" :page-size="25" :total="mailTotal" @update:page="mailPage = $event; loadMail(false)"/>
					<p class="text-caption text-medium-emphasis px-4 pb-4">Verification links, account approvals, deletion warnings and vault requests. Only the recipient, subject and outcome are kept (90 days), never the message. "Delivered" means the mail server accepted it, not that it reached the inbox.</p>
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
import type {IActivityEntry, IMailEntry} from "@vaultisse/types/admin/IAdmin";
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
const mails = ref<IMailEntry[]>([]);
const mailTotal = ref(0);
const mailPage = ref(1);
const mailStatus = ref<string | null>(null);
const mailQuery = ref("");
const log = ref<string[]>([]);
const level = ref<string | null>(null);
const query = ref("");
const lines = ref(200);
const logBox = ref<HTMLElement | null>(null);

const actions = ["login", "login_failed", "logout", "password_changed"];
const levels = [{title: "Errors", value: "error"}, {title: "Warnings", value: "warn"}, {title: "Info", value: "info"}];

/** One-line summary of an activity entry's metadata. Example: {ip: "203.0.113.4"} -> "203.0.113.4". */
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

async function loadMail(reset: boolean) {
	if (reset) {
		mailPage.value = 1;
	}
	const result = await api.logs.mail({status: mailStatus.value ?? undefined, q: mailQuery.value ?? "", page: mailPage.value});
	mails.value = result.items;
	mailTotal.value = result.total;
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
const debouncedMail = () => {
	clearTimeout(timer);
	timer = setTimeout(() => loadMail(true), 300);
};
const debouncedLog = () => {
	clearTimeout(timer);
	timer = setTimeout(loadLog, 300);
};

watch(tab, (value) => (value === "server" ? loadLog() : value === "mail" ? loadMail(false) : loadActivity(false)));
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
