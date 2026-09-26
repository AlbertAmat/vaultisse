<template>
	<div class="vault-join-view">
		<v-card max-width="420" class="pa-2">
			<v-card-text class="text-center">
				<div v-if="loading" class="d-flex justify-center my-6">
					<v-progress-circular indeterminate color="primary" />
				</div>

				<template v-else-if="vault">
					<v-icon size="40" color="primary" class="mb-2">mdi-bookshelf</v-icon>
					<h2 class="pb-display mb-1">{{vault.name}}</h2>
					<p v-if="vault.description" class="v-card-subtitle pl-0 mb-4">{{vault.description}}</p>

					<v-alert v-if="requested" type="success" density="compact" class="mt-2 text-left">
						{{t(AppLabels.VAULT_JOIN_REQUESTED)}}
					</v-alert>
					<v-btn
						v-else
						:loading="joining"
						color="primary"
						variant="elevated"
						class="text-none mt-2"
						@click="join()"
					>
						{{t(AppLabels.VAULT_JOIN_REQUEST)}}
					</v-btn>
				</template>

				<template v-else>
					<v-icon size="40" color="error" class="mb-2">mdi-link-variant-off</v-icon>
					<p>{{t(AppLabels.VAULT_JOIN_INVALID)}}</p>
				</template>

				<v-btn variant="text" class="text-none mt-4" @click="goToApp()">
					{{t(AppLabels.NOT_FOUND_GO_HOME)}}
				</v-btn>
			</v-card-text>
		</v-card>
	</div>
</template>

<script setup lang="ts">
/**
 * `/app/vault/join/:uuid` - landing page for a vault's shareable invite
 * link (see VaultMembersDialog.vue's "Invite" section). Previews the
 * vault, then lets the caller request to join it at the least-privileged
 * role; a member with `can_manage_members` approves the request from
 * Settings > Vaults > Manage. Requires being logged in already (this whole
 * SPA is gated on that server-side), but not being an existing member.
 */
import {onMounted, ref} from "vue";
import {useRoute} from "vue-router";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import router from "@/router/Router";
import {settingsRoute} from "@/router/routes/SettingsRoute";
import {vaultService} from "@/service/vault/VaultService";
import IVaultInvitePreview from "@/types/vault/IVaultInvitePreview";

const route = useRoute();
const {t} = useI18n();

const loading = ref(true);
const joining = ref(false);
const requested = ref(false);
const vault = ref<IVaultInvitePreview | null>(null);

onMounted(async () => {
	try {
		vault.value = await vaultService.previewInvite(String(route.params.uuid));
	} catch (e) {
		console.error("Error while previewing vault invite", e);
		vault.value = null;
	} finally {
		loading.value = false;
	}
});

/**
 *
 */
async function join() {
	try {
		joining.value = true;
		await vaultService.join(String(route.params.uuid));
		requested.value = true;
	} catch (e) {
		console.error("Error while requesting to join vault", e);
	} finally {
		joining.value = false;
	}
}

/**
 *
 */
function goToApp() {
	router.push(settingsRoute.getPath());
}
</script>

<style scoped lang="scss">
.vault-join-view {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
	background: var(--pb-bg);
	padding: 16px;
}
</style>
