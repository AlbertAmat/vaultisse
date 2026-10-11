<template>
	<v-dialog
		v-model="dialog"
		max-width="500"
		:close-on-content-click="false"
	>
		<template v-slot:activator="{ props: activatorProps }">
			<v-btn
				v-bind="activatorProps"
				variant="tonal"
				class="text-none"
			>
				{{t(AppLabels.USERCONF_CHANGE_PASSWORD)}}
			</v-btn>
		</template>

		<template v-slot:default="{ isActive }">
			<v-card title="Change password">
				<v-card-text class="pb-2">
					<v-alert
						v-if="error != null"
						type="error"
						density="compact"
						class="mb-4"
					>
						{{error}}
					</v-alert>

					<v-text-field
						v-model="currentPassword"
						:append-icon="show1 ? 'mdi-eye' : 'mdi-eye-off'"
						:type="show1 ? 'text' : 'password'"
						:label="t(AppLabels.USERCONF_CURRENT_PASSWORD)"
						density="compact"
						variant="outlined"
						hide-details
						class="mb-4"
						@click:append="show1 = !show1"
					></v-text-field>

					<v-text-field
						v-model="newPassword1"
						:append-icon="show2 ? 'mdi-eye' : 'mdi-eye-off'"
						:type="show2 ? 'text' : 'password'"
						hint="At least 8 characters"
						:label="t(AppLabels.USERCONF_NEW_PASSWORD)"
						density="compact"
						variant="outlined"
						hide-details
						class="mb-2"
						@click:append="show2 = !show2"
					></v-text-field>

					<!-- Password requirements list -->
					<span
						class="text-body-small"
						:style="{ color: !allRulesMet ? 'red' : '' }"
					>
						{{t(AppLabels.USERCONF_PASSWORD_SECURITY)}}
					</span>
					<ul class="text-body-small mb-4" style="list-style: none; padding: 0;">
						<li :style="{ color: hasMinLength ? 'green' : 'red' }">
							{{t(AppLabels.USERCONF_PASSWORD_MINIMUM_CHAR)}}
						</li>
						<li :style="{ color: hasUppercase ? 'green' : 'red' }">
							{{t(AppLabels.USERCONF_PASSWORD_UPPERCASE)}}
						</li>
						<li :style="{ color: hasNumber ? 'green' : 'red' }">
							{{t(AppLabels.USERCONF_PASSWORD_ONE_NUMBER)}}
						</li>
						<li :style="{ color: hasSpecialChar ? 'green' : 'red' }">
							{{t(AppLabels.USERCONF_PASSWORD_SPECIAL_CHAR)}}
						</li>
					</ul>

					<v-text-field
						v-model="newPassword2"
						:append-icon="show3 ? 'mdi-eye' : 'mdi-eye-off'"
						:type="show3 ? 'text' : 'password'"
						:label="t(AppLabels.USEERCONF_PASSWORD_REPEAT)"
						density="compact"
						variant="outlined"
						:error-messages="passwordMismatchMessage"
						class=" mt-3"
						@click:append="show3 = !show3"
					></v-text-field>
				</v-card-text>

				<v-card-actions>
					<v-spacer></v-spacer>

					<v-btn
						:text="t(AppLabels.CANCEL)"
						class="text-none"
						@click="dialog = false"
					/>

					<v-btn
						:disabled="loading || !allRulesMet || newPassword1 != newPassword2 || currentPassword.trim().length == 0"
						:loading="loading"
						variant="elevated"
						color="primary"
						class="text-none"
						@click="changePassword"
					>
						{{t(AppLabels.SAVE)}}
					</v-btn>
				</v-card-actions>
			</v-card>
		</template>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * "Change password" button + dialog on the settings view: live-checks the
 * new password against the same rules the server enforces (min length,
 * uppercase, digit, special char) and that both entries match before
 * enabling submit, via `userService.changePassword`.
 */
import SettingsController from "@/controller/settings/SettingsController";
import {ref, computed} from "vue";
import {AxiosError} from "axios";
import {userService} from "@/service/user/UserService";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

interface Props {
	controller: SettingsController,
}

const props = defineProps<Props>();

const {t} = useI18n();

const dialog = ref(false);

const loading = ref(false);

const show1 = ref(false);
const show2 = ref(false);
const show3 = ref(false);

const error = ref(null);


const currentPassword = ref("");
const newPassword1 = ref("");
const newPassword2 = ref("");

// Individual password rule checks
const hasMinLength = computed(() => newPassword1.value.length >= 8);
const hasUppercase = computed(() => /[A-Z]/.test(newPassword1.value));
const hasNumber = computed(() => /[0-9]/.test(newPassword1.value));
const hasSpecialChar = computed(() => /[^A-Za-z0-9]/.test(newPassword1.value));

// Combined "all rules met" check (optional)
const allRulesMet = computed(() =>
	hasMinLength.value &&
	hasUppercase.value &&
	hasNumber.value &&
	hasSpecialChar.value
);

const passwordMismatchMessage = computed(() => {
	if (!newPassword2.value) return ""; // No message if empty
	if (newPassword1.value !== newPassword2.value) return t(AppLabels.USERCONF_PASSWORD_NOT_MATCH);
	return "";
});

async function changePassword() {
	if (newPassword1.value !== newPassword2.value) {
		alert(t(AppLabels.USERCONF_PASSWORD_NOT_MATCH));
		return;
	}

	try {
		loading.value = true;
		await userService.changePassword(
			currentPassword.value,
			newPassword1.value
		);
		appSnackbarController.show({message: t(AppLabels.USERCONF_PASSWORD_CHANGED)})
		dialog.value = false;
		currentPassword.value = "";
		newPassword1.value = "";
		newPassword2.value = "";
	} catch (e: AxiosError) {
		error.value = e.response.data.message
	} finally {
		loading.value = false;
	}
}
</script>
