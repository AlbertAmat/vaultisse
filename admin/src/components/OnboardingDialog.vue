<template>
	<!--
	  The first-run setup guide. Opens by itself for a superadmin until it was finished or skipped (GET /onboarding/status), and can be reopened from Settings.
	  Steps: welcome -> email (with a test button) -> who can sign up -> API keys (optional) -> notifications, then a summary of what was set.
	  Every step saves its own settings with the same PUT /settings the Settings page uses, so the guide and the page can never disagree.
	  Values that come from the environment are shown as such, so nobody re-enters what already works.
	-->
	<v-dialog :model-value="modelValue" max-width="760" persistent scrollable>
		<v-card>
			<!-- Progress -->
			<div class="steps px-5 pt-4">
				<div v-for="(label, i) in labels" :key="label" class="step" :class="{active: i === step, done: i < step}">
					<span class="dot"><v-icon v-if="i < step" size="14">mdi-check</v-icon><template v-else>{{ i + 1 }}</template></span>
					<span class="d-none d-sm-inline">{{ label }}</span>
				</div>
			</div>
			<v-progress-linear :model-value="((step + 1) * 100) / labels.length" color="primary" height="3" class="mt-3"/>

			<v-card-text class="pa-6" style="min-height: 330px">
				<!-- 0: welcome -->
				<div v-if="step === 0">
					<div class="d-flex align-center ga-3 mb-3">
						<brand-mark :size="44"/>
						<div class="text-h5 font-weight-bold pb-display">Welcome to your admin console</div>
					</div>
					<p class="text-body-1 mb-3">
						A few quick steps to set Vaultisse up: email, who can register, optional API keys, and which problems to be emailed about. Everything is changeable later under Settings and Notifications, so skip anything you're unsure about.
					</p>
					<v-alert v-if="fromEnv.length" type="info" variant="tonal" density="compact" class="mb-3" icon="mdi-cog-outline">
						Already configured through environment variables: <span class="mono">{{ fromEnv.join(", ") }}</span>. Anything you save here takes priority over those.
					</v-alert>
					<v-alert v-else type="info" variant="tonal" density="compact" class="mb-3" icon="mdi-cog-outline">
						Nothing optional is configured through environment variables yet, so the choices you make here are all there is.
					</v-alert>
					<p class="text-body-2 text-medium-emphasis">Takes about two minutes.</p>
				</div>

				<!-- 1: email -->
				<div v-else-if="step === 1">
					<div class="text-h6 font-weight-bold mb-1 pb-display">Email</div>
					<p class="text-body-2 text-medium-emphasis mb-4">Lets Vaultisse verify new users' addresses and email you. Without it, those features stay off and notifications can't reach you.</p>
					<v-row dense>
						<v-col cols="12" sm="8"><v-text-field v-model="form.SMTP_HOST" label="SMTP host" placeholder="smtp.example.com"/></v-col>
						<v-col cols="12" sm="4"><v-text-field v-model="form.SMTP_PORT" label="Port" type="number" placeholder="587"/></v-col>
						<v-col cols="12" sm="6"><v-text-field v-model="form.SMTP_USER" label="User" autocomplete="off"/></v-col>
						<v-col cols="12" sm="6"><v-text-field v-model="secrets.SMTP_PASSWORD" label="Password" type="password" autocomplete="new-password" :placeholder="isSet('SMTP_PASSWORD') ? '•••••••• (set)' : ''"/></v-col>
						<v-col cols="12"><v-text-field v-model="form.SMTP_FROM" label="Sender address" placeholder="Vaultisse <library@example.com>"/></v-col>
					</v-row>
					<div class="d-flex flex-wrap ga-2 align-start mt-2">
						<v-text-field v-model="testTo" label="Send a test email to" type="email" style="max-width: 300px"/>
						<v-btn variant="tonal" class="mt-1" prepend-icon="mdi-send-outline" :loading="testing" :disabled="!testTo || !form.SMTP_HOST" @click="testEmail">Send test</v-btn>
					</div>
					<v-alert v-if="testResult" :type="testResult.ok ? 'success' : 'error'" variant="tonal" density="compact" class="mt-2">
						{{ testResult.ok ? "The mail server accepted the message. Check your inbox." : testResult.error }}
					</v-alert>
				</div>

				<!-- 2: registration -->
				<div v-else-if="step === 2">
					<div class="text-h6 font-weight-bold mb-1 pb-display">Who can sign up</div>
					<p class="text-body-2 text-medium-emphasis mb-4">Controls the "Register" page of the app.</p>
					<v-switch v-model="flags.REGISTRATION_ENABLED" color="primary" hide-details density="compact">
						<template #label><div><div class="font-weight-medium">Allow people to register</div><div class="text-caption text-medium-emphasis">Turn off once everyone who needs an account has one.</div></div></template>
					</v-switch>
					<v-switch v-model="flags.REGISTRATION_REQUIRES_APPROVAL" color="primary" hide-details density="compact" :disabled="!flags.REGISTRATION_ENABLED">
						<template #label><div><div class="font-weight-medium">Approve new accounts myself</div><div class="text-caption text-medium-emphasis">New accounts stay locked until you approve them under Accounts. Recommended if the app is on the internet.</div></div></template>
					</v-switch>
					<p class="text-caption text-medium-emphasis mt-4">Single sign-on (Authentik, Keycloak...) is set up under Settings, since it needs details from your identity provider.</p>
				</div>

				<!-- 3: api keys -->
				<div v-else-if="step === 3">
					<div class="text-h6 font-weight-bold mb-1 pb-display">API keys <span class="text-body-2 text-medium-emphasis">(optional)</span></div>
					<p class="text-body-2 text-medium-emphasis mb-4">Extra sources when users add books by ISBN. Vaultisse works without them, using Open Library and national catalogs.</p>
					<div v-for="key in keyFields" :key="key.key" class="mb-4">
						<div class="d-flex ga-2 align-start">
							<v-text-field v-model="secrets[key.key]" :label="key.label" type="password" autocomplete="new-password" :placeholder="isSet(key.key) ? '•••••••• (set)' : 'Not set'"/>
							<v-btn variant="tonal" class="mt-1" prepend-icon="mdi-check-network-outline" :loading="keyTesting === key.key" :disabled="!secrets[key.key] && !isSet(key.key)" @click="testKey(key.key)">Test</v-btn>
						</div>
						<v-alert v-if="keyResults[key.key]" :type="keyResults[key.key].ok ? 'success' : 'error'" variant="tonal" density="compact" class="mt-1">{{ keyResults[key.key].message }}</v-alert>
						<p class="text-caption text-medium-emphasis mt-1">{{ key.help }}</p>
					</div>
				</div>

				<!-- 4: notifications -->
				<div v-else-if="step === 4">
					<div class="text-h6 font-weight-bold mb-1 pb-display">Be told when something needs you</div>
					<p class="text-body-2 text-medium-emphasis mb-3">Emails to your sign-in address (<strong>{{ state.admin?.email }}</strong>). They are sent only when email works.</p>
					<v-alert v-if="!mailReady" type="warning" variant="tonal" density="compact" class="mb-3">Email isn't set up yet, so nothing can be sent. Go back to the email step, or do it later.</v-alert>
					<v-switch v-model="subscribed" color="primary" hide-details density="compact">
						<template #label><div class="font-weight-medium">Send me admin notifications</div></template>
					</v-switch>
					<v-divider class="my-2"/>
					<v-switch v-for="event in events" :key="event.key" v-model="flags[event.key]" color="primary" hide-details density="compact" :disabled="!subscribed">
						<template #label><div><div class="font-weight-medium">{{ event.label }}</div><div class="text-caption text-medium-emphasis">{{ event.help }}</div></div></template>
					</v-switch>
				</div>

				<!-- 5: done -->
				<div v-else>
					<div class="d-flex align-center ga-3 mb-3">
						<v-avatar color="success" size="44" variant="tonal"><v-icon>mdi-check</v-icon></v-avatar>
						<div class="text-h5 font-weight-bold pb-display">You're all set</div>
					</div>
					<v-list density="compact" bg-color="transparent" class="pa-0 mb-2">
						<v-list-item v-for="row in summary" :key="row.label" :title="row.label" :subtitle="row.text">
							<template #prepend><v-icon :color="row.ok ? 'success' : undefined" :icon="row.ok ? 'mdi-check-circle-outline' : 'mdi-circle-outline'"/></template>
						</v-list-item>
					</v-list>
					<p class="text-body-2 text-medium-emphasis">Next: have a look at <router-link to="/system" @click="finish">System</router-link> for the database and version, and <router-link to="/settings" @click="finish">Settings</router-link> for single sign-on and limits. You can reopen this guide from Settings.</p>
				</div>
			</v-card-text>

			<v-divider/>
			<v-card-actions class="pa-4">
				<v-btn v-if="step < labels.length - 1" variant="text" @click="skipAll">Skip the guide</v-btn>
				<v-spacer/>
				<v-btn v-if="step > 0 && step < labels.length - 1" variant="text" @click="step--">Back</v-btn>
				<v-btn v-if="step === 0" color="primary" variant="flat" size="large" append-icon="mdi-arrow-right" @click="step++">Let's start</v-btn>
				<template v-else-if="step < labels.length - 1">
					<v-btn variant="text" @click="step++">Skip this step</v-btn>
					<v-btn color="primary" variant="flat" append-icon="mdi-arrow-right" :loading="saving" @click="saveAndNext">Save and continue</v-btn>
				</template>
				<v-btn v-else color="primary" variant="flat" size="large" :loading="saving" @click="finish">Finish</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import {computed, reactive, ref, watch} from "vue";
