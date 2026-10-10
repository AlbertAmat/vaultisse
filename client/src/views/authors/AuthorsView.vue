<template>
	<page-component :model="controller">
		<template v-slot:append>
			<v-btn
				v-if="canEditCatalog"
				@click="createAuthor()"
				class="text-none"
				color="primary"
				variant="elevated"
				small
			>
				{{t(AppLabels.ADD)}}
			</v-btn>
		</template>

		<template v-slot:default>
			<empty-state
				v-if="authors.length === 0"
				icon="mdi-account-plus-outline"
				:chip-icons="['mdi-account-edit-outline', 'mdi-book-account-outline', 'mdi-fountain-pen-tip', 'mdi-book-open-page-variant', 'mdi-pencil-outline', 'mdi-book-outline', 'mdi-account-outline', 'mdi-notebook-outline']"
				:title="t(AppLabels.EMPTY_AUTHORS_TITLE)"
				:description="t(AppLabels.EMPTY_AUTHORS_DESC)"
			>
				<v-btn
					v-if="canEditCatalog"
					@click="createAuthor()"
					class="text-none"
					color="primary"
					variant="elevated"
					small
				>
					{{t(AppLabels.ADD)}}
				</v-btn>
			</empty-state>

			<entity-list-card
				v-else
				:items="authors"
				icon="mdi-fountain-pen-tip"
				:delete-loading="deleteLoading"
				@edit="editAuthor"
				@delete="deleteItem"
			/>

			<author-dialog
				v-if="dialog"
				v-model="dialog"
				:author="selectedAuthor"
				:controller="controller"
			/>
		</template>
	</page-component>
</template>

<script setup lang="ts">
/**
 * Authors management view: a row list of all authors with inline
 * edit/delete, an empty state when there are none, and the add/edit dialog.
 */
import {applicationService} from "@/service/ApplicationService";
import PageComponent from "@/views/PageComponent.vue";
import {computed, ref, Ref, ShallowRef, shallowRef} from "vue";
import AuthorDialog from "@/views/authors/AuthorDialog.vue";
import EmptyState from "@/components/emptyState/EmptyState.vue";
import EntityListCard from "@/components/entityList/EntityListCard.vue";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";
import AuthorsController from "@/controller/authors/AuthorsController";
import BookAuthor from "@/model/author/BookAuthor";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

/** Hides catalog-editing actions for roles that can't edit the catalog (readonly, borrower). */
const canEditCatalog = applicationService.canEditCatalog();

const controller = new AuthorsController();

const {t} = useI18n();

/**
 *
 */
const dialog: Ref<boolean> = ref(false);

/**
 *
 */
const selectedAuthor: ShallowRef<BookAuthor | undefined> = shallowRef(undefined);

/**
 *
 */
const deleteLoading: Ref<number[]> = ref([]);

/**
 *
 */
const authors = computed(() => {
	return controller.getAuthors().map(author => {
		return {
			id: author.getAuthorId(),
			name: author.getAuthorName(),
		}
	})
})

/**
 *
 * @param id
 */
function editAuthor(id: number) {
	const author =  controller.getAuthors().find(author => author.getAuthorId() === id);
	if(author) {
		selectedAuthor.value = author;
		dialog.value = true;
	}
}

/**
 *
 */
function createAuthor() {
	selectedAuthor.value = undefined;
	dialog.value = true;
}

/**
 *
 * @param authorId
 */
async function deleteItem(authorId: number) {
	const author = controller.getAuthor(authorId);
	confirmationDialogController.showDialog(
		`${t(AppLabels.DELETE_AUTHOR_TITLE)} ${author ? author.getAuthorName() : ''}`,
		t(AppLabels.DELETE_AUTHOR_DESC),
		t(AppLabels.DELETE)
	).then(async () => {
		try {
			deleteLoading.value.push(authorId);
			await controller.deleteAuthor(authorId);
		} finally {
			deleteLoading.value.splice(deleteLoading.value.indexOf(authorId), 1);
		}
	});
}
</script>