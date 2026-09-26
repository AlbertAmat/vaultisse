<template>
	<v-menu>
		<template v-slot:activator="{ props }">
			<v-btn
				v-bind="props"
				variant="text"
				class="d-flex align-center text-none px-2 vault-switcher-btn"
				:loading="switchingId !== null"
			>
				<v-icon size="20" class="mr-2">mdi-bookshelf</v-icon>
				<span class="vault-switcher-name">{{activeVaultName}}</span>
				<v-icon>mdi-chevron-down</v-icon>
			</v-btn>
		</template>

		<v-card min-width="240">
			<v-list nav slim density="compact" class="py-1">
				<v-list-item
					v-for="vault in vaults"
					:key="vault.id"
					density="compact"
					@click="switchVault(vault)"
				>
					<template v-slot:prepend>
						<v-icon size="18">mdi-bookshelf</v-icon>
					</template>
					<v-list-item-title>{{vault.name}}</v-list-item-title>
					<template v-if="vault.id === activeVaultId" v-slot:append>
						<v-icon size="18" color="primary">mdi-check</v-icon>
					</template>
				</v-list-item>
			</v-list>

			<v-divider></v-divider>

			<v-list nav slim density="compact" class="py-1">
				<v-list-item :to="settingsRoute.getPath()" density="compact">
					<template v-slot:prepend>
						<v-icon size="18">mdi-cog-outline</v-icon>
					</template>
					<v-list-item-title>{{t(AppLabels.VAULTS)}}</v-list-item-title>
				</v-list-item>
			</v-list>
		</v-card>
	</v-menu>
</template>

<script setup lang="ts">
/**
 * App-bar vault switcher: shows the caller's active vault and lets them
 * jump to any other vault they belong to in one click (see Settings >
 * Vaults, VaultsCard.vue, for the full management UI - this is just the
 * quick-switch shortcut). Every catalog resource is scoped to the active
 * vault server-side, so switching reloads the page - same as VaultsCard.vue.
 */
import {onMounted, computed, Ref, ref} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {i18n} from "@/plugins/i18n/i18n";
import {settingsRoute} from "@/router/routes/SettingsRoute";
import {vaultService} from "@/service/vault/VaultService";
import {applicationService} from "@/service/ApplicationService";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import IVault from "@/types/vault/IVault";

const {t} = useI18n();

const vaults: Ref<IVault[]> = ref([]);
const switchingId: Ref<number | null> = ref(null);

const activeVaultId = computed(() => applicationService.getUser().getActiveVaultId());
const activeVaultName = computed(() => vaults.value.find((v) => v.id === activeVaultId.value)?.name ?? "");

onMounted(async () => {
	try {
		vaults.value = await vaultService.list();
	} catch (e) {
		console.error("Error while fetching vaults", e);
	}
});

/**
 *
 */
async function switchVault(vault: IVault) {
	if (vault.id === activeVaultId.value) {
		return;
	}

	try {
		switchingId.value = vault.id;
		await applicationService.getUser().switchVault(vault.id);
		appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_VAULT_SWITCHED)});
		// Every view's data is scoped to the active vault server-side - a
		// full reload is the simplest way to make sure nothing on screen is
		// still showing the previous vault's data.
		window.location.reload();
	} catch (e) {
		console.error("Error while switching vault", e);
		switchingId.value = null;
	}
}
</script>

<style scoped lang="scss">
.vault-switcher-btn {
	max-width: 220px;
}

.vault-switcher-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 140px;
}

@media (max-width: 600px) {
	.vault-switcher-name {
		display: none;
	}

	.vault-switcher-btn {
		max-width: none;
		min-width: 0;
		padding: 0 !important;
	}

	.vault-switcher-btn :deep(.mr-2) {
		margin-right: 0 !important;
	}
}
</style>
