<template>
	<v-dialog v-model="dialog" width="1000">
		<v-card>
			<v-card-title>{{t(AppLabels.CARD_SETUP)}}</v-card-title>
			<v-divider/>

			<v-card-text>
				<v-row>
					<v-col cols="12" md="5">
						<template v-for="number in [1, 2]" :key="number">
							<v-text-field
								v-model="form[number === 1 ? 'field1_label' : 'field2_label']"
								:label="t(AppLabels.CARD_FIELD_LABEL, {number})"
								maxlength="30"
								density="compact"
								variant="outlined"
								hide-details
								class="mb-3"
							/>
							<v-text-field
								v-model="form[number === 1 ? 'field1_value' : 'field2_value']"
								:label="t(AppLabels.CARD_FIELD_VALUE, {number})"
								maxlength="60"
								density="compact"
								variant="outlined"
								hide-details
								class="mb-5"
							/>
						</template>

						<v-file-input
							:label="t(AppLabels.CARD_BACKGROUND)"
							accept="image/png,image/jpeg"
							density="compact"
							variant="outlined"
							hide-details
							@update:model-value="pickBackground"
						/>
						<v-btn
							v-if="form.background"
							@click="removeBackground()"
							variant="text"
							color="error"
							density="compact"
							class="text-none mt-2"
						>
							{{t(AppLabels.USERCONF_REMOVE_IMAGE)}}
						</v-btn>
					</v-col>

					<v-col cols="12" md="7">
						<card-preview :content="content"/>
					</v-col>
				</v-row>
			</v-card-text>

			<v-divider/>
			<v-card-actions>
				<v-spacer/>
				<v-btn @click="dialog = false" class="text-none">{{t(AppLabels.CLOSE)}}</v-btn>
				<v-btn
					color="primary"
					variant="elevated"
					class="text-none"
					:loading="loading"
					:disabled="loading"
					@click="save()"
				>
					{{t(AppLabels.SAVE)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/** Sets up the vault's library card: two custom fields and a background, with a live preview. */
import {computed, onMounted, reactive, ref} from "vue";
import {useI18n} from "vue-i18n";
import {ICardSettings} from "@vaultisse/types/customer/ICustomerCard";
import {api} from "@/plugins/api";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import CardPreview from "@/views/customers/components/CardPreview.vue";
import {readAsDataUrl} from "@/utils/readAsDataUrl";

const props = defineProps<{modelValue: boolean}>();
const emit = defineEmits<{(e: 'update:modelValue', value: boolean): void}>();
const {t} = useI18n();

const dialog = computed({
	get: () => props.modelValue,
	set: (val: boolean) => emit('update:modelValue', val),
});

const form = reactive<ICardSettings>({field1_label: null, field1_value: null, field2_label: null, field2_value: null, background: null, photos_allowed: false});
const loading = ref(true);
let backgroundFile: File | null = null;
let backgroundRemoved = false;

/** A made-up customer, so the preview shows where everything lands. */
const content = computed(() => ({
	customer: {uuid: "00000000-0000-4000-8000-000000000000", name: t(AppLabels.NAME), group_name: t(AppLabels.GROUP), member_since: new Date().toISOString().slice(0, 10), photo: null},
	settings: {...form},
	memberSinceLabel: t(AppLabels.CARD_MEMBER_SINCE),
}));

async function pickBackground(value: File | File[] | null) {
	const file = Array.isArray(value) ? value[0] : value;
	if (!file) {
		return;
	}
	backgroundFile = file;
	backgroundRemoved = false;
	form.background = await readAsDataUrl(file);
}

function removeBackground() {
	backgroundFile = null;
	backgroundRemoved = true;
	form.background = null;
}

async function save() {
	const data = new FormData();
	for (const key of ["field1_label", "field1_value", "field2_label", "field2_value"] as const) {
		data.set(key, form[key] ?? "");
	}
	if (backgroundFile) {
		data.set("background", backgroundFile);
	} else if (backgroundRemoved) {
		data.set("remove_background", "true");
	}
	try {
		loading.value = true;
		await api.customers.saveCardSettings(data);
		appSnackbarController.show({message: t(AppLabels.SNACKBAR_CARD_SAVED)});
		dialog.value = false;
	} finally {
		loading.value = false;
	}
}

onMounted(async () => {
	// Save stays disabled if this fails, so existing settings can't be blanked.
	Object.assign(form, await api.customers.getCardSettings());
	loading.value = false;
});
</script>
