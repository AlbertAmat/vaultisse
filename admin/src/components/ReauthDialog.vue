<template>
	<!--
	  "Confirm it's you": password + a code (or a backup code). Opened by the API client when the server answers 403 {reauthRequired: true}
	  to a dangerous action; on success the same request is repeated. Dangerous actions then stay unlocked for 5 minutes.
	-->
	<v-dialog :model-value="!!state.reauth" max-width="420" persistent>
		<v-card class="pa-2">
			<v-card-title class="d-flex align-center ga-2">
				<v-icon color="warning">mdi-shield-lock-outline</v-icon>
				Confirm it's you
			</v-card-title>
			<v-card-text>
				<p class="text-body-2 text-medium-emphasis mb-4">
					This action can't be undone easily. Enter your password and a code to continue. Dangerous actions stay unlocked for 5 minutes afterwards.
				</p>
				<v-form @submit.prevent="submit">
					<v-text-field v-model="password" type="password" label="Password" autocomplete="current-password" autofocus class="mb-3"/>
					<v-text-field
						v-model="code"
						:label="useBackup ? 'Backup code' : '6-digit code'"
						:inputmode="useBackup ? 'text' : 'numeric'"
						autocomplete="one-time-code"
						:error-messages="error"
					/>
					<v-btn variant="text" size="small" class="mt-1" @click="useBackup = !useBackup; code = ''">
						{{ useBackup ? "Use an authenticator code" : "Use a backup code" }}
					</v-btn>
					<button type="submit" hidden/>
				</v-form>
			</v-card-text>
			<v-card-actions>
				<v-spacer/>
				<v-btn variant="text" @click="close(false)">Cancel</v-btn>
				<v-btn color="primary" variant="flat" :loading="loading" :disabled="!password || !code" @click="submit">Confirm</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import {ref, watch} from "vue";
import {api, errorMessage} from "@/api";
import {state} from "@/store";

const password = ref("");
const code = ref("");
const useBackup = ref(false);
const loading = ref(false);
const error = ref("");

watch(() => state.reauth, (open) => {
	if (open) {
		password.value = "";
		code.value = "";
		error.value = "";
		useBackup.value = false;
	}
});

function close(ok: boolean) {
	state.reauth?.resolve(ok);
	state.reauth = null;
}

async function submit() {
	if (!password.value || !code.value) {
		return;
	}
	loading.value = true;
	error.value = "";
	try {
		const input = useBackup.value ? {backupCode: code.value} : {code: code.value};
		const until = await api.auth.reauth(password.value, input);
		if (state.admin) {
			state.admin.reauthUntil = until;
		}
		close(true);
	} catch (e) {
		error.value = errorMessage(e);
	} finally {
		loading.value = false;
	}
}
</script>
