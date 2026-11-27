<template>
	<!--
	  Email users (route /broadcast, menu: Communication)

	  Write to the people who use the app. Nothing is sent before you have seen WHO gets it (exact count + masked examples) and
	  WHAT they get (the email with {name} filled in). Sending needs a fresh verification and the count you previewed: if the
	  audience changed meanwhile the server answers 409 and the preview is refreshed.
	  Data:   GET /broadcast/audiences, POST /broadcast/preview, POST /broadcast/test, POST /broadcast, GET /broadcast/:id (progress)
	  Audiences: everyone | vault admins | active in the last 30 days | without two-factor. Only enabled accounts with a verified email.
	-->
	<div class="page">
		<page-header title="Email users" subtitle="Write to the people who use the app: a closure, new terms, a change. Preview exactly who gets it before anything is sent."/>

		<v-alert v-if="audiences && !audiences.mailEnabled" type="warning" variant="tonal" class="mb-4" icon="mdi-email-off-outline">
			Email isn't set up, so nothing can be sent.
			<template #append><v-btn variant="text" to="/settings">Set up email</v-btn></template>
		</v-alert>

		<!-- A broadcast that is being sent -->
		<v-card v-if="running" class="pa-5 mb-4" border="primary md">
			<div class="d-flex flex-wrap align-center ga-3 mb-2">
				<v-progress-circular v-if="running.status === 'sending'" indeterminate size="22" width="3" color="primary"/>
				<div class="text-subtitle-1 font-weight-medium">{{ running.status === "sending" ? "Sending…" : statusText[running.status] }}: {{ running.subject }}</div>
				<v-spacer/>
				<v-btn v-if="running.status === 'sending' && canWrite()" size="small" variant="tonal" color="error" @click="cancel(running.id)">Stop</v-btn>
				<v-btn v-else size="small" variant="text" @click="running = null">Close</v-btn>
			</div>
			<v-progress-linear :model-value="(100 * (running.sent + running.failed)) / running.recipients" :color="running.failed ? 'warning' : 'primary'" height="8" rounded/>
			<div class="text-body-2 mt-2">{{ running.sent }} sent<template v-if="running.failed"> · <span class="text-error">{{ running.failed }} failed</span></template> of {{ running.recipients }}</div>
		</v-card>

		<v-row>
			<v-col cols="12" md="7">
				<v-card class="pa-5">
					<div class="text-subtitle-1 font-weight-medium mb-3">Message</div>
					<v-select v-model="audience" :items="audienceItems" label="Send to" class="mb-3" :disabled="!canWrite()" @update:model-value="preview = null"/>
					<v-text-field v-model="subject" label="Subject" counter="200" maxlength="200" class="mb-3" :disabled="!canWrite()" @update:model-value="preview = null"/>
					<v-textarea v-model="body" label="Message" rows="8" auto-grow counter="10000" maxlength="10000" :disabled="!canWrite()" hint="Plain text. Write {name} to greet each person by name." persistent-hint @update:model-value="preview = null"/>
					<div class="d-flex flex-wrap ga-2 mt-4">
						<v-btn color="primary" variant="flat" prepend-icon="mdi-eye-outline" :loading="previewing" :disabled="!ready" @click="runPreview">Preview</v-btn>
						<v-btn variant="tonal" prepend-icon="mdi-email-fast-outline" :loading="testing" :disabled="!ready || !audiences?.mailEnabled || !canWrite()" @click="sendTest">Send a test to me</v-btn>
					</div>
				</v-card>
			</v-col>

			<v-col cols="12" md="5">
				<v-card class="pa-5 h-100">
					<div class="text-subtitle-1 font-weight-medium mb-3">Preview</div>
					<p v-if="!preview" class="text-body-2 text-medium-emphasis">Write your message and press Preview to see the exact number of people and the email as they will receive it.</p>
					<template v-else>
						<div class="d-flex align-center ga-3 mb-3">
							<div class="count">{{ preview.count }}</div>
							<div class="text-body-2 text-medium-emphasis">{{ preview.count === 1 ? "person receives" : "people receive" }} this<br>({{ audienceLabel }})</div>
						</div>
						<div v-if="preview.sample.length" class="text-caption text-medium-emphasis mb-3">For example: <span class="mono">{{ preview.sample.join(", ") }}</span><template v-if="preview.count > preview.sample.length"> and {{ preview.count - preview.sample.length }} more</template></div>
						<div class="mail">
							<div class="mail-subject">{{ preview.email.subject }}</div>
							<pre class="mail-body">{{ preview.email.text }}</pre>
						</div>
						<p class="text-caption text-medium-emphasis mt-2">Shown with your own name for {name}. Only enabled accounts with a verified email are addressed.</p>
						<v-btn class="mt-3" color="primary" variant="flat" block size="large" prepend-icon="mdi-send-outline" :disabled="preview.count === 0 || !audiences?.mailEnabled || !canWrite() || !!running && running.status === 'sending'" @click="confirming = true">
							Send to {{ preview.count }} {{ preview.count === 1 ? "person" : "people" }}…
						</v-btn>
					</template>
				</v-card>
			</v-col>
		</v-row>

		<!-- History -->
		<v-card class="mt-4">
			<div class="d-flex align-center pa-4 pb-0">
				<div class="text-subtitle-1 font-weight-medium">What was sent</div>
				<v-spacer/>
				<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="loadHistory"/>
			</div>
			<div class="table-wrap">
				<v-table density="compact">
					<thead><tr><th>When</th><th>Subject</th><th>To</th><th>Result</th><th>By</th></tr></thead>
					<tbody>
						<tr v-for="item in history" :key="item.id" class="row-click" @click="reuse(item)">
							<td class="text-no-wrap">{{ dateTime(item.createdDate) }}</td>
							<td>{{ item.subject }}</td>
							<td>{{ audienceName(item.audience) }}<div class="text-caption text-medium-emphasis">{{ item.recipients }} people</div></td>
							<td>
								<v-chip size="x-small" variant="tonal" :color="item.status === 'done' ? 'success' : item.status === 'sending' ? 'primary' : 'warning'">{{ statusText[item.status] }}</v-chip>
								<div class="text-caption text-medium-emphasis mt-1">{{ item.sent }} sent<template v-if="item.failed">, {{ item.failed }} failed</template></div>
							</td>
							<td class="text-caption">{{ item.createdBy ?? "—" }}</td>
						</tr>
						<tr v-if="!history.length"><td colspan="5" class="text-center text-medium-emphasis pa-6">Nothing sent yet.</td></tr>
					</tbody>
				</v-table>
			</div>
			<pager :page="page" :page-size="10" :total="total" @update:page="page = $event; loadHistory()"/>
			<p class="text-caption text-medium-emphasis px-4 pb-3">Click a row to start a new message from it. Each email is also listed under Logs > Emails sent.</p>
		</v-card>

		<!-- Confirmation -->
		<v-dialog v-model="confirming" max-width="480">
			<v-card class="pa-2">
				<v-card-title class="d-flex align-center ga-2"><v-icon color="warning">mdi-send-alert-outline</v-icon>Send this email?</v-card-title>
				<v-card-text>
					<p class="text-body-2 mb-2"><strong>{{ preview?.count }}</strong> {{ preview?.count === 1 ? "person" : "people" }} ({{ audienceLabel }}) will receive:</p>
					<div class="mail mb-3"><div class="mail-subject">{{ preview?.email.subject }}</div></div>
					<p class="text-body-2 text-medium-emphasis">Emails go out one by one in the background. You can stop it, but what was already sent can't be recalled.</p>
				</v-card-text>
				<v-card-actions>
					<v-spacer/>
					<v-btn variant="text" @click="confirming = false">Back</v-btn>
					<v-btn color="primary" variant="flat" :loading="sending" @click="send">Yes, send it</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from "vue";
