<template>
	<v-dialog
		v-model="dialog"
		max-width="420"
		:close-on-content-click="false"
	>
		<template v-slot:activator="{ props: activatorProps }">
			<v-btn
				v-bind="activatorProps"
				variant="tonal"
				class="text-none"
			>
				{{t(AppLabels.TWOFA_DISABLE)}}
			</v-btn>
		</template>

		<template v-slot:default>
			<v-card :title="t(AppLabels.TWOFA_DISABLE_TITLE)">
				<v-card-text class="pb-2">
					<v-alert
						v-if="error != null"
						type="error"
						density="compact"
						class="mb-4"
					>
						{{error}}
					</v-alert>

					<p class="text-body-small mb-3">{{t(AppLabels.TWOFA_DISABLE_DESC)}}</p>

					<v-text-field
						v-model="password"
						:append-icon="show ? 'mdi-eye' : 'mdi-eye-off'"
						:type="show ? 'text' : 'password'"
						:label="t(AppLabels.TWOFA_DISABLE_PASSWORD)"
						density="compact"
						variant="outlined"
						hide-details
						autofocus
						@click:append="show = !show"
						@keyup.enter="disable"
					/>
				</v-card-text>

				<v-card-actions>
					<v-spacer></v-spacer>

					<v-btn
						:text="t(AppLabels.CANCEL)"
						class="text-none"
						@click="dialog = false"
					/>

					<v-btn
						:disabled="loading || password.trim().length === 0"
						:loading="loading"
						variant="elevated"
						color="error"
						class="text-none"
						@click="disable"
					>
						{{t(AppLabels.TWOFA_DISABLE)}}
					</v-btn>
				</v-card-actions>
			</v-card>
		</template>
	</v-dialog>
</template>

<script setup lang="ts">
/** "Disable" button + password-confirmation dialog for turning two-factor auth off. */
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
const show = ref(false);
const loading = ref(false);
const error = ref(null);
const password = ref("");

async function disable() {
	try {
		loading.value = true;
		error.value = null;
		await api.users.disableTwoFactor(password.value);
		props.controller.getUser().setTotpEnabled(false);
		appSnackbarController.show({message: t(AppLabels.TWOFA_DISABLED_SNACKBAR)});
		dialog.value = false;
		password.value = "";
	} catch (e: any) {
		error.value = e.response?.data?.message ?? "Something went wrong. Please try again.";
	} finally {
		loading.value = false;
	}
}
</script>