import type {ISetting} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {notify, state} from "@/store";
import BrandMark from "@/components/BrandMark.vue";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [open: boolean] }>();

const labels = ["Welcome", "Email", "Sign-up", "API keys", "Alerts", "Done"];
const step = ref(0);
const saving = ref(false);
const items = ref<ISetting[]>([]);
const form = reactive<Record<string, string>>({});
const secrets = reactive<Record<string, string>>({});
const flags = reactive<Record<string, boolean>>({});
const subscribed = ref(true);
const mailReady = ref(false);
const testTo = ref(state.admin?.email ?? "");
const testing = ref(false);
const testResult = ref<{ ok: boolean; error: string | null } | null>(null);
const keyTesting = ref("");
const keyResults = reactive<Record<string, { ok: boolean; message: string }>>({});

const keyFields = [
	{key: "GOOGLE_BOOKS_API_KEY", label: "Google Books API key", help: "Create one in the Google Cloud console (Books API)."},
	{key: "LIBRARYTHING_API_KEY", label: "LibraryThing dev key", help: "Free with a LibraryThing account: librarything.com/services/keys.php"},
];
const events = [
	{key: "ADMIN_NOTIFY_USER_PENDING", label: "New accounts waiting for approval", help: "Only matters if you approve accounts yourself."},
	{key: "ADMIN_NOTIFY_SECURITY", label: "Unusual security activity", help: "Many failed logins or blocked requests."},
	{key: "ADMIN_NOTIFY_DATABASE", label: "Database problems", help: "Unreachable, or running out of connections or space."},
	{key: "ADMIN_NOTIFY_UPDATES", label: "A new version is available", help: "Checked from GitHub's public releases."},
];
const textKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_FROM"];
const flagKeys = ["REGISTRATION_ENABLED", "REGISTRATION_REQUIRES_APPROVAL", ...events.map((event) => event.key)];

