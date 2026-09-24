<template>
	<v-dialog
		v-model="dialog"
		width="500"
	>
		<v-card>
			<v-card-title>
				{{t(AppLabels.ADD_VAULT)}}
			</v-card-title>

			<v-divider></v-divider>

			<v-card-text>
				<v-text-field
					v-model="name"
					:label="t(AppLabels.NAME)"
					density="compact"
					variant="outlined"
					autofocus
					hide-details
					class="mb-4"
				></v-text-field>
				<v-textarea
					v-model="description"
					:label="t(AppLabels.DESCRIPTION)"
					density="compact"
					variant="outlined"
					rows="2"
					hide-details
				></v-textarea>
			</v-card-text>

			<v-divider></v-divider>

			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn
					variant="text"
					@click="closeDialog()"
					class="text-none"
				>
					{{t(AppLabels.CLOSE)}}
				</v-btn>
				<v-btn
					color="primary"
					variant="elevated"
					:disabled="name.trim().length === 0 || loading"
					:loading="loading"
					@click="save()"
					class="text-none"
				>
					{{t(AppLabels.ADD)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Create dialog for a new vault (shared library, issue #7). The caller
 * becomes its first (admin) member - see VaultsCard.vue for the list this
 * feeds into and VaultMembersDialog.vue for editing an existing vault's
 * own settings.
 */
import {computed, Ref, ref} from 'vue';
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {vaultService} from "@/service/vault/VaultService";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import {i18n} from "@/plugins/i18n/i18n";
import IVault from "@/types/vault/IVault";

interface Props {
	modelValue: boolean;
}

const props = defineProps<Props>();

const {t} = useI18n();

const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void;
	(e: 'created', vault: IVault): void;
}>();

/**
 *
 */
const dialog = computed({
	get: () => props.modelValue,
	set: (val: boolean) => emit('update:modelValue', val),
});

/**
 *
 */
const loading: Ref<boolean> = ref(false);

/**
 *
 */
const name: Ref<string> = ref("");

/**
 *
 */
const description: Ref<string> = ref("");

/**
 *
 */
async function save() {
	try {
		loading.value = true;
		const vault = await vaultService.create(name.value.trim(), description.value.trim() || undefined);
		appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_VAULT_CREATED)});
		emit('created', vault);
		closeDialog();
	} finally {
		loading.value = false;
	}
}

/**
 *
 */
function closeDialog() {
	name.value = "";
	description.value = "";
	dialog.value = false;
}
</script>
