<template>
	<!--
	  Settings (route /settings, menu: Platform > Settings)

	  Change how the installation behaves without editing .env or restarting: email (SMTP), registration, single sign-on, API keys,
	  upload limits, inactive accounts, admin portal. Groups that have their own page (notifications, automatic blocking, data retention)
	  are hidden here.
	  Priority: a value saved here wins over the environment variable of the same name. Each field says where its value comes from:
	  "Set here" | "From env var" | "Default", and warns when an env var is being ignored.
	  Data:   GET/PUT /settings, POST /settings/test-email, POST /settings/test-key, POST /settings/reset/request + /confirm
	  Secrets (SMTP password, API keys) are stored encrypted and shown only as "set"; leaving the field empty keeps the saved one.
	-->
	<div class="page">
		<page-header title="Settings" subtitle="Change how this installation behaves without touching environment variables. Changes apply immediately."/>

		<v-alert v-if="!canWrite()" type="info" variant="tonal" class="mb-4" density="compact">Your account is read-only: you can look at the settings but not change them.</v-alert>

		<!-- Tabs per group; each group saves on its own (Save / Discard) and sends only the fields that changed. -->
		<v-card v-if="groups.length">
			<v-tabs v-model="tab" show-arrows color="primary">
				<v-tab v-for="group in groups" :key="group.id" :value="group.id">{{ group.label }}</v-tab>
			</v-tabs>
			<v-divider/>

			<v-tabs-window v-model="tab">
				<v-tabs-window-item v-for="group in groups" :key="group.id" :value="group.id">
					<div class="pa-5">
						<p class="text-body-2 text-medium-emphasis mb-5">{{ group.description }}</p>

						<div v-for="item in group.items" :key="item.key" class="setting">
							<div class="d-flex flex-wrap align-center ga-2 mb-1">
								<span class="text-body-2 font-weight-medium">{{ item.label }} <span class="setting-key mono text-medium-emphasis">({{ item.key }})</span></span>
								<v-chip size="x-small" :color="sourceColor(item.source)" variant="tonal">{{ sourceLabel(item.source) }}</v-chip>
								<v-chip v-if="item.unreadable" size="x-small" color="error" variant="tonal">Can't be read: enter it again</v-chip>
							</div>

							<div class="d-flex align-start ga-2">
								<v-switch
									v-if="item.type === 'boolean'"
									:model-value="form[item.key] === 'true'"
									color="primary"
									hide-details
									density="compact"
									:disabled="!canWrite()"
									:label="form[item.key] === 'true' ? 'On' : 'Off'"
									@update:model-value="form[item.key] = $event ? 'true' : 'false'"
								/>
								<v-select
									v-else-if="item.type === 'select'"
									v-model="form[item.key]"
									:items="(item.options ?? []).map((o) => ({title: o === '' ? 'Automatic' : o, value: o}))"
									:disabled="!canWrite()"
									style="max-width: 280px"
								/>
								<v-text-field
									v-else-if="item.type === 'secret'"
									v-model="secrets[item.key]"
									type="password"
									autocomplete="new-password"
									:placeholder="item.isSet ? '•••••••• (set, type to replace)' : 'Not set'"
									:disabled="!canWrite()"
									style="max-width: 440px"
								/>
								<v-text-field
									v-else
									v-model="form[item.key]"
									:type="item.type === 'number' ? 'number' : 'text'"
									:placeholder="item.defaultValue ?? ''"
									:disabled="!canWrite()"
									:style="{maxWidth: item.type === 'number' ? '180px' : '440px'}"
								/>
								<v-btn
									v-if="item.testable && canWrite()"
									variant="tonal"
									class="mt-1"
									prepend-icon="mdi-check-network-outline"
									:loading="keyTesting === item.key"
									:disabled="!secrets[item.key] && !item.isSet"
									@click="testKey(item.key)"
								>
									Test key
								</v-btn>
								<v-btn
									v-if="canWrite() && item.source === 'database'"
									variant="text"
									size="small"
									class="mt-1"
									:title="'Remove the override: use the environment variable or default again'"
									@click="resetKey(item.key)"
								>
									Use env
								</v-btn>
							</div>
							<v-alert v-if="keyResults[item.key]" :type="keyResults[item.key].ok ? 'success' : 'error'" variant="tonal" density="compact" class="mt-2" closable @click:close="delete keyResults[item.key]">
								{{ keyResults[item.key].message }}
							</v-alert>
							<v-alert v-if="item.source === 'database' && item.envSet" type="warning" variant="tonal" density="compact" class="mt-2" icon="mdi-swap-horizontal">
								The environment variable <span class="mono">{{ item.key }}</span><template v-if="item.envValue"> ({{ item.envValue }})</template> is ignored while this is set here. "Use env" switches back to it.
							</v-alert>
							<p v-if="item.description" class="setting-help text-medium-emphasis mt-1">{{ item.description }}</p>
						</div>

						<!-- Email: send a test message with what is in the form, saved or not -->
						<div v-if="group.id === 'email'" class="mt-2 mb-6 pa-4 rounded border">
							<div class="font-weight-medium mb-2"><v-icon size="18" class="mr-1">mdi-email-check-outline</v-icon>Check that email works</div>
							<div class="d-flex ga-2 align-start">
								<v-text-field v-model="testTo" type="email" placeholder="you@example.com" label="Send to" style="max-width: 340px"/>
								<v-btn color="primary" variant="flat" prepend-icon="mdi-send-outline" class="mt-1" :loading="testing" :disabled="!testTo || !canWrite()" @click="sendTest">Send test email</v-btn>
							</div>
							<p class="text-caption text-medium-emphasis mt-1">Sends a message with the values above, even if you haven't saved them yet.</p>
							<v-alert v-if="testResult" :type="testResult.ok ? 'success' : 'error'" variant="tonal" density="compact" class="mt-2">
								{{ testResult.ok ? "The mail server accepted the message." : testResult.error }}
							</v-alert>
						</div>

						<div v-if="canWrite()" class="d-flex ga-2 mt-6">
							<v-btn color="primary" variant="flat" :loading="saving" :disabled="!changesFor(group).count" @click="save(group)">
								Save {{ group.label.toLowerCase() }}
							</v-btn>
							<v-btn variant="text" :disabled="!changesFor(group).count" @click="discard(group)">Discard changes</v-btn>
						</div>
					</div>
				</v-tabs-window-item>
			</v-tabs-window>
		</v-card>

		<!-- Send a test email: tries the values typed in the form, even before they are saved. -->
		<v-card class="pa-4 mt-4">
			<div class="d-flex flex-wrap align-center ga-3">
				<div>
					<div class="font-weight-medium">Setup guide</div>
					<p class="text-body-2 text-medium-emphasis">The step-by-step first-run guide: email, registration, API keys and notifications.</p>
				</div>
				<v-spacer/>
				<v-btn variant="tonal" prepend-icon="mdi-auto-fix" :disabled="!canWrite()" @click="state.onboardingOpen = true">Run the setup guide</v-btn>
			</div>
		</v-card>

		<v-card class="pa-4 mt-4">
			<div class="font-weight-medium mb-2">Not editable here</div>
			<p class="text-body-2 text-medium-emphasis">
				The database connection, ports, JWT secret, proxy trust, and whether this portal exists at all stay in environment variables:
				they are needed before the database can be reached, or only take effect at start-up. See <span class="mono">docs/ADMIN.md</span>.
			</p>
			<div v-if="system" class="d-flex flex-wrap ga-2 mt-3">
				<v-chip size="small" variant="tonal" class="mono">Instance id {{ system.instanceUuid }}</v-chip>
				<v-chip size="small" variant="tonal">API port {{ system.bootstrap.apiPort ?? "—" }}</v-chip>
				<v-chip size="small" variant="tonal">Admin port {{ system.bootstrap.adminPort }}</v-chip>
				<v-chip size="small" variant="tonal">Public URL {{ system.bootstrap.frontEndUrl ?? "—" }}</v-chip>
				<v-chip size="small" variant="tonal">Admin URL {{ system.bootstrap.adminUrl ?? "—" }}</v-chip>
				<v-chip size="small" variant="tonal">Trust proxy {{ system.bootstrap.trustProxy ? "on" : "off" }}</v-chip>
				<v-chip size="small" variant="tonal">Admin IP allowlist {{ system.bootstrap.adminAllowedIps ? `${system.bootstrap.adminAllowedIps} addresses` : "off" }}</v-chip>
			</div>
		</v-card>

		<!-- Danger zone -->
		<v-card v-if="canWrite()" class="pa-5 mt-4 danger" border="error md">
			<div class="d-flex align-center ga-2 mb-1 text-error">
				<v-icon>mdi-alert-octagon-outline</v-icon>
				<div class="text-subtitle-1 font-weight-medium">Danger zone</div>
			</div>
			<div class="d-flex flex-wrap align-center ga-4">
				<div style="max-width: 640px">
					<div class="font-weight-medium">Reset configuration to environment variables</div>
					<p class="text-body-2 text-medium-emphasis mt-1">
						Settings saved here take priority over environment variables. This removes all of them so the environment variables apply again.
						Needs your password and a code, and a confirmation code we email you.
					</p>
				</div>
				<v-spacer/>
				<v-btn color="error" variant="tonal" prepend-icon="mdi-restore-alert" @click="resetting = true">Reset configuration…</v-btn>
			</div>
		</v-card>
		<reset-config-dialog v-model="resetting" @done="reloadAfterReset"/>
	</div>