import type {BroadcastAudience, IBroadcast, IBroadcastAudience, IBroadcastPreview} from "@vaultisse/types/admin/IAdmin";
import {api, errorMessage} from "@/api";
import {canWrite, notify} from "@/store";
import {dateTime} from "@/utils/format";
import PageHeader from "@/components/PageHeader.vue";
import Pager from "@/components/Pager.vue";

const audiences = ref<{items: IBroadcastAudience[]; mailEnabled: boolean} | null>(null);
const audience = ref<BroadcastAudience>("all");
const subject = ref("");
const body = ref("");
const preview = ref<IBroadcastPreview | null>(null);
const previewing = ref(false);
const testing = ref(false);
const confirming = ref(false);
const sending = ref(false);
const running = ref<IBroadcast | null>(null);
const history = ref<IBroadcast[]>([]);
const total = ref(0);
const page = ref(1);
let timer: ReturnType<typeof setInterval> | undefined;

const statusText: Record<string, string> = {sending: "Sending", done: "Sent", cancelled: "Stopped", interrupted: "Interrupted by a restart"};
const ready = computed(() => subject.value.trim() !== "" && body.value.trim() !== "");
const audienceItems = computed(() => (audiences.value?.items ?? []).map((a) => ({title: `${a.label} (${a.count})`, value: a.value, subtitle: a.description})));
const audienceLabel = computed(() => audiences.value?.items.find((a) => a.value === audience.value)?.label ?? "");
const audienceName = (value: string) => audiences.value?.items.find((a) => a.value === value)?.label ?? value;

