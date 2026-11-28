<template>
	<!--
	  Webhooks (route /webhooks, menu: Platform > Webhooks)

	  Sends what happens in the portal (a new account, an incident, a blocked address, an alert) to Slack, Discord, Telegram or any URL.
	  The secret part of a target (URL, bot token, signing secret) is stored encrypted and never shown again: the list shows only a hint
	  such as "hooks.slack.com/…mnop". Editing without typing a new target keeps the saved one.
	  Data:   GET/POST /webhooks, PUT/PATCH/DELETE /webhooks/:id, POST /webhooks/:id/test, GET /webhooks/:id/deliveries
	  Creating a webhook or changing where it points needs a fresh verification.
	-->
	<div class="page">
		<page-header title="Webhooks" subtitle="Send what happens here to Slack, Discord, Telegram or any URL: a new account, an incident, a blocked address, an alert.">
			<v-btn v-if="canWrite()" color="primary" variant="flat" prepend-icon="mdi-plus" @click="openForm(null)">Add a webhook</v-btn>
		</page-header>

		<!-- One fact per column: name, type, where it sends, how many events, last delivery, on/off. -->
		<v-card>
			<div class="table-wrap">
				<v-table>
					<thead><tr><th>Name</th><th>Type</th><th>Sends to</th><th>Events</th><th>Last delivery</th><th>On</th><th></th></tr></thead>
					<tbody>
						<tr v-for="hook in items" :key="hook.id">
							<td class="text-no-wrap font-weight-medium">{{ hook.name }}</td>
							<td class="text-no-wrap"><v-icon :icon="kinds[hook.kind].icon" size="18" class="mr-1"/>{{ kinds[hook.kind].title }}</td>
							<td class="text-no-wrap mono text-medium-emphasis">{{ hook.targetHint }}</td>
							<td class="text-no-wrap">
								<v-chip size="small" variant="tonal">{{ hook.events.length }} {{ hook.events.length === 1 ? "event" : "events" }}</v-chip>
								<v-tooltip activator="parent" location="top"><div v-for="e in hook.events" :key="e">{{ label(e) }}</div></v-tooltip>
							</td>
							<td class="text-no-wrap">
								<template v-if="hook.lastAt"><v-chip size="x-small" variant="tonal" :color="hook.lastStatus === 'sent' ? 'success' : 'error'">{{ hook.lastStatus === "sent" ? "delivered" : "failed" }}</v-chip> <span class="text-caption text-medium-emphasis">{{ relative(hook.lastAt) }}</span></template>
								<span v-else class="text-medium-emphasis">never</span>
								<v-tooltip v-if="hook.lastStatus === 'failed' && hook.lastError" activator="parent" location="top">{{ hook.lastError }}</v-tooltip>
							</td>
							<td><v-switch :model-value="hook.enabled" density="compact" hide-details color="primary" :disabled="!canWrite()" :aria-label="`${hook.name} enabled`" @update:model-value="toggle(hook, !!$event)"/></td>
							<td class="text-right text-no-wrap">
								<v-btn v-if="canWrite()" size="small" variant="tonal" prepend-icon="mdi-send-outline" :loading="testing === hook.id" @click="test(hook)">Test</v-btn>
								<v-menu>
									<template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-vertical" variant="text" size="small" aria-label="Actions"/></template>
									<v-list density="compact">
										<v-list-item title="Recent deliveries" @click="showDeliveries(hook)"/>
										<v-list-item v-if="canWrite()" title="Edit" @click="openForm(hook)"/>
										<v-list-item v-if="canWrite()" title="Remove…" base-color="error" @click="removing = hook"/>
									</v-list>
								</v-menu>
							</td>
						</tr>
						<tr v-if="!items.length"><td colspan="7" class="text-center text-medium-emphasis pa-8">No webhook yet. Add one to get alerts in your chat.</td></tr>
					</tbody>
				</v-table>
			</div>
		</v-card>
		<p class="text-caption text-medium-emphasis mt-3">
			Messages carry titles and short facts (a username, an address, a count), never email addresses or library content. Webhooks work even when email isn't set up. Each attempt is made once, with a short timeout, and kept in the delivery log for 30 days.
		</p>

		<!-- Add / edit -->
		<v-dialog v-model="dialog" max-width="620" scrollable>
			<v-card>
				<v-card-title>{{ editing ? "Edit the webhook" : "Add a webhook" }}</v-card-title>
				<v-card-text>
					<v-chip-group v-if="!editing" v-model="form.kind" mandatory selected-class="text-primary" class="mb-2">
						<v-chip v-for="(k, id) in kinds" :key="id" :value="id" :prepend-icon="k.icon" variant="text" filter>{{ k.title }}</v-chip>
					</v-chip-group>
					<p class="text-body-2 text-medium-emphasis mb-3">{{ kinds[form.kind].help }}</p>
					<v-text-field v-model="form.name" label="Name" maxlength="60" class="mb-3" placeholder="Ops channel"/>

					<template v-if="form.kind === 'telegram'">
						<v-text-field v-model="form.token" label="Bot token" :placeholder="editing ? 'Leave empty to keep the saved one' : '123456:ABC-DEF…'" autocomplete="off" class="mb-3"/>
						<v-text-field v-model="form.chatId" label="Chat id" :placeholder="editing ? 'Leave empty to keep the saved one' : '-1001234567890 or @mychannel'" autocomplete="off" class="mb-3"/>
					</template>
					<template v-else>
						<v-text-field v-model="form.url" :label="form.kind === 'generic' ? 'URL' : 'Webhook URL'" :placeholder="editing ? 'Leave empty to keep the saved one' : kinds[form.kind].placeholder" autocomplete="off" class="mb-3"/>
						<v-text-field v-if="form.kind === 'generic'" v-model="form.secret" label="Signing secret (optional)" autocomplete="off" hint="Used to sign each request: header X-Vaultisse-Signature: sha256=<HMAC of the body>." persistent-hint class="mb-3"/>
					</template>

					<div class="d-flex align-center mt-2">
						<div class="text-subtitle-2">Send me…</div><v-spacer/>
						<v-btn size="x-small" variant="text" @click="form.events = form.events.length === events.length ? [] : events.map((e) => e.id)">{{ form.events.length === events.length ? "None" : "All" }}</v-btn>
					</div>
					<v-checkbox v-for="e in events" :key="e.id" v-model="form.events" :value="e.id" :label="e.label" density="compact" hide-details/>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="dialog = false">Cancel</v-btn><v-btn color="primary" variant="flat" :loading="saving" :disabled="!canSave" @click="save">{{ editing ? "Save" : "Add it" }}</v-btn></v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Deliveries -->
		<v-dialog v-model="deliveriesOpen" max-width="620" scrollable>
			<v-card v-if="viewing">
				<v-card-title>{{ viewing.name }}: recent deliveries</v-card-title>
				<v-card-text>
					<v-table density="compact">
						<thead><tr><th>When</th><th>Event</th><th>Result</th></tr></thead>
						<tbody>
							<tr v-for="d in deliveries" :key="d.id">
								<td class="text-no-wrap">{{ dateTime(d.createdDate) }}</td>
								<td>{{ d.event === "test" ? "Test message" : label(d.event) }}</td>
								<td><v-chip size="x-small" variant="tonal" :color="d.status === 'sent' ? 'success' : 'error'">{{ d.status === "sent" ? "delivered" : "failed" }}</v-chip><span v-if="d.error" class="text-caption text-error ml-2">{{ d.error }}</span></td>
							</tr>
							<tr v-if="!deliveries.length"><td colspan="3" class="text-center text-medium-emphasis pa-4">Nothing sent yet.</td></tr>
						</tbody>
					</v-table>
				</v-card-text>
				<v-card-actions><v-spacer/><v-btn variant="text" @click="deliveriesOpen = false">Close</v-btn></v-card-actions>
			</v-card>
		</v-dialog>

		<confirm-danger-dialog :model-value="!!removing" title="Remove this webhook?" action-label="Remove" :action="remove" @update:model-value="removing = null">
			<template v-if="removing"><strong>{{ removing.name }}</strong> stops receiving events, and its delivery log is deleted.</template>
		</confirm-danger-dialog>
	</div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref} from "vue";