</template>

<script setup lang="ts">
import {onMounted, reactive, ref} from "vue";
import type {ISettingGroup, ISystemInfo, SettingChanges, SettingSource} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify, state} from "@/store";
import ResetConfigDialog from "@/components/ResetConfigDialog.vue";
import PageHeader from "@/components/PageHeader.vue";

const groups = ref<ISettingGroup[]>([]);
const system = ref<ISystemInfo | null>(null);
const tab = ref("email");
const form = reactive<Record<string, string>>({});
const secrets = reactive<Record<string, string>>({});
/** Keys the admin chose to hand back to the env var / default. */
const resets = reactive(new Set<string>());
const saving = ref(false);
const testTo = ref("");
const testing = ref(false);
const resetting = ref(false);
const keyTesting = ref("");
const keyResults = reactive<Record<string, { ok: boolean; message: string }>>({});
const testResult = ref<{ ok: boolean; error: string | null } | null>(null);

const sourceLabel = (source: SettingSource) => ({database: "Set here", env: "From env var", default: "Default"}[source]);
const sourceColor = (source: SettingSource) => ({database: "primary", env: "info", default: undefined}[source]);

function fill(next: ISettingGroup[]) {
	// The notification switches have their own page.
	groups.value = next.filter((group) => group.id !== "notifications" && group.id !== "security" && group.id !== "retention");
	resets.clear();
	for (const group of next) {
		for (const item of group.items) {
			form[item.key] = item.value ?? "";
			secrets[item.key] = "";
		}
	}
}

