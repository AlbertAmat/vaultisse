<template>
	<v-dialog v-model="dialog" width="900">
		<v-card>
			<v-card-title>{{t(AppLabels.CUSTOMER_CARD)}}</v-card-title>
			<v-divider/>

			<v-card-text>
				<v-alert
					v-if="applicationService.getUser().isPublicInstitution()"
					color="primary"
					variant="tonal"
					density="compact"
					icon="mdi-shield-alert-outline"
					style="font-size: 13px"
					class="mb-4"
				>
					{{ t(AppLabels.PUBLIC_INSTITUTION_SENSITIVE_DATA_WARNING) }}
				</v-alert>

				<v-progress-linear v-if="!card" indeterminate/>

				<v-row v-else>
					<v-col cols="12" md="4">
						<v-file-input
							:label="t(AppLabels.CARD_PHOTO)"
							accept="image/png,image/jpeg"
							density="compact"
							variant="outlined"
							hide-details
							@update:model-value="pickPhoto"
						/>
						<v-btn
							v-if="card.photo"
							@click="removePhoto()"
							variant="text"
							color="error"
							density="compact"
							class="text-none mt-2"
						>
							{{t(AppLabels.USERCONF_REMOVE_IMAGE)}}
						</v-btn>
						<v-text-field
							v-model="card.member_since"
							:label="t(AppLabels.CARD_MEMBER_SINCE)"
							type="date"
							density="compact"
							variant="outlined"
							hide-details
							class="mt-4"
						/>
					</v-col>

					<v-col cols="12" md="8">
						<card-preview v-if="content" ref="preview" :content="content"/>
					</v-col>
				</v-row>
			</v-card-text>

			<v-divider/>
			<v-card-actions>
				<v-btn
					@click="download()"
					:disabled="!content"
					prepend-icon="mdi-download"
					class="text-none"
				>
					{{t(AppLabels.CARD_DOWNLOAD)}}
				</v-btn>
				<v-spacer/>
				<v-btn @click="dialog = false" class="text-none">{{t(AppLabels.CLOSE)}}</v-btn>
				<v-btn
					color="primary"
					variant="elevated"
					class="text-none"
					:disabled="!card || !card.member_since || saving"
					:loading="saving"
					@click="save()"
				>
					{{t(AppLabels.SAVE)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/** One customer's library card: set the photo and member-since date, preview it, download it for printing. */
import {computed, onMounted, ref, Ref} from "vue";
import {useI18n} from "vue-i18n";
import {ICardSettings, ICustomerCard} from "@vaultisse/types/customer/ICustomerCard";
import {api} from "@/plugins/api";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {applicationService} from "@/service/ApplicationService";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import CardPreview from "@/views/customers/components/CardPreview.vue";
import {downloadCardPdf} from "@/utils/customerCard";
import {readAsDataUrl} from "@/utils/readAsDataUrl";

const props = defineProps<{customerId: number, modelValue: boolean}>();
const emit = defineEmits<{(e: 'update:modelValue', value: boolean): void}>();
const {t} = useI18n();

const dialog = computed({
	get: () => props.modelValue,
	set: (val: boolean) => emit('update:modelValue', val),
});

const card: Ref<ICustomerCard | null> = ref(null);
const settings: Ref<ICardSettings | null> = ref(null);
const preview = ref<InstanceType<typeof CardPreview> | null>(null);
const saving = ref(false);
let photoFile: File | null = null;
let photoRemoved = false;

const content = computed(() => card.value && settings.value && card.value.member_since
	? {customer: {...card.value}, settings: settings.value, memberSinceLabel: t(AppLabels.CARD_MEMBER_SINCE)}
	: null);

async function pickPhoto(value: File | File[] | null) {
	const file = Array.isArray(value) ? value[0] : value;
	if (!file || !card.value) {
		return;
	}
	photoFile = file;
	photoRemoved = false;
	card.value.photo = await readAsDataUrl(file);
}

function removePhoto() {
	photoFile = null;
	photoRemoved = true;
	if (card.value) {
		card.value.photo = null;
	}
}

function download() {
	const canvas = preview.value?.getCanvas();
	if (canvas && card.value) {
		downloadCardPdf(canvas, `card-${card.value.name.replace(/[^\p{L}\p{N}]+/gu, "-")}`);
	}
}

async function save() {
	if (!card.value) {
		return;
	}
	const data = new FormData();
	data.set("member_since", card.value.member_since);
	if (photoFile) {
		data.set("photo", photoFile);
	} else if (photoRemoved) {
		data.set("remove_photo", "true");
	}
	try {
		saving.value = true;
		card.value = await api.customers.updateCard(props.customerId, data);
		photoFile = null;
		photoRemoved = false;
		appSnackbarController.show({message: t(AppLabels.SNACKBAR_CARD_SAVED)});
	} finally {
		saving.value = false;
	}
}

onMounted(async () => {
	[card.value, settings.value] = await Promise.all([api.customers.getCard(props.customerId), api.customers.getCardSettings()]);
});
</script>
