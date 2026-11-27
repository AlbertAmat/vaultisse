<template>
	<div class="login">
		<v-card class="pa-4" width="100%" max-width="440" border>
			<div class="d-flex align-center ga-3 mb-4">
				<brand-mark :size="40"/>
				<div>
					<div class="text-h6 font-weight-bold pb-display">Vaultisse</div>
					<div class="pb-eyebrow">Admin console</div>
				</div>
			</div>

			<!-- Step 1: password -->
			<v-form v-if="step === 'credentials'" @submit.prevent="login">
				<v-text-field v-model="email" label="Email" type="email" autocomplete="username" autofocus class="mb-3"/>
				<v-text-field v-model="password" label="Password" type="password" autocomplete="current-password" :error-messages="error"/>
				<v-btn type="submit" block color="primary" variant="flat" size="large" class="mt-4" :loading="loading" :disabled="!email || !password">Continue</v-btn>
			</v-form>

			<!-- Step 2a: code -->
			<v-form v-else-if="step === 'totp'" @submit.prevent="verify">
				<p class="text-body-2 text-medium-emphasis mb-3">
					{{ useBackup ? "Enter one of your one-time backup codes." : "Enter the 6-digit code from your authenticator app." }}
				</p>
				<v-text-field
					v-model="code"
					:label="useBackup ? 'Backup code' : '6-digit code'"
					:inputmode="useBackup ? 'text' : 'numeric'"
					autocomplete="one-time-code"
					autofocus
					:error-messages="error"
				/>
				<v-btn type="submit" block color="primary" variant="flat" size="large" class="mt-4" :loading="loading" :disabled="!code">Sign in</v-btn>
				<div class="d-flex justify-space-between mt-3">
					<v-btn variant="text" size="small" @click="useBackup = !useBackup; code = ''; error = ''">{{ useBackup ? "Use authenticator code" : "Use a backup code" }}</v-btn>
					<v-btn variant="text" size="small" @click="reset">Start over</v-btn>
				</div>
			</v-form>

			<!-- Step 2b: first login, set two-factor up -->
			<div v-else-if="step === 'enroll'">
				<p class="text-body-2 mb-3">
					Admin accounts must use two-factor authentication. Scan this QR code with an authenticator app (or enter the key by hand), then type the code it shows.
				</p>
				<div v-if="enroll" class="d-flex flex-column align-center mb-3">
					<img :src="enroll.qrCode" width="190" height="190" alt="QR code for the authenticator app" class="rounded bg-white pa-2"/>
					<code class="mono text-caption mt-2 text-medium-emphasis" style="word-break: break-all">{{ enroll.secret }}</code>
				</div>
				<v-form @submit.prevent="confirmEnroll">
					<v-text-field v-model="code" label="6-digit code" inputmode="numeric" autocomplete="one-time-code" :error-messages="error"/>
					<v-btn type="submit" block color="primary" variant="flat" size="large" class="mt-4" :loading="loading" :disabled="!code">Turn on and sign in</v-btn>
				</v-form>
				<v-btn variant="text" size="small" class="mt-2" @click="reset">Start over</v-btn>
			</div>

			<!-- Step 3: backup codes -->
			<div v-else>
				<v-alert type="warning" variant="tonal" density="compact" class="mb-3">
					Save these backup codes somewhere safe. Each works once if you lose your authenticator. They won't be shown again.
				</v-alert>
				<div class="codes mono">
					<span v-for="backup in backupCodes" :key="backup">{{ backup }}</span>
				</div>
				<div class="d-flex ga-2 mt-3">
					<v-btn variant="tonal" prepend-icon="mdi-content-copy" @click="copyCodes">Copy</v-btn>
					<v-btn variant="tonal" prepend-icon="mdi-download" @click="downloadCodes">Download</v-btn>
				</div>
				<v-checkbox v-model="saved" density="compact" label="I have saved my backup codes" class="mt-2"/>
				<v-btn block color="primary" variant="flat" size="large" :disabled="!saved" @click="finish">Continue to the console</v-btn>
			</div>
		</v-card>
	</div>
</template>

<script setup lang="ts">
import {ref} from "vue";
import {useRouter} from "vue-router";
import type {IEnrollStart} from "@vaultisse/types/admin/IAdmin";
import {api, errorMessage} from "@/api";
import {notify, state} from "@/store";
import BrandMark from "@/components/BrandMark.vue";

const router = useRouter();
const step = ref<"credentials" | "totp" | "enroll" | "backup">("credentials");
const email = ref("");
const password = ref("");
const code = ref("");
const useBackup = ref(false);
const error = ref("");
const loading = ref(false);
const enroll = ref<IEnrollStart | null>(null);
const backupCodes = ref<string[]>([]);
const saved = ref(false);

function reset() {
	step.value = "credentials";
	password.value = code.value = error.value = "";
	enroll.value = null;
}

/** Runs one step, showing the server's message under the field when it fails. */
async function run(work: () => Promise<void>) {
	loading.value = true;
	error.value = "";
	try {
		await work();
	} catch (e) {
		error.value = errorMessage(e);
	} finally {
		loading.value = false;
	}
}

const login = () => run(async () => {
	const {next} = await api.auth.login(email.value, password.value);
	code.value = "";
	if (next === "enroll") {
		enroll.value = await api.auth.enrollStart();
	}
	step.value = next;
});

const verify = () => run(async () => {
	await api.auth.verifyCode(useBackup.value ? {backupCode: code.value} : {code: code.value});
	await enter();
});

const confirmEnroll = () => run(async () => {
	const result = await api.auth.enrollConfirm(code.value);
	backupCodes.value = result.backupCodes;
	step.value = "backup";
});

async function enter() {
	state.admin = await api.auth.me();
	router.replace({name: "overview"});
}

const finish = () => enter();

async function copyCodes() {
	try {
		await navigator.clipboard.writeText(backupCodes.value.join("\n"));
		notify("Backup codes copied.");
	} catch {
		notify("Couldn't copy. Select the codes and copy them by hand.", "warning");
	}
}

function downloadCodes() {
	const blob = new Blob([`Vaultisse admin backup codes for ${email.value}\n\n${backupCodes.value.join("\n")}\n`], {type: "text/plain"});
	const link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = "vaultisse-admin-backup-codes.txt";
	link.click();
	URL.revokeObjectURL(link.href);
}
</script>

<style scoped>
.login {
	min-height: 100vh;
	display: grid;
	place-items: center;
	padding: 16px;
}

.codes {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 6px 16px;
	padding: 12px;
	border-radius: 8px;
	background: rgba(var(--v-theme-on-surface), 0.06);
	font-size: 0.9rem;
}
</style>
