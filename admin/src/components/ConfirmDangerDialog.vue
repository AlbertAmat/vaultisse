<template>
	<!--
	  Confirmation for a destructive action. Optionally the admin must type a word to enable the button (confirm-text), and the dialog can
	  offer "do it right now" instead of waiting out a grace period (allow-immediate).
	  Example: <confirm-danger-dialog v-model="open" title="Delete this account?" action-label="Delete" confirm-text="alice" allow-immediate :action="remove">…</confirm-danger-dialog>
	  The dialog closes when action() resolves and stays open when it throws (the API client has already shown the error).
	-->
	<v-dialog :model-value="modelValue" max-width="480" @update:model-value="$emit('update:modelValue', $event)">
		<v-card class="pa-2">
			<v-card-title class="d-flex align-center ga-2 text-error">
				<v-icon>mdi-alert-octagon-outline</v-icon>
				{{ title }}
			</v-card-title>
			<v-card-text>
				<div class="text-body-2 mb-4"><slot/></div>
				<template v-if="confirmText">
					<p class="text-body-2 mb-2">Type <strong class="mono">{{ confirmText }}</strong> to confirm.</p>
					<v-text-field v-model="typed" autocomplete="off" autofocus/>
				</template>
				<v-checkbox
					v-if="allowImmediate"
					v-model="immediate"
					color="error"
					density="compact"
					label="Delete right now instead of after the grace period"
				/>
			</v-card-text>
			<v-card-actions>
				<v-spacer/>
				<v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
				<v-btn color="error" variant="flat" :loading="loading" :disabled="!!confirmText && typed !== confirmText" @click="run">
					{{ actionLabel }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import {ref, watch} from "vue";

const props = withDefaults(defineProps<{
	modelValue: boolean;
	title: string;
	actionLabel?: string;
	/** What must be typed to enable the button; omit for a plain confirmation. */
	confirmText?: string;
	allowImmediate?: boolean;
	/** Does the work; the dialog closes when it resolves and stays open when it throws. */
	action: (immediate: boolean) => Promise<unknown>;
}>(), {actionLabel: "Confirm", allowImmediate: false});

const emit = defineEmits<{ "update:modelValue": [open: boolean]; done: [] }>();

const typed = ref("");
const immediate = ref(false);
const loading = ref(false);

watch(() => props.modelValue, (open) => {
	if (open) {
		typed.value = "";
		immediate.value = false;
	}
});

async function run() {
	loading.value = true;
	try {
		await props.action(immediate.value);
		emit("update:modelValue", false);
		emit("done");
	} catch {
		// The API client already told the admin what went wrong; keep the dialog open.
	} finally {
		loading.value = false;
	}
}
</script>
