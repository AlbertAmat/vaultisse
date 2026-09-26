<template>
	<settings-card :title="t(AppLabels.VAULTS)">
		<p class="v-card-subtitle pl-0 mb-4" style="white-space: normal">{{t(AppLabels.VAULTS_DESC)}}</p>

		<div v-if="loading" class="d-flex justify-center my-6">
			<v-progress-circular indeterminate color="primary" />
		</div>

		<empty-state
			v-else-if="vaults.length === 0"
			compact
			icon="mdi-bookshelf"
			:title="t(AppLabels.VAULTS_EMPTY)"
		/>

		<div v-else class="vaults-list">
			<div
				v-for="vault in vaults"
				:key="vault.id"
				class="vaults-row"
			>
				<v-icon size="22" class="vaults-row-icon">mdi-bookshelf</v-icon>

				<div class="vaults-row-text">
					<div class="vaults-row-title">
						<span>{{vault.name}}</span>
						<v-chip v-if="isActive(vault)" size="x-small" color="primary" variant="tonal" class="ml-2">
							{{t(AppLabels.VAULT_ACTIVE)}}
						</v-chip>
					</div>
					<p v-if="vault.description" class="v-card-subtitle pl-0 vaults-row-subtitle">{{vault.description}}</p>
				</div>

				<v-btn
					v-if="!isActive(vault)"
					:loading="switchingId === vault.id"
					:disabled="switchingId !== null"
					variant="text"
					size="small"
					class="text-none mr-2"
					@click="switchVault(vault)"
				>
					{{t(AppLabels.VAULT_SWITCH)}}
				</v-btn>

				<v-btn
					variant="tonal"
					size="small"
					class="text-none"
					@click="openManage(vault)"
				>
					{{t(AppLabels.VAULT_MANAGE)}}
				</v-btn>
			</div>
		</div>

		<v-btn
			variant="tonal"
			class="text-none mt-4"
			prepend-icon="mdi-plus"
			@click="createDialog = true"
		>
			{{t(AppLabels.ADD_VAULT)}}
		</v-btn>

		<vault-dialog v-model="createDialog" @created="onVaultCreated" />
		<vault-members-dialog
			v-if="managingVaultId !== null"
			v-model="manageDialog"
			:vault-id="managingVaultId"
			@changed="refresh"
		/>
	</settings-card>
</template>

<script setup lang="ts">
/**
 * Settings > Vaults (issue #7, multi-user vault sharing): lists every
 * vault the caller belongs to, lets them switch which one is "active"
 * (what every catalog resource - books, categories, etc. - is scoped to
 * server-side), create a new one, and open VaultMembersDialog.vue to
 * manage an existing vault's settings and members.
 */
import {onMounted, Ref, ref} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {i18n} from "@/plugins/i18n/i18n";
import SettingsCard from "@/views/settings/SettingsCard.vue";
import EmptyState from "@/components/emptyState/EmptyState.vue";
import VaultDialog from "@/views/settings/VaultDialog.vue";
import VaultMembersDialog from "@/views/settings/VaultMembersDialog.vue";
import {vaultService} from "@/service/vault/VaultService";
import {applicationService} from "@/service/ApplicationService";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import IVault from "@/types/vault/IVault";

const {t} = useI18n();

const loading = ref(true);
const vaults: Ref<IVault[]> = ref([]);
const switchingId: Ref<number | null> = ref(null);
const createDialog = ref(false);
const manageDialog = ref(false);
const managingVaultId: Ref<number | null> = ref(null);

onMounted(refresh);

/**
 *
 */
async function refresh() {
	try {
		loading.value = true;
		vaults.value = await vaultService.list();
	} catch (e) {
		console.error("Error while fetching vaults", e);
	} finally {
		loading.value = false;
	}
}

/**
 *
 */
function isActive(vault: IVault): boolean {
	return vault.id === applicationService.getUser().getActiveVaultId();
}

/**
 *
 */
async function switchVault(vault: IVault) {
	try {
		switchingId.value = vault.id;
		await applicationService.getUser().switchVault(vault.id);
		appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_VAULT_SWITCHED)});
		// Every other view's data is scoped to the active vault - a full
		// reload is the simplest way to make sure nothing on screen is
		// still showing the previous vault's data.
		window.location.reload();
	} catch (e) {
		console.error("Error while switching vault", e);
		switchingId.value = null;
	}
}

/**
 *
 */
function openManage(vault: IVault) {
	managingVaultId.value = vault.id;
	manageDialog.value = true;
}

/**
 *
 */
function onVaultCreated(vault: IVault) {
	vaults.value.push(vault);
}
</script>

<style scoped lang="scss">
.vaults-list {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.vaults-row {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 10px 0;
	border-bottom: 1px solid var(--pb-border);
}

.vaults-row:last-child {
	border-bottom: none;
	padding-bottom: 0;
}

.vaults-row-icon {
	color: var(--pb-text-muted);
	flex-shrink: 0;
}

.vaults-row-text {
	flex: 1;
	min-width: 0;
}

.vaults-row-title {
	display: flex;
	align-items: center;
	font-size: 14px;
	font-weight: 530;
	color: var(--pb-text);
}

.vaults-row-subtitle {
	margin: 2px 0 0;
	font-size: 12px;
}

@media (max-width: 600px) {
	.vaults-row {
		flex-wrap: wrap;
	}
}
</style>
