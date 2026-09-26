<template>
	<page-component :model="model">
		<template v-slot:append>
			<v-menu v-if="!editing">
				<template v-slot:activator="{ props: readingStatusMenuProps }">
					<v-btn
						v-bind="readingStatusMenuProps"
						variant="outlined"
						density="comfortable"
						class="text-none mr-2"
						:prepend-icon="readingStatusIcon"
						append-icon="mdi-chevron-down"
						:loading="loadingReadingStatus"
						small
					>
						{{ readingStatusName || t(AppLabels.READING_STATUS) }}
					</v-btn>
				</template>

				<v-list density="compact">
					<v-list-item
						v-for="option in readingStatusJson()"
						:key="option.value"
						@click="quickSetReadingStatus(option.value)"
					>
						<template v-slot:prepend>
							<v-icon size="18">{{ readingStatus === option.value ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank' }}</v-icon>
						</template>
						<v-list-item-title>{{ option.text }}</v-list-item-title>
					</v-list-item>

					<template v-if="readingStatus !== null">
						<v-divider class="my-1"></v-divider>
						<v-list-item @click="quickSetReadingStatus(null)">
							<v-list-item-title>{{ t(AppLabels.CLEAR) }}</v-list-item-title>
						</v-list-item>
					</template>
				</v-list>
			</v-menu>

			<v-btn
				variant="outlined"
				density="comfortable"
				icon
				class="text-none mr-2"
				color="error"
				@click="deleteBook()"
				:loading="loadingDelete"
				:disabled="loadingDelete"
				small
			>
				<v-icon>mdi-delete-outline</v-icon>
			</v-btn>

			<template v-if="editing">
				<v-btn
					class="text-none mr-2"
					variant="text"
					@click="cancelEditing()"
					:disabled="loadingUpdate"
					small
				>
					{{t(AppLabels.CANCEL)}}
				</v-btn>
				<v-btn
					class="text-none"
					color="primary"
					:disabled="!hasChanges"
					@click="updateBook()"
					:loading="loadingUpdate"
					small
					variant="elevated"
				>
					{{t(AppLabels.SAVE)}}
				</v-btn>
			</template>

			<v-btn
				v-else
				class="text-none"
				color="primary"
				variant="elevated"
				small
				prepend-icon="mdi-pencil-outline"
				@click="startEditing()"
			>
				{{t(AppLabels.EDIT)}}
			</v-btn>
		</template>

		<template v-slot:default>
			<div style="height: 100%;">
				<!-- ================================================================== -->
				<!-- BOOK														-->
				<!-- ================================================================== -->
				<card-component
					:title="t(AppLabels.BOOK)"
					icon="mdi-book"
					dense
					class="mb-4 pb-hero-card"
				>
					<template v-slot:default>
						<!-- ============================================== -->
						<!-- VIEW MODE									-->
						<!-- ============================================== -->
						<div v-if="!editing" class="pb-hero pt-2">
							<book-image :book="model.getBook()"/>

							<div class="pb-hero-main">
								<h2 class="pb-display pb-book-view-title">{{ name || t(AppLabels.NAME) }}</h2>

								<div v-if="authors.length" class="pb-book-view-authors">
									<v-chip v-for="author in authors" :key="author.value" density="comfortable" variant="outlined" size="small">
										{{ author.text }}
									</v-chip>
								</div>

								<span v-if="isbn" class="pb-mono pb-book-view-isbn">ISBN {{ isbn }}</span>

								<div class="pb-book-view-grid">
									<div class="pb-book-view-field">
										<div class="pb-eyebrow">{{t(AppLabels.CATEGORY)}}</div>
										<div class="pb-book-view-value">{{ categoryName || emptyValue }}</div>
									</div>
									<div class="pb-book-view-field">
										<div class="pb-eyebrow">{{t(AppLabels.LANGUAGE)}}</div>
										<div class="pb-book-view-value">{{ languageName || emptyValue }}</div>
									</div>
									<div class="pb-book-view-field">
										<div class="pb-eyebrow">{{t(AppLabels.FORMAT)}}</div>
										<div class="pb-book-view-value">{{ formatName || emptyValue }}</div>
									</div>
									<div class="pb-book-view-field">
										<div class="pb-eyebrow">{{t(AppLabels.PAGES)}}</div>
										<div class="pb-book-view-value">{{ pages || emptyValue }}</div>
									</div>
									<div class="pb-book-view-field">
										<div class="pb-eyebrow">{{t(AppLabels.PUBLISHER)}}</div>
										<div class="pb-book-view-value">{{ publisher || emptyValue }}</div>
									</div>
									<div class="pb-book-view-field">
										<div class="pb-eyebrow">{{t(AppLabels.PUBLISHED_DATE)}}</div>
										<div class="pb-book-view-value">{{ publishedDateDisplay || emptyValue }}</div>
									</div>
									<div class="pb-book-view-field">
										<div class="pb-eyebrow">{{t(AppLabels.READING_STATUS)}}</div>
										<div class="pb-book-view-value pb-book-view-status">
											<v-icon v-if="readingStatusName" size="16" color="primary">{{ readingStatusIcon }}</v-icon>
											{{ readingStatusName || emptyValue }}
										</div>
									</div>
									<div v-if="createdBy" class="pb-book-view-field">
										<div class="pb-eyebrow">{{t(AppLabels.BOOK_ADDED_BY)}}</div>
										<div class="pb-book-view-value">{{ createdBy }}</div>
									</div>
								</div>

								<p v-if="description" class="pb-book-view-description">{{ description }}</p>
							</div>
						</div>

						<!-- ============================================== -->
						<!-- EDIT MODE									-->
						<!-- ============================================== -->
						<div v-else class="pb-hero pt-2">
							<book-image :book="model.getBook()"/>

							<div class="pb-hero-main">
								<div class="d-flex">
									<!-- Name -->
									<v-text-field
										v-model="name"
										:disabled="disableFields"
										:label="t(AppLabels.NAME)"
										density="compact"
										variant="outlined"
										class="mr-1"
									></v-text-field>

									<!-- ISBN code -->
									<v-text-field
										v-model="isbn"
										:disabled="disableFields"
										label="ISBN"
										density="compact"
										variant="outlined"
										class="ml-1"
									></v-text-field>
								</div>

								<div class="d-flex">
									<!-- Category -->
									<v-select
										v-model="category"
										:disabled="disableFields"
										:items="categoriesJson()"
										:label="t(AppLabels.CATEGORY)"
										density="compact"
										variant="outlined"
										item-value="value"
										item-title="text"
										clearable
										class="mr-1"
										style="width: 50%"
									></v-select>

									<!-- Language -->
									<v-select
										v-model="language"
										:disabled="disableFields"
										:items="languagesJson()"
										:label="t(AppLabels.LANGUAGE)"
										density="compact"
										variant="outlined"
										item-value="value"
										item-title="text"
										clearable
										class="ml-1"
										style="width: 50%"
									></v-select>
								</div>

								<div class="d-flex">
									<!-- Format -->
									<v-select
										v-model="format"
										:disabled="disableFields"
										:items="formatsJson()"
										:label="t(AppLabels.FORMAT)"
										density="compact"
										variant="outlined"
										item-value="value"
										item-title="text"
										clearable
										class="mr-1"
										style="width: 50%"
									></v-select>

									<!-- Pages -->
									<v-text-field
										v-model="pages"
										:disabled="disableFields"
										:label="t(AppLabels.PAGES)"
										type="number"
										density="compact"
										variant="outlined"
										class="ml-1"
										style="width: 50%"
									></v-text-field>
								</div>

								<!-- Reading status -->
								<v-select
									v-model="readingStatus"
									:disabled="disableFields"
									:items="readingStatusJson()"
									:label="t(AppLabels.READING_STATUS)"
									density="compact"
									variant="outlined"
									item-value="value"
									item-title="text"
									clearable
								></v-select>

								<!-- Authors -->
								<v-autocomplete
									v-model="authors"
									:items="loadedAuthorsJSON"
									:loading="loadingAuthors"
									@update:search="searchAuthors"
									:disabled="disableFields"
									density="compact"
									variant="outlined"
									item-value="value"
									item-title="text"
									:label="t(AppLabels.AUTHORS)"
									color="primary"
									:placeholder="t(AppLabels.ADD_AUTHOR)"
									dense
									multiple
								></v-autocomplete>

								<div class="d-flex">
									<!-- Publisher -->
									<v-text-field
										v-model="publisher"
										:label="t(AppLabels.PUBLISHER)"
										:disabled="disableFields"
										density="compact"
										variant="outlined"
										class="mr-1"
										style="width: 50%"
									></v-text-field>

									<!-- Published date -->
									<v-text-field
										v-model="publishedDate"
										:label="t(AppLabels.PUBLISHED_DATE)"
										:disabled="disableFields"
										type="date"
										density="compact"
										variant="outlined"
										class="ml-1"
										style="width: 50%"
									></v-text-field>
								</div>

								<!-- Description -->
								<v-textarea
									v-model="description"
									:disabled="disableFields"
									density="compact"
									variant="outlined"
									:label="t(AppLabels.DESCRIPTION)"
								></v-textarea>
							</div>
						</div>
					</template>
				</card-component>

				<!-- ================================================================== -->
				<!-- EBOOK FILE + STOCKS													-->
				<!-- ================================================================== -->
				<v-row no-gutters class="pb-secondary-row">
					<v-col cols="12" :md="model.getBook().isElectronic() ? 8 : 12" class="px-1 mb-4">
						<book-stocks :book="model.getBook()"/>
					</v-col>
					<v-col v-if="model.getBook().isElectronic()" cols="12" md="4" class="px-1 mb-4">
						<book-file :book="model.getBook()"/>
					</v-col>
				</v-row>
			</div>
		</template>
	</page-component>
</template>

<script setup lang="ts">
/**
 * Book detail view (`/app/book/:book_id`): a read-only view of the book's
 * metadata by default (`editing === false`), switching to the editable form
 * (each field a two-way computed bound directly to the `Book` model,
 * setting `hasChanges` so "Save" only enables once something's actually
 * changed) when "Edit" is pressed. "Cancel" restores a snapshot taken when
 * editing started. Also shows the cover image (`BookImage`), the ebook
 * file upload/preview (`BookFile`, only for `Electronic`-format books), and
 * the stock table (`BookStocks`).
 */
import PageComponent from "@/views/PageComponent.vue";
import BookController from "@/controller/book/BookController";
import CardComponent from "@/components/card/CardComponent.vue";
import BookStocks from "@/views/book/compoents/BookStocks.vue";
import {computed, ref, Ref, shallowRef, ShallowRef} from "vue";
import BookAuthor from "@/model/author/BookAuthor";
import {applicationService} from "@/service/ApplicationService";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";
import {authorsService} from "@/service/author/AuthorsService";
import BookImage from "@/views/book/compoents/BookImage.vue";
import BookFile from "@/views/book/compoents/BookFile.vue";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {useI18n} from "vue-i18n";
import {ReadingStatusEnum} from "@/types/book/IReadingStatus";

const model = new BookController();

const {t} = useI18n();

/** Placeholder shown for an unset view-mode field. */
const emptyValue = "—";

/**
 *
 */
const hasChanges: Ref<boolean> = ref(false);

/** Whether the metadata card is showing the editable form (true) or the read-only view (false). */
const editing: Ref<boolean> = ref(false);

/** Snapshot of every editable field, taken when editing starts, restored on cancel. */
interface BookSnapshot {
	name: string;
	isbn: string | null;
	categoryId: number | null;
	languageCode: string | null;
	formatId: number | null;
	pages: number;
	authors: BookAuthor[];
	publisher: string | null;
	publishedDate: Date | null;
	description: string;
	readingStatus: ReadingStatusEnum | null;
}

let snapshot: BookSnapshot | null = null;

/**
 *
 */
const loadingUpdate: Ref<boolean> = ref(false);

/**
 *
 */
const loadingDelete: Ref<boolean> = ref(false);

/**
 *
 */
const loadingAuthors: Ref<boolean> = ref(false);

/** Toolbar reading-status menu's own save-in-flight flag, separate from the edit form's `loadingUpdate`. */
const loadingReadingStatus: Ref<boolean> = ref(false);

const loadedAuthors: ShallowRef<BookAuthor[]> = shallowRef(model.getBook().getAuthors());

/**
 *
 */
const disableFields = computed(() => {
	return loadingUpdate.value
})

const loadedAuthorsJSON = computed(() => {
	return loadedAuthors.value.map((author) => {
		return {
			value: author.getAuthorId(),
			text: author.getAuthorName()
		}
	})
})

const name = computed({
	get() {
		return model.getBook().getName();
	},
	set(val: string) {
		model.getBook().setName(val);
		hasChanges.value = true;
	}
})

const description = computed({
	get() {
		return model.getBook().getDescription();
	},
	set(val: string) {
		model.getBook().setDescription(val);
		hasChanges.value = true;
	}
})

const pages = computed({
	get() {
		return model.getBook().getNumberOfPages();
	},
	set(val: number) {
		model.getBook().setNumberOfPages(val);
		hasChanges.value = true;
	}
})

const format = computed({
	get() {
		const format = model.getBook().getFormat();
		return format ? format.getFormatId() : null;
	},
	set(val: number | null) {
		const format = val != null ? applicationService.getFormat(val) || null : null;
		model.getBook().setFormat(format);
		hasChanges.value = true;
	}
})

const formatName = computed(() => model.getBook().getFormat()?.getFormatName() ?? null);

const language = computed({
	get() {
		return model.getBook().getLanguageCode();
	},
	set(val: string | null) {
		model.getBook().setLanguageCode(val);
		hasChanges.value = true;
	}
})

const languageName = computed(() => applicationService.getLanguage(model.getBook().getLanguageCode())?.getLanguageName() ?? null);

const category = computed({
	get() {
		return model.getBook().getCategoryId();
	},
	set(val: number | null) {
		model.getBook().setCategoryId(val);
		hasChanges.value = true;
	}
})

const categoryName = computed(() => applicationService.getCategory(model.getBook().getCategoryId())?.getCategoryName() ?? null);

const readingStatus = computed({
	get() {
		return model.getBook().getReadingStatus();
	},
	set(val: ReadingStatusEnum | null) {
		model.getBook().setReadingStatus(val);
		hasChanges.value = true;
	}
})

const READING_STATUS_LABELS: Record<ReadingStatusEnum, AppLabels> = {
	[ReadingStatusEnum.WANT_TO_READ]: AppLabels.WANT_TO_READ,
	[ReadingStatusEnum.CURRENTLY_READING]: AppLabels.CURRENTLY_READING,
	[ReadingStatusEnum.READ]: AppLabels.READ,
}

const readingStatusName = computed(() => {
	const status = model.getBook().getReadingStatus();
	return status != null ? t(READING_STATUS_LABELS[status]) : null;
})

const READING_STATUS_ICONS: Record<ReadingStatusEnum, string> = {
	[ReadingStatusEnum.WANT_TO_READ]: "mdi-bookmark-outline",
	[ReadingStatusEnum.CURRENTLY_READING]: "mdi-book-open-page-variant-outline",
	[ReadingStatusEnum.READ]: "mdi-check-circle-outline",
}

/** Toolbar button's icon: the current status's icon, or a plain outline bookmark when untracked. */
const readingStatusIcon = computed(() => {
	const status = model.getBook().getReadingStatus();
	return status != null ? READING_STATUS_ICONS[status] : "mdi-bookmark-outline";
})

function readingStatusJson() {
	return (Object.values(ReadingStatusEnum).filter((v) => typeof v === "number") as ReadingStatusEnum[]).map((status) => {
		return {
			value: status,
			text: t(READING_STATUS_LABELS[status])
		}
	})
}

const publisher = computed({
	get() {
		return model.getBook().getPublisher();
	},
	set(val: string | null) {
		model.getBook().setPublisher(val);
		hasChanges.value = true;
	}
})

const publishedDate = computed({
	get() {
		const date = model.getBook().getPublishDate();
		if (date) {
			const day = String(date.getDate()).padStart(2, '0'); // Get day and pad with leading zero if necessary
			const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based, so add 1
			const year = date.getFullYear(); // Get the full year

			return `${year}-${month}-${day}`;
		} else {
			return null;
		}
	},
	set(val: string | null) {
		model.getBook().setPublishDate(val ? new Date(val) : null);
		hasChanges.value = true;
	}
})

const publishedDateDisplay = computed(() => {
	const date = model.getBook().getPublishDate();
	return date ? date.toLocaleDateString() : null;
})

/** Read-only, unlike the fields above - who added a book is never editable. */
const createdBy = computed(() => model.getBook().getCreatedBy());

const isbn = computed({
	get() {
		return model.getBook().getIsbn();
	},
	set(val: string | null) {
		model.getBook().setIsbn(val);
		hasChanges.value = true;
	}
})

const authors = computed({
	get() {
		return model.getBook().getAuthors().map((author) => {
			return {
				value: author.getAuthorId(),
				text: author.getAuthorName()
			}
		});
	},
	set(val: number[]) {
		const items: BookAuthor[] = [];
		val.forEach((id) => {
			const item = loadedAuthors.value.find((a) => a.getAuthorId() === id);
			if (item) {
				items.push(item);
			}
		});

		model.getBook().setAuthors(items);
		hasChanges.value = true;
	}
})

function formatsJson() {
	return applicationService.getFormats().map((format) => {
		return {
			value: format.getFormatId(),
			text: format.getFormatName()
		}
	})
}

function languagesJson() {
	return applicationService.getLanguages().map((lang) => {
		return {
			value: lang.getLanguageCode(),
			text: lang.getLanguageName()
		}
	})
}

function categoriesJson() {
	return applicationService.getCategories().map((category) => {
		return {
			value: category.getCategoryId(),
			text: category.getCategoryName()
		}
	})
}

/**
 * Set the reading status from the toolbar menu and persist it immediately -
 * a quick-access shortcut for the same field the edit form's "Reading
 * status" select controls, for when the user doesn't want to open the full
 * edit form just to change it. Only shown outside edit mode (see the
 * `v-menu`'s `v-if="!editing"`), so there's never unsaved edit-form state to
 * clash with.
 */
async function quickSetReadingStatus(status: ReadingStatusEnum | null) {
	if (loadingReadingStatus.value) return;

	loadingReadingStatus.value = true;
	try {
		model.getBook().setReadingStatus(status);
		await model.getBook().updateBook();
	} finally {
		loadingReadingStatus.value = false;
	}
}

function deleteBook() {
	confirmationDialogController.showDialog(
		`${t(AppLabels.DELETE_BOOK)} '${model.getBook().getName()}'`,
		t(AppLabels.DELETE_BOOK_DESC),
		t(AppLabels.DELETE)
	).then(async () => {
		try {
			loadingDelete.value = true;
			await model.getBook().deleteBook();
		} finally {
			loadingDelete.value = false;
		}
	})
}

/** Snapshot the current field values and switch the metadata card to the editable form. */
function startEditing() {
	const book = model.getBook();
	snapshot = {
		name: book.getName(),
		isbn: book.getIsbn(),
		categoryId: book.getCategoryId(),
		languageCode: book.getLanguageCode(),
		formatId: book.getFormat()?.getFormatId() ?? null,
		pages: book.getNumberOfPages(),
		authors: book.getAuthors(),
		publisher: book.getPublisher(),
		publishedDate: book.getPublishDate(),
		description: book.getDescription(),
		readingStatus: book.getReadingStatus(),
	};
	editing.value = true;
}

/** Restore the pre-edit snapshot and switch the metadata card back to the read-only view. */
function cancelEditing() {
	if (snapshot) {
		const book = model.getBook();
		book.setName(snapshot.name);
		book.setIsbn(snapshot.isbn);
		book.setCategoryId(snapshot.categoryId);
		book.setLanguageCode(snapshot.languageCode);
		book.setFormat(snapshot.formatId != null ? applicationService.getFormat(snapshot.formatId) || null : null);
		book.setNumberOfPages(snapshot.pages);
		book.setAuthors(snapshot.authors);
		book.setPublisher(snapshot.publisher);
		book.setPublishDate(snapshot.publishedDate);
		book.setDescription(snapshot.description);
		book.setReadingStatus(snapshot.readingStatus);
	}

	hasChanges.value = false;
	editing.value = false;
}

/**
 *
 */
async function updateBook() {
	if (hasChanges.value) {
		try {
			loadingUpdate.value = true;
			await model.getBook().updateBook();
			hasChanges.value = false;
			editing.value = false;
		} finally {
			loadingUpdate.value = false;
		}
	}
}

async function searchAuthors(prompt: string) {
	// prompt is empty
	if (prompt == null || prompt.trim().length === 0) return;

	// Items have already been requested
	if (loadingAuthors.value) return;

	try {
		loadingAuthors.value = true;
		const data = await authorsService.searchAuthors(prompt)
		if (data) {
			data.forEach((author) => {
				const index = loadedAuthors.value.findIndex((item) => item.getAuthorId() === author.id)
				if (index == -1) {
					loadedAuthors.value.push(new BookAuthor(author))
				}
			})

			loadedAuthors.value = [...loadedAuthors.value];
		}
	} finally {
		loadingAuthors.value = false;
	}
}
</script>

<style scoped lang="scss">
.pb-hero-card {
	:deep(.v-card-text) {
		padding-left: 28px;
		padding-right: 28px;
		padding-bottom: 28px;
	}

	@media (max-width: 600px) {
		:deep(.v-card-text) {
			padding-left: 16px;
			padding-right: 16px;
			padding-bottom: 16px;
		}
	}
}

.pb-hero {
	display: grid;
	grid-template-columns: 220px 1fr;
	gap: 32px;
	align-items: start;

	@media (max-width: 640px) {
		grid-template-columns: 1fr;
	}
}

.pb-hero-main {
	min-width: 0;
}

.pb-book-view-title {
	font-size: 26px;
	font-weight: 600;
	color: var(--pb-text);
	line-height: 1.2;
}

.pb-book-view-authors {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 10px;
}

.pb-book-view-isbn {
	display: inline-flex;
	margin-top: 14px;
	font-size: 12px;
	color: var(--pb-text-muted);
	background: var(--pb-surface-alt);
	border: 1px solid var(--pb-border);
	padding: 3px 10px;
	border-radius: 999px;
}

.pb-book-view-grid {
	margin-top: 22px;
	padding-top: 20px;
	border-top: 1px solid var(--pb-border);
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: 16px 24px;
}

.pb-book-view-value {
	margin-top: 2px;
	font-size: 15px;
	color: var(--pb-text);
}

.pb-book-view-status {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.pb-book-view-description {
	margin: 22px 0 0;
	font-size: 14px;
	line-height: 1.6;
	color: var(--pb-text);
	white-space: pre-wrap;
	max-width: 70ch;
}
</style>
