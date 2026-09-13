<template>
	<card-component
		:title="t(AppLabels.EBOOK_FILE)"
		icon="mdi-file-download-outline"
		:counter="files.length"
	>
		<template v-slot:actions>
			<v-btn
				@click="triggerFileSelect"
				density="comfortable"
				color="primary"
				class="text-none"
				:loading="loading"
				:disabled="loading"
			>
				{{ t(AppLabels.ADD) }}
			</v-btn>
		</template>

		<template v-slot:default>
			<div v-if="files.length > 0">
				<div
					v-for="file in files"
					:key="file.id"
					class="d-flex align-center my-3"
				>
					<v-icon size="28" class="mr-3" color="primary">{{ fileIcon(file) }}</v-icon>
					<div class="flex-grow-1" style="min-width: 0">
						<div class="text-truncate">{{ file.file_name }}</div>
						<div class="text-caption" style="color: var(--pb-text-muted)">
							{{ formattedSize(file) }} &middot; {{ formattedDate(file) }}
						</div>
					</div>
					<v-btn
						icon
						variant="text"
						density="compact"
						@click="previewFile = file"
					>
						<v-icon size="21">mdi-eye-outline</v-icon>
					</v-btn>
					<v-btn
						icon
						variant="text"
						density="compact"
						class="mx-1"
						:href="downloadUrl(file)"
					>
						<v-icon size="21">mdi-download</v-icon>
					</v-btn>
					<v-btn
						icon
						variant="text"
						density="compact"
						class="mr-4"
						:loading="deleteLoadingId === file.id"
						:disabled="deleteLoadingId !== null"
						@click="removeFile(file)"
					>
						<v-icon size="21" color="error">mdi-delete</v-icon>
					</v-btn>
				</div>
			</div>

			<template v-else>
				<v-hover v-slot="{ isHovering, props: hoverProps }">
					<div
						v-bind="hoverProps"
						class="pb-file-dropzone"
						:class="{'pb-file-dropzone-hover': isHovering}"
						@click="triggerFileSelect"
						@drop.prevent="handleDrop"
						@dragover.prevent
					>
						<v-progress-circular v-if="loading" indeterminate color="primary" size="28"/>
						<template v-else>
							<v-icon size="28" color="primary">mdi-tray-arrow-up</v-icon>
							<span class="text-caption text-center mt-1">{{ t(AppLabels.EBOOK_FILE_DRAG_AND_DROP) }}</span>
						</template>
					</div>
				</v-hover>
				<div class="text-caption mt-1" style="text-align: center; width: 100%; color: var(--pb-text-muted)">
					{{ t(AppLabels.EBOOK_FILE_HOVER_INFO) }}
				</div>
			</template>

			<input
				ref="fileInput"
				type="file"
				accept=".epub,.pdf,.mobi,.azw3"
				style="display: none"
				@change="handleFileSelect"
			/>

			<book-file-preview-dialog
				v-if="previewFile"
				:model-value="true"
				@update:model-value="(value) => { if (!value) previewFile = null }"
				:book="book"
				:file="previewFile"
			/>
		</template>
	</card-component>
</template>

<script setup lang="ts">
/**
 * Backed-up ebook files for a book, shown on the book detail view: a list
 * with one row per uploaded file (up to one per type - epub/pdf/mobi),
 * each with a preview (opens `BookFilePreviewDialog`), download and delete
 * action, plus an "add file" action - or, when empty, a click/drag-and-drop
 * dropzone. The uploaded file's type is inferred server-side, so "add file"
 * always just uploads: it replaces any existing file of the same type.
 */
import Book from "@/model/book/Book";
import CardComponent from "@/components/card/CardComponent.vue";
import BookFilePreviewDialog from "@/views/book/compoents/BookFilePreviewDialog.vue";
import {computed, ref, Ref} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {PATH_PREFIX} from "@/Constants";
import {IBookFile} from "@/types/book/IBookFile";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";
import {appSnackbarController, SnackbarType} from "@/components/appSnackbar/AppSnackbarController";

const {t} = useI18n();

interface Props {
	book: Book;
}

const props = defineProps<Props>();

const loading: Ref<boolean> = ref(false);
const deleteLoadingId: Ref<number | null> = ref(null);
const fileInput = ref<HTMLInputElement | null>(null);
const previewFile: Ref<IBookFile | null> = ref(null);

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB, matches the server-side limit

const files = computed(() => props.book.getFiles());

function fileIcon(file: IBookFile): string {
	if (file.file_type === "epub") return "mdi-book-open-page-variant-outline";
	if (file.file_type === "pdf") return "mdi-file-pdf-box";
	return "mdi-tablet";
}

function downloadUrl(file: IBookFile): string {
	return `${PATH_PREFIX}/book/${props.book.getId()}/file/${file.id}/download`;
}

function formattedSize(file: IBookFile): string {
	const kb = file.file_size / 1024;
	return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function formattedDate(file: IBookFile): string {
	return new Date(file.date_created).toLocaleDateString();
}

const triggerFileSelect = () => {
	fileInput.value?.click();
};

const handleFileSelect = (event: Event) => {
	const target = event.target as HTMLInputElement;
	if (target.files && target.files[0]) {
		loadFile(target.files[0]);
	}
	target.value = "";
};

const handleDrop = (event: DragEvent) => {
	const files = event.dataTransfer?.files;
	if (files && files[0]) {
		loadFile(files[0]);
	}
};

async function loadFile(selectedFile: File) {
	const name = selectedFile.name.toLowerCase();
	if (!name.endsWith(".epub") && !name.endsWith(".pdf") && !name.endsWith(".mobi") && !name.endsWith(".azw3")) {
		appSnackbarController.show({message: t(AppLabels.ONLY_EBOOK_FILES_ALLOWED), type: SnackbarType.ERROR});
		return;
	}

	if (selectedFile.size > MAX_FILE_SIZE) {
		appSnackbarController.show({message: t(AppLabels.FILE_TOO_LARGE), type: SnackbarType.ERROR});
		return;
	}

	try {
		loading.value = true;
		await props.book.uploadFile(selectedFile);
	} finally {
		loading.value = false;
	}
}

async function removeFile(file: IBookFile) {
	confirmationDialogController.showDialog(
		t(AppLabels.DELETE_FILE),
		t(AppLabels.DELETE_FILE_DESC),
		t(AppLabels.DELETE)
	).then(async () => {
		try {
			deleteLoadingId.value = file.id;
			await props.book.removeFile(file.id);
		} finally {
			deleteLoadingId.value = null;
		}
	})
}
</script>

<style scoped lang="scss">
.pb-file-dropzone {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 16px;
	border: 1px dashed var(--pb-border);
	border-radius: var(--pb-radius);
	cursor: pointer;
}

.pb-file-dropzone-hover {
	background-color: rgba(var(--v-theme-primary), 0.08);
}
</style>
