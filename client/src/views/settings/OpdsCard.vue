<template>
	<settings-card :title="t(AppLabels.USERCONF_OPDS)">
		<p class="v-card-subtitle pl-0 mb-4" style="white-space: normal">{{t(AppLabels.USERCONF_OPDS_DESC)}}</p>

		<div v-if="loading" class="d-flex justify-center my-6">
			<v-progress-circular indeterminate color="primary" />
		</div>

		<template v-else>
			<v-text-field
				v-if="feedUrl"
				:model-value="feedUrl"
				readonly
				density="compact"
				variant="outlined"
				hide-details
				class="mb-4"
				append-inner-icon="mdi-content-copy"
				@click:append-inner="copy"
				@focus="($event.target as HTMLInputElement).select()"
			/>
			<p v-else-if="enabled" class="v-card-subtitle pl-0 mb-4" style="white-space: normal">{{t(AppLabels.USERCONF_OPDS_ACTIVE)}}</p>

			<div class="d-flex flex-wrap" style="gap: 8px">
				<v-btn v-if="feedUrl" variant="tonal" size="small" class="text-none" prepend-icon="mdi-content-copy" @click="copy">
					{{t(AppLabels.USERCONF_OPDS_COPY)}}
				</v-btn>
				<v-btn
					:color="enabled ? undefined : 'primary'"
					variant="tonal"
					size="small"
					class="text-none"
					:loading="busy"
					:disabled="busy"
					@click="enabled ? regenerate() : generate()"
				>
					{{enabled ? t(AppLabels.USERCONF_OPDS_REGENERATE) : t(AppLabels.USERCONF_OPDS_ENABLE)}}
				</v-btn>
				<v-btn v-if="enabled" variant="tonal" size="small" class="text-none" :disabled="busy" @click="disable">
					{{t(AppLabels.USERCONF_OPDS_DISABLE)}}
				</v-btn>
			</div>
		</template>
	</settings-card>
</template>

<script setup lang="ts">
/**
 * Settings > OPDS feed: creates, rotates and disables the current user's
 * OPDS feed link (POST/DELETE /user/opds). The server only ever returns the
 * token once, so the full URL is shown right after creation and then gone;
 * afterwards the card only says the feed is active.
 */
import {onMounted, ref} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import SettingsCard from "@/views/settings/SettingsCard.vue";
import {userService} from "@/service/user/UserService";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";

const {t} = useI18n();

const loading = ref(true);
const busy = ref(false);
const enabled = ref(false);
/** Full feed URL, set only in the session where the token was just created. */
const feedUrl = ref("");

onMounted(async () => {
	try {
		enabled.value = await userService.getOpdsEnabled();
	} catch (e) {
		console.error("Error while fetching OPDS feed status", e);
	} finally {
		loading.value = false;
	}
});

/** Creates a token and shows the resulting absolute URL. */
async function generate() {
	try {
		busy.value = true;
		feedUrl.value = window.location.origin + await userService.createOpdsToken();
		enabled.value = true;
	} catch (e) {
		console.error("Error while creating OPDS feed link", e);
	} finally {
		busy.value = false;
	}
}

/** Confirms, then rotates the token (the old link stops working). */
function regenerate() {
	confirmationDialogController.showDialog(
		t(AppLabels.USERCONF_OPDS_REGENERATE),
		t(AppLabels.USERCONF_OPDS_REGENERATE_DESC),
		t(AppLabels.USERCONF_OPDS_REGENERATE)
	).then(generate);
}

/** Disables the feed (no confirmation: it is reversible by creating a new link). */
async function disable() {
	try {
		busy.value = true;
		await userService.revokeOpdsToken();
		enabled.value = false;
		feedUrl.value = "";
		appSnackbarController.show({message: t(AppLabels.SNACKBAR_OPDS_DISABLED)});
	} catch (e) {
		console.error("Error while disabling OPDS feed", e);
	} finally {
		busy.value = false;
	}
}

/** Copies the feed URL to the clipboard. */
async function copy() {
	await navigator.clipboard.writeText(feedUrl.value);
	appSnackbarController.show({message: t(AppLabels.SNACKBAR_OPDS_COPIED)});
}
</script>
