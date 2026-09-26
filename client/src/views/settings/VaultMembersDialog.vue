<template>
	<v-dialog
		v-model="dialog"
		max-width="700"
		:close-on-content-click="false"
	>
		<v-card>
			<v-card-title v-if="vault">{{vault.name}}</v-card-title>
			<v-divider></v-divider>

			<v-card-text>
				<!--
					Gated on `!vault` too, not just `loading`: this dialog
					mounts with modelValue already true (see VaultsCard.vue),
					so load() only starts once this component exists - there's
					a render before `vault` is populated even though `loading`
					starts true, and gating solely on a stale `loading` default
					previously left the dialog rendering nothing at all here.
				-->
				<div v-if="loading || !vault" class="d-flex justify-center my-6">
					<v-progress-circular indeterminate color="primary" />
				</div>

				<template v-else>
					<!-- Settings -->
					<p class="vault-section-title">{{t(AppLabels.VAULT_SETTINGS)}}</p>
					<v-text-field
						v-model="name"
						:label="t(AppLabels.NAME)"
						:disabled="!canManageSettings"
						density="compact"
						variant="outlined"
						hide-details
						class="mb-4"
					></v-text-field>
					<v-textarea
						v-model="description"
						:label="t(AppLabels.DESCRIPTION)"
						:disabled="!canManageSettings"
						density="compact"
						variant="outlined"
						rows="2"
						hide-details
						class="mb-4"
					></v-textarea>
					<div class="settings-row" style="margin-bottom: 8px">
						<div class="settings-row-text">
							<p style="font-size: 14px; font-weight: 530">{{t(AppLabels.USERCONF_LEASING)}}</p>
						</div>
						<v-switch
							v-model="leasingEnabled"
							:disabled="!canManageSettings"
							color="primary"
							density="compact"
							hide-details
						></v-switch>
					</div>

					<div v-if="canManageSettings" class="d-flex justify-end mb-2">
						<v-btn
							:disabled="!settingsDirty || savingSettings"
							:loading="savingSettings"
							color="primary"
							variant="tonal"
							size="small"
							class="text-none"
							@click="saveSettings()"
						>
							{{t(AppLabels.SAVE)}}
						</v-btn>
					</div>

					<v-divider class="my-4"></v-divider>

					<!-- Invite link -->
					<template v-if="canManageMembers">
						<p class="vault-section-title">{{t(AppLabels.VAULT_INVITE)}}</p>
						<p class="v-card-subtitle pl-0 mb-2" style="white-space: normal">{{t(AppLabels.VAULT_INVITE_DESC)}}</p>
						<v-text-field
							:model-value="inviteLink"
							readonly
							density="compact"
							variant="outlined"
							hide-details
							class="mb-4"
						>
							<template v-slot:append-inner>
								<v-icon size="20" style="cursor: pointer" @click="copyInviteLink()">mdi-content-copy</v-icon>
							</template>
						</v-text-field>

						<v-divider class="my-4"></v-divider>
					</template>

					<!-- Members -->
					<p class="vault-section-title">{{t(AppLabels.VAULT_MEMBERS)}}</p>
					<div class="vault-members-list">
						<div
							v-for="member in vault.users"
							:key="member.user_id"
							class="vault-member-row"
						>
							<v-icon size="22" class="vault-member-icon">mdi-account-circle-outline</v-icon>

							<div class="vault-member-text">
								<div class="vault-member-title">
									<span>{{member.name}}</span>
									<v-chip v-if="member.user_id === myUserId" size="x-small" variant="tonal" class="ml-2">{{t(AppLabels.VAULT_YOU)}}</v-chip>
									<v-chip
										v-if="member.status !== VaultUserStatus.ACCEPTED"
										size="x-small"
										:color="member.status === VaultUserStatus.PENDING ? 'warning' : 'error'"
										variant="tonal"
										class="ml-2"
									>
										{{member.status === VaultUserStatus.PENDING ? t(AppLabels.VAULT_STATUS_PENDING) : t(AppLabels.VAULT_STATUS_REJECTED)}}
									</v-chip>
								</div>
								<p class="v-card-subtitle pl-0 vault-member-subtitle">{{capitalize(member.role)}}</p>
							</div>

							<template v-if="canManageMembers && member.status === VaultUserStatus.PENDING">
								<v-btn
									icon="mdi-check"
									size="small"
									variant="tonal"
									color="success"
									class="mr-2"
									:loading="actingOnId === member.user_id"
									@click="approveOrReject(member, VaultUserStatus.ACCEPTED)"
								></v-btn>
								<v-btn
									icon="mdi-close"
									size="small"
									variant="tonal"
									color="error"
									:loading="actingOnId === member.user_id"
									@click="approveOrReject(member, VaultUserStatus.REJECTED)"
								></v-btn>
							</template>

							<template v-else>
								<v-select
									v-if="canManageMembers && member.user_id !== myUserId"
									:model-value="roleCodeFor(member)"
									:items="roleItems"
									density="compact"
									variant="outlined"
									hide-details
									style="max-width: 150px"
									class="mr-2"
									@update:model-value="(code: number) => changeRole(member, code)"
								></v-select>

								<v-btn
									v-if="canManageMembers || member.user_id === myUserId"
									variant="text"
									size="small"
									color="error"
									class="text-none"
									:loading="actingOnId === member.user_id"
									@click="removeOrLeave(member)"
								>
									{{member.user_id === myUserId ? t(AppLabels.VAULT_LEAVE) : t(AppLabels.REMOVE)}}
								</v-btn>
							</template>
						</div>
					</div>
				</template>
			</v-card-text>

			<v-divider></v-divider>

			<v-card-actions>
				<v-btn
					v-if="canManageSettings"
					variant="text"
					color="error"
					class="text-none"
					@click="deleteVault()"
				>
					{{t(AppLabels.DELETE_VAULT)}}
				</v-btn>
				<v-spacer></v-spacer>
				<v-btn
					variant="text"
					class="text-none"
					@click="dialog = false"
				>
					{{t(AppLabels.CLOSE)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>

	<!-- Shown when deleting is refused because the vault still has content -
		 lets the caller pick one of their other vaults to move it into first. -->
	<v-dialog v-model="transferDialogVisible" max-width="480" :close-on-content-click="false">
		<v-card>
			<v-card-title>{{t(AppLabels.VAULT_TRANSFER_TITLE)}}</v-card-title>
			<v-divider></v-divider>
			<v-card-text>
				<p class="mb-4" style="white-space: normal">{{t(AppLabels.VAULT_TRANSFER_DESC)}}</p>
				<v-select
					v-model="transferTargetId"
					:items="otherVaults.map((v) => ({title: v.name, value: v.id}))"
					:label="t(AppLabels.VAULT_TRANSFER_TARGET)"
					density="compact"
					variant="outlined"
					hide-details
				></v-select>
			</v-card-text>
			<v-divider></v-divider>
			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn variant="text" class="text-none" @click="transferDialogVisible = false">{{t(AppLabels.CLOSE)}}</v-btn>
				<v-btn
					variant="tonal"
					color="error"
					class="text-none"
					:disabled="transferTargetId === null"
					:loading="transferring"
					@click="confirmTransferAndDelete()"
				>
					{{t(AppLabels.VAULT_TRANSFER_CONFIRM)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Settings > Vaults > "Manage": one vault's full detail - editable
 * name/description/leasing preference (if `can_manage_settings`), its
 * shareable invite link (if `can_manage_members` - the only way anyone
 * joins a vault, see VaultJoinView.vue), and its member list with
 * approve/reject for pending join requests, a role picker, and
 * remove/leave. Opened from VaultsCard.vue's per-vault "Manage" button.
 */
import {computed, Ref, ref, watch} from 'vue';
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {i18n} from "@/plugins/i18n/i18n";
import {vaultService} from "@/service/vault/VaultService";
import {applicationService} from "@/service/ApplicationService";
import {vaultJoinRoute} from "@/router/routes/VaultJoinRoute";
import {appSnackbarController, SnackbarType} from "@/components/appSnackbar/AppSnackbarController";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";
import {errorDialogController} from "@/components/errorDialog/ErrorDialogController";
import IVaultInfo from "@/types/vault/IVaultInfo";
import IVault from "@/types/vault/IVault";
import {IVaultUser, VaultUserStatus} from "@/types/vault/IVaultUser";

interface Props {
	modelValue: boolean;
	vaultId: number;
}

const props = defineProps<Props>();

const {t} = useI18n();

const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void;
	/** Emitted after any change that could affect the vault list/active vault in VaultsCard.vue (rename, delete, leave). */
	(e: 'changed'): void;
}>();

const dialog = computed({
	get: () => props.modelValue,
	set: (val: boolean) => emit('update:modelValue', val),
});

const loading: Ref<boolean> = ref(true);
const vault: Ref<IVaultInfo | null> = ref(null);

const name: Ref<string> = ref("");
const description: Ref<string> = ref("");
const leasingEnabled: Ref<boolean> = ref(false);
const savingSettings: Ref<boolean> = ref(false);

const actingOnId: Ref<number | null> = ref(null);

const otherVaults: Ref<IVault[]> = ref([]);
const transferDialogVisible: Ref<boolean> = ref(false);
const transferTargetId: Ref<number | null> = ref(null);
const transferring: Ref<boolean> = ref(false);

const myUserId = applicationService.getUser().getId();

const myMembership = computed(() => vault.value?.users.find((u) => u.user_id === myUserId) ?? null);
const myRoleDefinition = computed(() => vault.value?.roles.find((r) => r.name === myMembership.value?.role) ?? null);
const canManageSettings = computed(() => myRoleDefinition.value?.can_manage_settings ?? false);
const canManageMembers = computed(() => myRoleDefinition.value?.can_manage_members ?? false);

const roleItems = computed(() => (vault.value?.roles ?? []).map((r) => ({title: capitalize(r.name), value: r.code})));

const settingsDirty = computed(() => {
	if (!vault.value) return false;
	return name.value !== vault.value.name
		|| description.value !== (vault.value.description ?? "")
		|| leasingEnabled.value !== vault.value.leasingEnabled;
});

const inviteLink = computed(() => vault.value ? `${window.location.origin}/app${vaultJoinRoute.getPath(vault.value.invitationUuid)}` : "");

// immediate: true - VaultsCard.vue mounts this component with modelValue
// already true (it sets managingVaultId and manageDialog in the same
// tick), so on the very first "Manage" click there's no false->true
// transition for a plain watch to ever see. Without this, load() never
// ran and the dialog rendered blank (v-card is gated on v-if="vault").
watch(() => props.modelValue, (open) => {
	if (open) {
		load();
	}
}, {immediate: true});

/**
 *
 */
async function load() {
	try {
		loading.value = true;
		vault.value = await vaultService.get(props.vaultId);
		name.value = vault.value.name;
		description.value = vault.value.description ?? "";
		leasingEnabled.value = vault.value.leasingEnabled;
	} finally {
		loading.value = false;
	}
}

/**
 *
 */
function capitalize(value: string): string {
	return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * The role picker's current value for a member - matched by role *name*
 * (`IVaultUser.role`) against the fetched role definitions, since the
 * member row itself only carries the name, not the numeric code.
 */
function roleCodeFor(member: IVaultUser): number | undefined {
	return vault.value?.roles.find((r) => r.name === member.role)?.code;
}

/**
 *
 */
async function saveSettings() {
	if (!vault.value) return;
	try {
		savingSettings.value = true;
		await vaultService.update(vault.value.id, name.value.trim(), description.value.trim() || undefined, leasingEnabled.value);
		appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_VAULT_UPDATED)});
		emit('changed');
		await load();
	} finally {
		savingSettings.value = false;
	}
}

/**
 *
 */
async function copyInviteLink() {
	try {
		await navigator.clipboard.writeText(inviteLink.value);
		appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_INVITE_LINK_COPIED)});
	} catch (e) {
		console.error("Error while copying invite link", e);
	}
}