/** What saving this tab would send. */
function changesFor(group: ISettingGroup): { changes: SettingChanges; count: number } {
	const changes: SettingChanges = {};
	for (const item of group.items) {
		if (resets.has(item.key)) {
			changes[item.key] = null;
		} else if (item.type === "secret") {
			if (secrets[item.key] !== "") {
				changes[item.key] = secrets[item.key];
			}
		} else if ((form[item.key] ?? "") !== (item.value ?? "")) {
			changes[item.key] = form[item.key] ?? "";
		}
	}
	return {changes, count: Object.keys(changes).length};
}

async function reloadAfterReset() {
	fill(await api.settings.list());
	system.value = await api.system();
}

function resetKey(key: string) {
	resets.add(key);
	const item = groups.value.flatMap((group) => group.items).find((candidate) => candidate.key === key);
	form[key] = item?.defaultValue ?? "";
	secrets[key] = "";
	// Applied on the next save of its tab.
	notify("Will go back to the environment variable when you save this tab.", "info");
}

function discard(group: ISettingGroup) {
	for (const item of group.items) {
		form[item.key] = item.value ?? "";
		secrets[item.key] = "";
		resets.delete(item.key);
	}
}

async function save(group: ISettingGroup) {
	const {changes} = changesFor(group);
	saving.value = true;
	try {
		fill(await api.settings.update(changes));
		notify("Saved and applied.");
	} finally {
		saving.value = false;
	}
}

/** Tries the key typed in the field, or the saved one when the field is empty. */
async function testKey(key: string) {
	keyTesting.value = key;
	delete keyResults[key];
	try {
		keyResults[key] = await api.settings.testKey(key, secrets[key] || undefined);
	} finally {
		keyTesting.value = "";
	}
}

async function sendTest() {
	testing.value = true;
	testResult.value = null;
	try {
		const unsaved: Record<string, string> = {};
		for (const item of groups.value.find((group) => group.id === "email")?.items ?? []) {
			if (item.type === "secret") {
				if (secrets[item.key]) unsaved[item.key] = secrets[item.key];
			} else {
				unsaved[item.key] = form[item.key] ?? "";
			}
		}
		testResult.value = await api.settings.testEmail(testTo.value, unsaved);
	} finally {
		testing.value = false;
	}
}

onMounted(async () => {
	[system.value] = await Promise.all([api.system(), api.settings.list().then(fill)]);
});
</script>

<style scoped>
.setting {
	margin-bottom: 18px;
	max-width: 760px;
}

/* The env var name and the help line are secondary to the label and the value, so both are set smaller. */
.setting-key {
	font-size: 0.8rem;
	font-weight: 400;
	overflow-wrap: anywhere;
}

.setting-help {
	font-size: 0.8rem;
	line-height: 1.4;
}
</style>
