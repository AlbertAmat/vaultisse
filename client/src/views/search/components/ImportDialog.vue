<template>
	<v-dialog
		v-model="dialog"
		width="620"
		scrollable
		persistent
	>
		<v-card>
			<v-card-title class="d-flex" style="align-items: center">
				{{t(AppLabels.IMPORT)}}

				<v-spacer></v-spacer>

				<v-btn
					@click="dialog = false"
					variant="text"
					icon
					density="comfortable"
				>
					<v-icon>mdi-close</v-icon>
				</v-btn>
			</v-card-title>
			<v-divider></v-divider>

			<v-card-text>
				<v-card-subtitle class="px-0" style="white-space: normal">
					{{t(AppLabels.IMPORT_LIBRARY_DESC)}}
				</v-card-subtitle>

				<div class="pb-eyebrow mt-4 mb-2">{{t(AppLabels.IMPORT_SELECT_ORIGIN)}}</div>

				<div class="pb-import-origins">
					<v-card
						v-for="opt in origins"
						:key="opt.value"
						variant="outlined"
						class="pb-import-origin-card"
						:class="{ 'pb-import-origin-card-active': origin === opt.value }"
						@click="origin = opt.value"
					>
						<v-icon size="26" color="primary">{{opt.icon}}</v-icon>
						<div class="pb-import-origin-card-title">{{opt.title}}</div>
						<div class="pb-import-origin-card-desc">{{opt.desc}}</div>
					</v-card>
				</div>

				<v-btn
					v-if="origin === 'vaultisse'"
					variant="text"
					density="compact"
					size="small"
					class="text-none px-0 mt-1"
					prepend-icon="mdi-download-outline"
					:href="vaultisseTemplateUrl"
				>
					{{t(AppLabels.IMPORT_DOWNLOAD_TEMPLATE)}}
				</v-btn>

				<template v-if="origin">
					<v-file-upload
						v-model="file"
						density="compact"
						:title="t(AppLabels.IMPORT_DROPZONE_TITLE)"
						icon="mdi-file-delimited-outline"
						clearable
						class="mt-4"
					></v-file-upload>

					<div class="pb-import-max-size" :class="{ 'pb-import-max-size-error': fileTooLarge }">
						<v-icon v-if="fileTooLarge" size="15" color="error" class="mr-1">mdi-alert-circle-outline</v-icon>
						{{ fileTooLarge ? t(AppLabels.IMPORT_FILE_TOO_LARGE, {maxSizeMb}) : t(AppLabels.IMPORT_MAX_SIZE, {maxSizeMb}) }}
					</div>
				</template>
			</v-card-text>

			<v-divider></v-divider>

			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn
					variant="text"
					class="text-none"
					@click="dialog = false"
					:disabled="loading"
				>
					{{t(AppLabels.CANCEL)}}
				</v-btn>
				<v-btn
					color="primary"
					variant="elevated"
					class="text-none mr-4"
					:loading="loading"
					:disabled="disableImport"
					@click="runImport()"
				>
					{{t(AppLabels.IMPORT)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * "Import library" dialog: pick which service the CSV was exported from
 * (Vaultisse's own template, or a Goodreads export), drop/browse the file,
 * then bulk-create books from it via `importService.importLibrary`. The
 * server reports per-row outcomes rather than failing the whole request, so
 * any 200 response (even with some rows skipped/failed) is treated as
 * success here and just surfaces the imported count.
 */
import {computed, ref, Ref, watch} from "vue";
import { VFileUpload } from 'vuetify/labs/VFileUpload'
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {applicationService} from "@/service/ApplicationService";
import {importService} from "@/service/import/ImportService";
import {appSnackbarController, SnackbarType} from "@/components/appSnackbar/AppSnackbarController";
import {ImportOrigin} from "@/types/import/IImportResult";
import {PATH_PREFIX} from "@/Constants";

interface Props {
	modelValue: boolean
}

const props = defineProps<Props>();

const {t} = useI18n();

const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void
	(e: 'imported'): void
}>()

const dialog = computed({
	get() {
		return props.modelValue;
	},
	set(value: boolean) {
		emit("update:modelValue", value)
	}
});

const loading: Ref<boolean> = ref(false);

const origin: Ref<ImportOrigin | null> = ref(null);

const file: Ref<File | undefined> = ref(undefined);

const origins = computed(() => [
	{
		value: "vaultisse" as ImportOrigin,
		title: t(AppLabels.IMPORT_ORIGIN_VAULTISSE),
		desc: t(AppLabels.IMPORT_ORIGIN_VAULTISSE_DESC),
		icon: "mdi-bookshelf"
	},
	{
		value: "goodreads" as ImportOrigin,
		title: t(AppLabels.IMPORT_ORIGIN_GOODREADS),
		desc: t(AppLabels.IMPORT_ORIGIN_GOODREADS_DESC),
		icon: "mdi-goodreads"
	}
]);

/** Server-configured limit (`MAX_IMPORT_FILE_SIZE_MB`), fetched into `applicationService` at app boot - see `GET /app/policy`. */
const maxSizeMb = computed(() => applicationService.getMaxImportFileSizeMb());

/** `GET /import/template/vaultisse` (see `ImportRoute.ts`) - a blank starting CSV with the right headers, since there's no export to convert unlike Goodreads. */
const vaultisseTemplateUrl = `${PATH_PREFIX}/import/template/vaultisse`;

const fileTooLarge = computed(() => {
	return !!file.value && file.value.size > maxSizeMb.value * 1024 * 1024;
});

const disableImport = computed(() => {
	return loading.value || !origin.value || !file.value || fileTooLarge.value;
});

async function runImport() {
	if (!origin.value || !file.value || fileTooLarge.value) return;

	try {
		loading.value = true;
		const result = await importService.importLibrary(origin.value, file.value);
		appSnackbarController.show({message: t(AppLabels.SNACKBAR_IMPORT_SUCCESS, {count: result.imported})});
		emit("imported");
		dialog.value = false;
	} finally {
		loading.value = false;
	}
}

// Reject anything that isn't a CSV client-side too - the server also
// enforces this (fileFilter in ImportRoute.ts), but catching it immediately
// avoids a round-trip for an obviously wrong file.
watch(() => file.value, (selected) => {
	if (selected && !selected.name.toLowerCase().endsWith(".csv")) {
		appSnackbarController.show({message: t(AppLabels.IMPORT_ONLY_CSV_ALLOWED), type: SnackbarType.ERROR})
		file.value = undefined;
	}
})

// Reset all local state whenever the dialog closes, so reopening it starts fresh.
watch(() => dialog.value, () => {
	if (!dialog.value) {
		loading.value = false;
		origin.value = null;
		file.value = undefined;
	}
})
</script>

<style scoped>
.pb-import-origins {
	display: flex;
	gap: 12px;
	flex-wrap: wrap;
}

:deep(.v-file-upload) {
	padding: 24px 16px;
}

:deep(.v-file-upload-title) {
	font-size: 14px;
	font-weight: 600;
}

:deep(.v-file-upload-icon) {
	font-size: 28px;
	margin-bottom: 6px;
}

.pb-import-origin-card {
	flex: 1 1 200px;
	padding: 16px;
	cursor: pointer;
	border-color: var(--pb-border) !important;
}

.pb-import-origin-card-active {
	border-color: rgb(var(--v-theme-primary)) !important;
	background: rgba(var(--v-theme-primary), 0.06);
}

.pb-import-origin-card-title {
	margin-top: 8px;
	font-weight: 600;
	font-size: 14px;
	color: var(--pb-text);
}

.pb-import-origin-card-desc {
	margin-top: 2px;
	font-size: 12.5px;
	color: var(--pb-text-muted);
}

.pb-import-max-size {
	margin-top: 8px;
	font-size: 12.5px;
	color: var(--pb-text-muted);
	display: flex;
	align-items: center;
}

.pb-import-max-size-error {
	color: rgb(var(--v-theme-error));
}
</style>
