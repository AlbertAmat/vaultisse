<template>
	<v-dialog :model-value="modelValue" max-width="500" persistent>
		<v-card class="pa-2">
			<v-card-title class="d-flex align-center ga-2 text-error">
				<v-icon>mdi-alert-octagon-outline</v-icon>
				Reset configuration
			</v-card-title>

			<!-- Step 1: understand and confirm -->
			<template v-if="step === 'confirm'">
				<v-card-text>
					<p class="text-body-2 mb-3">
						This removes <strong>every setting saved in the console</strong> (email, registration, SSO, API keys, limits, notification choices...). The values from your environment variables apply again, as if you had never used Settings.
					</p>
					<ul class="text-body-2 mb-4 pl-5">
						<li>Accounts, vaults, plans, admins and logs are not touched.</li>
						<li>Features configured only in the console (for example email) switch off until they are set again.</li>
						<li>It takes effect immediately and can't be undone.</li>
					</ul>
					<p class="text-body-2 mb-2">Type <strong class="mono">RESET</strong> to continue. We then email a confirmation code to <strong>{{ email }}</strong>.</p>
					<v-text-field v-model="typed" autocomplete="off" autofocus placeholder="RESET"/>
				</v-card-text>
				<v-card-actions>
					<v-spacer/>
					<v-btn variant="text" @click="close">Cancel</v-btn>
					<v-btn color="error" variant="flat" :loading="loading" :disabled="typed !== 'RESET'" @click="requestCode">Send me a code</v-btn>
				</v-card-actions>
			</template>

			<!-- Step 2: the emailed code -->
			<template v-else>
				<v-card-text>
					<v-alert type="info" variant="tonal" density="compact" class="mb-4" icon="mdi-email-fast-outline">
						We sent a 6-digit code to <strong>{{ sentTo }}</strong>. It is valid for 10 minutes.
					</v-alert>
					<v-text-field v-model="code" label="Confirmation code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus :error-messages="error" @keyup.enter="confirm"/>
					<v-btn variant="text" size="small" class="mt-1" :loading="loading" @click="requestCode">Send a new code</v-btn>
				</v-card-text>
				<v-card-actions>
					<v-spacer/>
					<v-btn variant="text" @click="close">Cancel</v-btn>
					<v-btn color="error" variant="flat" :loading="loading" :disabled="code.length !== 6" @click="confirm">Reset configuration</v-btn>
				</v-card-actions>
			</template>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import {ref, watch} from "vue";
import {api, errorMessage} from "@/api";
import {notify, state} from "@/store";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [open: boolean]; done: [] }>();

const email = state.admin?.email ?? "your admin address";
const step = ref<"confirm" | "code">("confirm");
const typed = ref("");
const code = ref("");
const sentTo = ref("");
const error = ref("");
const loading = ref(false);

watch(() => props.modelValue, (open) => {
	if (open) {
		step.value = "confirm";
		typed.value = code.value = error.value = "";
	}
});

const close = () => emit("update:modelValue", false);

async function requestCode() {
	loading.value = true;
	try {
		const result = await api.settings.resetRequest();
		sentTo.value = result.sentTo;
		code.value = "";
		error.value = "";
		step.value = "code";
	} catch {
		// The API client already showed why (e.g. email isn't set up).
	} finally {
		loading.value = false;
	}
}

async function confirm() {
	if (code.value.length !== 6) {
		return;
	}
	loading.value = true;
	error.value = "";
	try {
		const result = await api.settings.resetConfirm(code.value);
		notify(`Configuration reset: ${result.removed} saved ${result.removed === 1 ? "setting" : "settings"} removed. The environment variables apply again.`);
		emit("done");
		close();
	} catch (e) {
		error.value = errorMessage(e);
	} finally {
		loading.value = false;
	}
}
</script>