const fromEnv = computed(() => items.value.filter((item) => item.source === "env").map((item) => item.key));
const isSet = (key: string) => items.value.find((item) => item.key === key)?.isSet ?? false;

const summary = computed(() => [
	{label: "Email", ok: mailReady.value, text: mailReady.value ? "Set up" : "Not set up: verification links and notifications are off"},
	{label: "Registration", ok: true, text: !flags.REGISTRATION_ENABLED ? "Closed" : flags.REGISTRATION_REQUIRES_APPROVAL ? "Open, you approve each account" : "Open to everyone"},
	{label: "API keys", ok: isSet("GOOGLE_BOOKS_API_KEY") || isSet("LIBRARYTHING_API_KEY"), text: isSet("GOOGLE_BOOKS_API_KEY") || isSet("LIBRARYTHING_API_KEY") ? "Configured" : "None (optional)"},
	{label: "Notifications", ok: subscribed.value && mailReady.value, text: !subscribed.value ? "You won't receive them" : mailReady.value ? "You'll be emailed about the events you chose" : "Chosen, but they need email to work"},
]);

function fill(list: ISetting[]) {
	items.value = list;
	for (const item of list) {
		if (textKeys.includes(item.key)) {
			form[item.key] = item.value ?? "";
		}
		if (flagKeys.includes(item.key)) {
			flags[item.key] = item.value === "true";
		}
		secrets[item.key] = "";
	}
	mailReady.value = !!(list.find((item) => item.key === "SMTP_HOST")?.value && list.find((item) => item.key === "SMTP_FROM")?.value);
}

