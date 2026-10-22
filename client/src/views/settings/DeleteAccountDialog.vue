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
				color="error"
				class="text-none"
			>
				{{t(AppLabels.USERCONF_DELETE)}}
			</v-btn>
		</template>

		<template v-slot:default>
			<v-card :title="t(AppLabels.USERCONF_DELETE_USER_TITLE)">
				<v-card-text class="pb-2">
					<v-alert
						v-if="error != null"
						type="error"
						density="compact"
						class="mb-4"
					>
						{{error}}
					</v-alert>

					<p class="text-body-small mb-3">{{t(AppLabels.USERCONF_DELETE_USER_DESC)}}</p>

					<v-text-field
						v-model="password"
						:append-icon="show ? 'mdi-eye' : 'mdi-eye-off'"
						:type="show ? 'text' : 'password'"
						:label="t(AppLabels.USERCONF_CURRENT_PASSWORD)"
						density="compact"
						variant="outlined"
						hide-details
						autofocus
						@click:append="show = !show"
						@keyup.enter="deleteAccount"
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
						@click="deleteAccount"
					>
						{{t(AppLabels.USERCONF_DELETE)}}
					</v-btn>
				</v-card-actions>
			</v-card>
		</template>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * "Delete account" button + password-confirmation dialog. Deletion requires
 * re-entering the current password, same as password change and 2FA-disable
 * (see `DELETE /user` in server/src/routes/UserRoute.ts) - a session cookie
 * alone is no longer enough to trigger a permanent, cascading account wipe.
 */
import SettingsController from "@/controller/settings/SettingsController";
import {ref} from "vue";
import {api} from "@/plugins/api";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

interface Props {
	controller: SettingsController,
}

defineProps<Props>();

const {t} = useI18n();

const dialog = ref(false);
const show = ref(false);
const loading = ref(false);
const error = ref(null);
const password = ref("");

async function deleteAccount() {
	try {
		loading.value = true;
		error.value = null;
		await api.users.delete(password.value);
		window.location.href = "/login";
	} catch (e: any) {
		error.value = e.response?.data?.message ?? "Something went wrong. Please try again.";
	} finally {
		loading.value = false;
	}
}
</script>