import type {IWebhook, IWebhookDelivery, IWebhookEvent, WebhookKind} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateTime, relative} from "@/utils/format";
import ConfirmDangerDialog from "@/components/ConfirmDangerDialog.vue";
import PageHeader from "@/components/PageHeader.vue";

/** Per type: icon, label, example URL and the help text shown in the form. A generic URL receives POST {event, title, lines, instance, sentAt}. */
const kinds: Record<WebhookKind, {title: string; icon: string; placeholder: string; help: string}> = {
	slack: {title: "Slack", icon: "mdi-slack", placeholder: "https://hooks.slack.com/services/T000/B000/XXXX", help: "In Slack: Apps > Incoming Webhooks > Add to Slack, pick a channel and copy the Webhook URL."},
	discord: {title: "Discord", icon: "mdi-discord", placeholder: "https://discord.com/api/webhooks/123456/abcdef", help: "In Discord: channel settings > Integrations > Webhooks > New Webhook > Copy Webhook URL."},
	telegram: {title: "Telegram", icon: "mdi-send-circle-outline", placeholder: "", help: "Create a bot with @BotFather and copy its token. Add the bot to your chat or channel, then use the chat id (a negative number for a group, or @channelname)."},
	generic: {title: "Any URL", icon: "mdi-webhook", placeholder: "https://example.com/hooks/vaultisse", help: "Receives a JSON POST: {event, title, lines, instance, sentAt}. Must be HTTPS and reachable from the internet."},
};