/**
 *
 */
async function approveOrReject(member: IVaultUser, status: VaultUserStatus) {
	if (!vault.value) return;
	try {
		actingOnId.value = member.user_id;
		await vaultService.updateMember(vault.value.id, member.user_id, {status});
		appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_MEMBER_UPDATED)});
		await load();
	} finally {
		actingOnId.value = null;
	}
}

/**
 *
 */
async function changeRole(member: IVaultUser, role: number) {
	if (!vault.value) return;
	try {
		actingOnId.value = member.user_id;
		await vaultService.updateMember(vault.value.id, member.user_id, {role});
		appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_MEMBER_UPDATED)});
		await load();
	} finally {
		actingOnId.value = null;
	}
}

/**
 *
 */
function removeOrLeave(member: IVaultUser) {
	if (!vault.value) return;
	const isSelf = member.user_id === myUserId;

	confirmationDialogController.showDialog(
		isSelf ? t(AppLabels.VAULT_LEAVE) : t(AppLabels.VAULT_REMOVE_MEMBER),
		isSelf ? t(AppLabels.VAULT_LEAVE_DESC) : t(AppLabels.VAULT_REMOVE_MEMBER_DESC, {name: member.name}),
		isSelf ? t(AppLabels.VAULT_LEAVE) : t(AppLabels.REMOVE)
	).then(async () => {
		try {
			actingOnId.value = member.user_id;
			await vaultService.removeMember(vault.value!.id, member.user_id);
			appSnackbarController.show({message: i18n.global.t(isSelf ? AppLabels.SNACKBAR_VAULT_LEFT : AppLabels.SNACKBAR_MEMBER_REMOVED)});
			if (isSelf) {
				emit('changed');
				dialog.value = false;
				return;
			}
			await load();
		} finally {
			actingOnId.value = null;
		}
	});
}