async function runPreview() {
	previewing.value = true;
	try {
		preview.value = await api.broadcast.preview({audience: audience.value, subject: subject.value, body: body.value});
	} finally {
		previewing.value = false;
	}
}

async function sendTest() {
	testing.value = true;
	try {
		const result = await api.broadcast.test({subject: subject.value, body: body.value});
		notify(result.ok ? `A test was sent to ${result.to}.` : `The mail server refused it: ${result.error}`, result.ok ? "success" : "error");
	} finally {
		testing.value = false;
	}
}

/** Starts the sending in the background and polls its progress every 1.5 s (watchRunning). Example body: {audience: "all", subject, body, expectedCount: 7} */
async function send() {
	if (!preview.value) {
		return;
	}
	sending.value = true;
	try {
		running.value = await api.broadcast.send({audience: audience.value, subject: subject.value, body: body.value, expectedCount: preview.value.count});
		confirming.value = false;
		preview.value = null;
		notify("Sending started.");
		watchRunning();
		await loadHistory();
	} catch (e) {
		// A changed audience (409) means the number the admin saw is stale: show the new one.
		confirming.value = false;
		notify(errorMessage(e), "warning");
		await runPreview().catch(() => undefined);
	} finally {
		sending.value = false;
	}
}

async function cancel(id: number) {
	await api.broadcast.cancel(id);
	notify("Stopping…", "info");
}

function watchRunning() {
	clearInterval(timer);
	timer = setInterval(async () => {
		if (!running.value) {
			clearInterval(timer);
			return;
		}
		running.value = await api.broadcast.get(running.value.id).catch(() => running.value);
		if (running.value && running.value.status !== "sending") {
			clearInterval(timer);
			await loadHistory();
			await loadAudiences();
		}
	}, 1500);
}

/** Clicking a row of the history copies its subject, text and audience into the form to start a new message from it. */
function reuse(item: IBroadcast) {
	subject.value = item.subject;
	body.value = item.body;
	audience.value = (item.audience as BroadcastAudience) ?? "all";
	preview.value = null;
	window.scrollTo({top: 0, behavior: "smooth"});
}

async function loadHistory() {
	const result = await api.broadcast.list({page: page.value, pageSize: 10});
	history.value = result.items;
	total.value = result.total;
}

async function loadAudiences() {
	audiences.value = await api.broadcast.audiences();
}

onMounted(async () => {
	await Promise.all([loadAudiences(), loadHistory()]);
	const active = history.value.find((item) => item.status === "sending");
	if (active) {
		running.value = active;
		watchRunning();
	}
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<style scoped>
.count {
	font-size: 2.6rem;
	font-weight: 700;
	line-height: 1;
}

.mail {
	border: 1px solid var(--pb-border);
	border-radius: 10px;
	background: var(--pb-surface-alt);
	overflow: hidden;
}

.mail-subject {
	padding: 10px 14px;
	font-weight: 600;
	border-bottom: 1px solid var(--pb-border);
}

.mail-body {
	margin: 0;
	padding: 12px 14px;
	white-space: pre-wrap;
	word-break: break-word;
	font-family: inherit;
	font-size: 0.88rem;
	max-height: 320px;
	overflow: auto;
}
</style>
