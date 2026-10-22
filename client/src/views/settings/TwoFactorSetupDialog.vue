<template>
	<v-dialog
		v-model="dialog"
		max-width="480"
		:close-on-content-click="false"
		:persistent="step === 'backupCodes'"
		@update:model-value="onDialogToggle"
	>
		<template v-slot:activator="{ props: activatorProps }">
			<v-btn
				v-bind="activatorProps"
				variant="tonal"
				class="text-none"
			>
				{{t(AppLabels.TWOFA_ENABLE)}}
			</v-btn>
		</template>

		<template v-slot:default>
			<v-card :title="step === 'scan' ? t(AppLabels.TWOFA_SETUP_TITLE) : t(AppLabels.TWOFA_BACKUP_CODES_TITLE)">
				<v-card-text class="pb-2">
					<v-alert
						v-if="error != null"
						type="error"
						density="compact"
						class="mb-4"
					>
						{{error}}
					</v-alert>

					<template v-if="step === 'scan'">
						<div v-if="loadingSetup" class="d-flex justify-center my-6">
							<v-progress-circular indeterminate color="primary" />
						</div>
						<template v-else>
							<p class="text-body-small mb-3">{{t(AppLabels.TWOFA_SETUP_SCAN_DESC)}}</p>
							<div class="d-flex justify-center mb-4">
								<img :src="qrCodeDataUrl" alt="QR code" style="width: 180px; height: 180px" />
							</div>
							<p class="text-body-small mb-1">{{t(AppLabels.TWOFA_SETUP_MANUAL_KEY)}}</p>
							<code class="d-block mb-4" style="word-break: break-all; font-size: 13px;">{{secret}}</code>

							<v-text-field
								v-model="code"
								:label="t(AppLabels.TWOFA_CODE)"
								density="compact"
								variant="outlined"
								maxlength="6"
								hide-details
								autofocus
								@keyup.enter="enable"
							/>
						</template>
					</template>

					<template v-else>
						<p class="text-body-small mb-3">{{t(AppLabels.TWOFA_BACKUP_CODES_DESC)}}</p>
						<div class="mb-2 pa-3" style="font-family: var(--pb-font-mono); font-size: 14px; line-height: 1.9; background: var(--pb-surface-alt); border-radius: var(--pb-radius-sm);">
							<div v-for="c in backupCodes" :key="c">{{c}}</div>
						</div>
					</template>
				</v-card-text>

				<v-card-actions>
					<v-spacer></v-spacer>

					<template v-if="step === 'scan'">
						<v-btn
							:text="t(AppLabels.CANCEL)"
							class="text-none"
							@click="dialog = false"
						/>

						<v-btn
							:disabled="loadingSetup || enabling || code.trim().length !== 6"
							:loading="enabling"
							variant="elevated"
							color="primary"
							class="text-none"
							@click="enable"
						>
							{{t(AppLabels.TWOFA_ENABLE)}}
						</v-btn>
					</template>

					<v-btn
						v-else
						variant="elevated"
						color="primary"
						class="text-none"
						@click="finish"
					>
						{{t(AppLabels.TWOFA_SAVED_CODES_CONFIRM)}}
					</v-btn>
				</v-card-actions>
			</v-card>
		</template>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * "Enable" button + two-step setup dialog on the settings view:
 * 1. Fetches a fresh TOTP secret/QR on open (`api.users.setupTwoFactor`)
 *    and verifies a 6-digit code against it (`api.users.enableTwoFactor`).
 * 2. Shows the one-time backup codes returned on success - dismissible only
 *    by explicit confirmation (`persistent`), since they're never shown again.
 */
import SettingsController from "@/controller/settings/SettingsController";
import {ref} from "vue";
import {api} from "@/plugins/api";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

interface Props {
	controller: SettingsController,
}

const props = defineProps<Props>();

const {t} = useI18n();

const dialog = ref(false);
const step = ref<"scan" | "backupCodes">("scan");

const loadingSetup = ref(false);
const enabling = ref(false);

const error = ref(null);

const secret = ref("");
const qrCodeDataUrl = ref("");
const code = ref("");
const backupCodes = ref<string[]>([]);

async function onDialogToggle(open: boolean) {
	if (!open) {
		return;
	}

	step.value = "scan";
	error.value = null;
	code.value = "";
	backupCodes.value = [];

	try {
		loadingSetup.value = true;
		const setup = await api.users.setupTwoFactor();
		secret.value = setup.secret;
		qrCodeDataUrl.value = setup.qrCodeDataUrl;
	} catch (e: any) {
		error.value = e.response?.data?.message ?? "Something went wrong. Please try again.";
	} finally {
		loadingSetup.value = false;
	}
}

async function enable() {
	try {
		enabling.value = true;
		error.value = null;
		backupCodes.value = await api.users.enableTwoFactor(code.value.trim());
		step.value = "backupCodes";
	} catch (e: any) {
		error.value = e.response?.data?.message ?? t(AppLabels.TWOFA_INVALID_CODE);
	} finally {
		enabling.value = false;
	}
}

function finish() {
	props.controller.getUser().setTotpEnabled(true);
	appSnackbarController.show({message: t(AppLabels.TWOFA_ENABLED_SNACKBAR)});
	dialog.value = false;
}
</script>
