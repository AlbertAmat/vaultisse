<template>
	<div class="book-image-container">
		<v-hover v-slot="{ isHovering, props }">
			<v-card
				v-bind="props"
				style="width: 100%; padding: 0"
				variant="text"
				@drop.prevent="handleDrop"
				@dragover.prevent
				@click="triggerFileSelect"
			>
				<v-img
					v-if="hasImage"
					cover
					:aspect-ratio="2 / 3"
					:src="book.getImageUrl()!"
					@error="imageLoadFailed = true"
				>
					<v-expand-transition>
						<div
							v-if="isHovering || loading"
							class="book-image-hover"
						>
							<v-progress-circular
								v-if="loading"
								color="white"
								size="60"
								indeterminate
							/>

							<template v-else>
								<v-icon size="60">mdi-plus</v-icon>
								<span style="font-size: 20px; font-weight: bold; padding: 0 20px; text-align: center">{{t(AppLabels.IMAGE_DRAG_AND_DROP)}}</span>
							</template>
						</div>
					</v-expand-transition>
				</v-img>

				<!-- No cover set (or it failed to load): a clear, clickable dropzone instead of a near-invisible placeholder image -->
				<div
					v-else
					class="book-image-empty"
					:class="{ 'book-image-empty-hover': isHovering }"
				>
					<v-progress-circular
						v-if="loading || findingCover"
						color="primary"
						size="40"
						indeterminate
					/>

					<template v-else>
						<v-icon size="36" color="primary">mdi-book-outline</v-icon>
						<span class="book-image-empty-label">{{t(AppLabels.IMAGE_DRAG_AND_DROP)}}</span>

						<v-btn
							v-if="book.hasIsbn()"
							size="small"
							variant="tonal"
							color="primary"
							prepend-icon="mdi-cloud-search-outline"
							@click.stop="handleFindCover"
						>
							{{t(AppLabels.FIND_COVER)}}
						</v-btn>
					</template>
				</div>

				<!-- Hidden file input for click selection -->
				<input
					ref="fileInput"
					type="file"
					accept="image/*"
					style="display: none"
					@change="handleFileSelect"
				/>
			</v-card>
		</v-hover>
		<div style="text-align: center; width: 100%; color: var(--pb-text-muted); font-size: 14px">{{t(AppLabels.BOOK_HOVER_INFO)}}</div>
	</div>
</template>

<script setup lang="ts">
/**
 * Book cover on the book detail view: click or drag-and-drop an image
 * to replace it (via `Book.changeImage`); shows a dashed dropzone in
 * place of the cover when there's no image set or it fails to load.
 */
import Book from "@/model/book/Book";
import {computed, ref, Ref} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

const {t} = useI18n();

interface Props {
	book: Book;
}

const props = defineProps<Props>();

const loading: Ref<boolean> = ref(false);

/** Set while a "find cover" lookup is in flight. */
const findingCover: Ref<boolean> = ref(false);

/** Set when the current cover URL fails to load; reset on every new upload attempt. */
const imageLoadFailed: Ref<boolean> = ref(false);

const hasImage = computed(() => !!props.book.getImageUrl() && !imageLoadFailed.value);

const fileInput = ref<HTMLInputElement | null>(null);

// Trigger hidden file input
const triggerFileSelect = () => {
	fileInput.value?.click();
};

// Handle file selected via click
const handleFileSelect = (event: Event) => {
	const target = event.target as HTMLInputElement;
	if (target.files && target.files[0]) {
		loadImage(target.files[0]);
	}
};

// Handle drag & drop
const handleDrop = (event: DragEvent) => {
	const files = event.dataTransfer?.files;
	if (files && files[0]) {
		loadImage(files[0]);
	}
};

// Look up a cover online for this book (no local file involved)
async function handleFindCover() {
	try {
		findingCover.value = true;
		await props.book.findCover();
	} finally {
		findingCover.value = false;
	}
}

// Read and display the selected image
async function loadImage(file: File) {
	try {
		loading.value = true;
		imageLoadFailed.value = false;
		await props.book.changeImage(file);
	} finally {
		loading.value = false;
	}
};
</script>

<style scoped lang="scss">
.book-image-container {
	max-width: 240px;
	margin: 0 auto;
}

/* Above the `md` breakpoint the image sits in its own narrow sidebar
   column, so let it fill that column instead of staying capped. */
@media (min-width: 960px) {
	.book-image-container {
		max-width: none;
		margin: 0;
	}
}

.book-image-hover {
	height: 100%;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-direction: column;
	color: white;
	cursor: pointer;
	background-color: rgba(var(--v-theme-primary), 0.92);
}

.book-image-empty {
	aspect-ratio: 2 / 3;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 16px;
	text-align: center;
	color: var(--pb-text-muted);
	background: var(--pb-surface-alt);
	border: 1px dashed var(--pb-border-strong);
	border-radius: var(--pb-radius);
	cursor: pointer;
}

.book-image-empty-hover {
	border-color: rgb(var(--v-theme-primary));
	background-color: rgba(var(--v-theme-primary), 0.08);
}

.book-image-empty-label {
	font-size: 13px;
	font-weight: 500;
}
</style>
