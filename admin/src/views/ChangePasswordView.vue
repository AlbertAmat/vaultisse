<template>
	<div class="screen">
		<v-card class="pa-4" width="100%" max-width="440" border>
			<div class="d-flex align-center ga-3 mb-4">
				<brand-mark :size="40"/>
				<div>
					<div class="text-h6 font-weight-bold pb-display">Choose a new password</div>
					<div class="pb-eyebrow">First sign-in</div>
				</div>
			</div>
			<v-alert type="warning" variant="tonal" density="compact" class="mb-4">
				You signed in with a password that was generated for you (it was shown in the server's output). Replace it with your own before you continue.
			</v-alert>
			<v-form @submit.prevent="save">
				<v-text-field v-model="current" type="password" label="Current password" autocomplete="current-password" autofocus class="mb-3"/>
				<v-text-field
					v-model="next"
					type="password"
					label="New password"
					autocomplete="new-password"
					hint="At least 12 characters with upper and lower case, a number and a symbol."
					persistent-hint
					class="mb-3"
				/>
				<v-text-field v-model="repeat" type="password" label="Repeat the new password" autocomplete="new-password" :error-messages="mismatch ? 'The passwords don\'t match.' : ''"/>
				<v-btn type="submit" block color="primary" variant="flat" size="large" class="mt-4" :loading="loading" :disabled="!current || !next || mismatch || !repeat">Change password and continue</v-btn>
			</v-form>
			<v-btn variant="text" size="small" class="mt-2" @click="logout">Sign out</v-btn>
		</v-card>
	</div>
</template>

<script setup lang="ts">
import {computed, ref} from "vue";
import {useRouter} from "vue-router";
import {api, errorMessage} from "@/api";
import {notify, state} from "@/store";
import BrandMark from "@/components/BrandMark.vue";

const router = useRouter();
const current = ref("");
const next = ref("");
const repeat = ref("");
const loading = ref(false);
const mismatch = computed(() => repeat.value !== "" && repeat.value !== next.value);

async function save() {
	if (!current.value || !next.value || next.value !== repeat.value) {
		return;
	}
	loading.value = true;
	try {
		await api.auth.changePassword(current.value, next.value);
		state.admin = await api.auth.me();
		notify("Password changed. Welcome!");
		router.replace({name: "overview"});
	} catch (e) {
		notify(errorMessage(e), "error");
	} finally {
		loading.value = false;
	}
}

async function logout() {
	try {
		await api.auth.logout();
	} finally {
		state.admin = null;
		router.replace({name: "login"});
	}
}
</script>

<style scoped>
.screen {
	min-height: 100vh;
	display: grid;
	place-items: center;
	padding: 16px;
}
</style>