async function load() {
	const [groups, overview] = await Promise.all([api.settings.list(), api.notifications.overview()]);
	fill(groups.flatMap((group) => group.items));
	subscribed.value = overview.recipients.find((admin) => admin.id === overview.me)?.notifyEmail ?? true;
}

watch(() => props.modelValue, (open) => {
	if (open) {
		step.value = 0;
		testResult.value = null;
		Object.keys(keyResults).forEach((key) => delete keyResults[key]);
		load();
	}
});

/** The current form values of the email step, for a test before saving. */
function unsavedEmail(): Record<string, string> {
	const values: Record<string, string> = {};
	for (const key of textKeys) {
		values[key] = form[key] ?? "";
	}
	if (secrets.SMTP_PASSWORD) {
		values.SMTP_PASSWORD = secrets.SMTP_PASSWORD;
	}
	return values;
}

async function testEmail() {
	testing.value = true;
	testResult.value = null;
	try {
		testResult.value = await api.settings.testEmail(testTo.value, unsavedEmail());
	} finally {
		testing.value = false;
	}
}

async function testKey(key: string) {
	keyTesting.value = key;
	delete keyResults[key];
	try {
		keyResults[key] = await api.settings.testKey(key, secrets[key] || undefined);
	} finally {
		keyTesting.value = "";
	}
}

/** Only what changed on this step. */
function changesFor(keys: string[], secretKeys: string[] = []): Record<string, string> {
	const changes: Record<string, string> = {};
	for (const key of keys) {
		const original = items.value.find((item) => item.key === key);
		const now = flagKeys.includes(key) ? String(!!flags[key]) : (form[key] ?? "");
		if (now !== (original?.value ?? "")) {
			changes[key] = now;
		}
	}
	for (const key of secretKeys) {
		if (secrets[key]) {
			changes[key] = secrets[key];
		}
	}
	return changes;
}

async function saveAndNext() {
	saving.value = true;
	try {
		let changes: Record<string, string> = {};
		if (step.value === 1) changes = changesFor(textKeys, ["SMTP_PASSWORD"]);
		if (step.value === 2) changes = changesFor(["REGISTRATION_ENABLED", "REGISTRATION_REQUIRES_APPROVAL"]);
		if (step.value === 3) changes = changesFor([], keyFields.map((field) => field.key));
		if (step.value === 4) {
			changes = changesFor(events.map((event) => event.key));
			await api.notifications.setSubscription(subscribed.value);
		}
		if (Object.keys(changes).length > 0) {
			fill((await api.settings.update(changes)).flatMap((group) => group.items));
		}
		step.value++;
	} catch {
		// The API client showed what is wrong (for example a half-filled email setup); stay on this step.
	} finally {
		saving.value = false;
	}
}

async function markDone() {
	try {
		await api.onboarding.complete();
	} catch {
		// Not fatal: the guide may simply be offered again.
	}
}

async function skipAll() {
	await markDone();
	notify("You can run the setup guide again from Settings.", "info");
	emit("update:modelValue", false);
}

async function finish() {
	saving.value = true;
	await markDone();
	saving.value = false;
	emit("update:modelValue", false);
}
</script>

<style scoped>
.steps {
	display: flex;
	gap: 6px;
	flex-wrap: nowrap;
	justify-content: space-between;
}

.step {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 0.8rem;
	opacity: 0.55;
}

.step.active,
.step.done {
	opacity: 1;
}

.dot {
	display: inline-grid;
	place-items: center;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	font-size: 0.72rem;
	font-weight: 600;
	background: rgba(var(--v-theme-on-surface), 0.12);
}

.step.active .dot {
	background: rgb(var(--v-theme-primary));
	color: #fff;
}

.step.done .dot {
	background: rgb(var(--v-theme-success));
	color: #fff;
}
</style>
