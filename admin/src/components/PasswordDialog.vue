<template>
	<v-dialog :model-value="modelValue" max-width="440" @update:model-value="$emit('update:modelValue', $event)">
		<v-card class="pa-2">
			<v-card-title>Change your password</v-card-title>
			<v-card-text>
				<v-form @submit.prevent="save">
					<v-text-field v-model="current" type="password" label="Current password" autocomplete="current-password" class="mb-3"/>
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
					<p class="text-caption text-medium-emphasis mt-3">Your other sessions are signed out.</p>
					<button type="submit" hidden/>
				</v-form>
			</v-card-text>
			<v-card-actions>
				<v-spacer/>
				<v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
				<v-btn color="primary" variant="flat" :loading="loading" :disabled="!current || !next || mismatch" @click="save">Change password</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {api, errorMessage} from "@/api";
import {notify} from "@/store";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [open: boolean] }>();

const current = ref("");
const next = ref("");
const repeat = ref("");
const loading = ref(false);
const mismatch = computed(() => repeat.value !== "" && repeat.value !== next.value);

watch(() => props.modelValue, (open) => {
	if (open) {
		current.value = next.value = repeat.value = "";
	}
});

async function save() {
	if (!current.value || !next.value || next.value !== repeat.value) {
		return;
	}
	loading.value = true;
	try {
		await api.auth.changePassword(current.value, next.value);
		notify("Password changed.");
		emit("update:modelValue", false);
	} catch (e) {
		notify(errorMessage(e), "error");
	} finally {
		loading.value = false;
	}
}
</script>