/**
 * Deletes the vault, unless it still owns content - checked upfront via
 * getVaults()/removeVault() ordering on the server (see
 * VaultService.deleteVault): if the caller has no other vault at all,
 * there's nowhere to transfer content into, so that's reported directly
 * without even attempting the delete; otherwise a 409 here can only mean
 * "still has content", and the transfer picker (already knowing which
 * vaults are valid destinations) is opened instead.
 */
function deleteVault() {
	if (!vault.value) return;

	confirmationDialogController.showDialog(
		t(AppLabels.DELETE_VAULT),
		t(AppLabels.DELETE_VAULT_DESC),
		t(AppLabels.DELETE)
	).then(async () => {
		otherVaults.value = (await vaultService.list()).filter((v) => v.id !== vault.value!.id);
		if (otherVaults.value.length === 0) {
			appSnackbarController.show({message: i18n.global.t(AppLabels.VAULT_DELETE_ONLY_VAULT), type: SnackbarType.ERROR});
			return;
		}

		try {
			await vaultService.remove(vault.value!.id);
			finishDelete();
		} catch (e: any) {
			if (e.response?.status === 409) {
				transferTargetId.value = otherVaults.value[0].id;
				transferDialogVisible.value = true;
				return;
			}
			errorDialogController.showDialog(e);
		}
	});
}