const items = ref<IWebhook[]>([]);
const events = ref<IWebhookEvent[]>([]);
const label = (id: string) => events.value.find((e) => e.id === id)?.label ?? id;

const dialog = ref(false);
const editing = ref<IWebhook | null>(null);
const saving = ref(false);
const testing = ref<number | null>(null);
const removing = ref<IWebhook | null>(null);
const form = reactive({kind: "slack" as WebhookKind, name: "", url: "", token: "", chatId: "", secret: "", events: [] as string[]});

const canSave = computed(() => {
	if (!form.name.trim() || form.events.length === 0) return false;
	if (editing.value) return true;
	return form.kind === "telegram" ? !!form.token && !!form.chatId : !!form.url;
});

/** New webhooks start with the most useful events ticked (account.created, incident.opened, ip.blocked, security.alert, anomaly.detected). */
function openForm(hook: IWebhook | null) {
	editing.value = hook;
	form.kind = hook?.kind ?? "slack";
	form.name = hook?.name ?? "";
	form.url = form.token = form.chatId = form.secret = "";
	form.events = hook ? [...hook.events] : ["account.created", "incident.opened", "ip.blocked", "security.alert", "anomaly.detected"];
	dialog.value = true;
}

async function save() {
	saving.value = true;
	try {
		const target = {url: form.url.trim() || undefined, token: form.token.trim() || undefined, chatId: form.chatId.trim() || undefined, secret: form.secret.trim() || undefined};
		if (editing.value) {
			await api.webhooks.update(editing.value.id, {name: form.name.trim(), events: form.events, ...target});
		} else {
			await api.webhooks.create({name: form.name.trim(), kind: form.kind, events: form.events, ...target});
		}
		dialog.value = false;
		notify("Saved.");
		await load();
	} finally {
		saving.value = false;
	}
}

async function toggle(hook: IWebhook, enabled: boolean) {
	await api.webhooks.setEnabled(hook.id, enabled);
	hook.enabled = enabled;
}

async function test(hook: IWebhook) {
	testing.value = hook.id;
	try {
		const result = await api.webhooks.test(hook.id);
		notify(result.ok ? `A test message was sent to ${hook.name}.` : `It didn't work: ${result.error}`, result.ok ? "success" : "error");
		await load();
	} finally {
		testing.value = null;
	}
}

const deliveriesOpen = ref(false);
const viewing = ref<IWebhook | null>(null);
const deliveries = ref<IWebhookDelivery[]>([]);
async function showDeliveries(hook: IWebhook) {
	viewing.value = hook;
	deliveries.value = await api.webhooks.deliveries(hook.id);
	deliveriesOpen.value = true;
}

async function remove() {
	const hook = removing.value!;
	await api.webhooks.remove(hook.id);
	notify("Webhook removed.");
	await load();
}

async function load() {
	const result = await api.webhooks.list();
	items.value = result.items;
	events.value = result.events;
}

onMounted(load);
</script>
