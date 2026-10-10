<template>
	<page-component :model="controller">
		<template v-slot:append>
			<v-btn
				v-if="canEditCatalog"
				@click="createCategory()"
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
				v-if="categories.length === 0"
				icon="mdi-tag-plus-outline"
				:chip-icons="['mdi-tag-outline', 'mdi-shape-outline', 'mdi-bookshelf', 'mdi-tag-multiple-outline', 'mdi-book-outline', 'mdi-label-outline', 'mdi-book-open-page-variant', 'mdi-tag-heart-outline']"
				:title="t(AppLabels.EMPTY_CATEGORIES_TITLE)"
				:description="t(AppLabels.EMPTY_CATEGORIES_DESC)"
			>
				<v-btn
					v-if="canEditCatalog"
					@click="createCategory()"
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
				:items="categories"
				icon="mdi-tag-outline"
				:delete-loading="deleteLoading"
				@edit="editCategory"
				@delete="deleteItem"
			/>

			<category-dialog
				v-if="dialog"
				v-model="dialog"
				:category="selectedCategory"
				:controller="controller"
			/>
		</template>
	</page-component>
</template>

<script setup lang="ts">
/**
 * Categories management view: a row list of all categories with inline
 * edit/delete, an empty state when there are none, and the add/edit dialog.
 * Deletes also sync `ApplicationService`'s cached category list, since it's
 * used app-wide (e.g. the book edit form's category picker).
 */
import PageComponent from "@/views/PageComponent.vue";
import {computed, ref, Ref, ShallowRef, shallowRef} from "vue";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";
import {applicationService} from "@/service/ApplicationService";
import CategoriesController from "@/controller/categories/CategoriesController";
import Category from "@/model/category/Category";
import CategoryDialog from "./CategoryDialog.vue"
import EmptyState from "@/components/emptyState/EmptyState.vue";
import EntityListCard from "@/components/entityList/EntityListCard.vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

/** Hides catalog-editing actions for roles that can't edit the catalog (readonly, borrower). */
const canEditCatalog = applicationService.canEditCatalog();

const controller = new CategoriesController();

const {t} = useI18n();

/**
 *
 */
const dialog: Ref<boolean> = ref(false);

/**
 *
 */
const selectedCategory: ShallowRef<Category | undefined> = shallowRef(undefined);

/**
 *
 */
const deleteLoading: Ref<number[]> = ref([]);

/**
 *
 */
const categories = computed(() => {
	return controller.getCategories().map(category => {
		return {
			id: category.getCategoryId(),
			name: category.getCategoryName(),
		}
	})
})

/**
 *
 * @param id
 */
function editCategory(id: number) {
	const category =  controller.getCategories().find(category => category.getCategoryId() === id);
	if(category) {
		selectedCategory.value = category;
		dialog.value = true;
	}
}

/**
 *
 */
function createCategory() {
	selectedCategory.value = undefined;
	dialog.value = true;
}

/**
 *
 * @param id
 */
async function deleteItem(id: number) {
	const category = controller.getCategory(id);
	confirmationDialogController.showDialog(
		`${t(AppLabels.DELETE_CATEGORY)} ${category ? category.getCategoryName() : ''}`,
		t(AppLabels.DELETE_CATEGORY_DESC),
		t(AppLabels.DELETE)
	).then(async () => {
		try {
			deleteLoading.value.push(id);
			await controller.deleteCategory(id);
			applicationService.setCategories(controller.getCategories())
		} finally {
			deleteLoading.value.splice(deleteLoading.value.indexOf(id), 1);
		}
	});
}
</script>