/**
 * Retries the delete with the picked destination vault, after the vault
 * still had content (see deleteVault()) - the server moves everything into
 * it (deduping same-named categories/authors/customer groups) before
 * removing the now-empty source vault.
 */
async function confirmTransferAndDelete() {
	if (!vault.value || transferTargetId.value === null) return;
	try {
		transferring.value = true;
		await vaultService.remove(vault.value.id, transferTargetId.value);
		transferDialogVisible.value = false;
		finishDelete();
	} catch (e: any) {
		errorDialogController.showDialog(e);
	} finally {
		transferring.value = false;
	}
}

/**
 * Shared success path for both deleteVault() and confirmTransferAndDelete().
 */
function finishDelete() {
	appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_VAULT_DELETED)});
	emit('changed');
	dialog.value = false;
}
</script>

<style scoped lang="scss">
.settings-row {
	display: flex;
	align-items: center;
	width: 100%;
	min-width: 0;
}

.settings-row-text {
	flex: 1;
	padding-right: 80px;
	min-width: 0;
}

.vault-section-title {
	font-size: 13px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--pb-text-muted);
	margin: 0 0 10px;
}

.vault-members-list {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.vault-member-row {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 10px 0;
	border-bottom: 1px solid var(--pb-border);
}

.vault-member-row:last-child {
	border-bottom: none;
	padding-bottom: 0;
}

.vault-member-icon {
	color: var(--pb-text-muted);
	flex-shrink: 0;
}

.vault-member-text {
	flex: 1;
	min-width: 0;
}

.vault-member-title {
	display: flex;
	align-items: center;
	font-size: 14px;
	font-weight: 530;
	color: var(--pb-text);
}

.vault-member-subtitle {
	margin: 2px 0 0;
	font-size: 12px;
}

@media (max-width: 600px) {
	.vault-member-row {
		flex-wrap: wrap;
	}
}
</style>
