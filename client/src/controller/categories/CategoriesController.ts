/** Backs the categories management view: loads all categories and exposes add/delete operations. */
import {BaseController} from "@/controller/BaseController";
import {ShallowRef, shallowRef} from "vue";
import ICategory from "@vaultisse/types/category/ICategory";
import Category from "@/model/category/Category";
import {api} from "@/plugins/api";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

export default class CategoriesController extends BaseController<ICategory[]> {

    /** All categories belonging to the user, populated by `setData()`. */
    private m_categories: ShallowRef<Category[]> = shallowRef([]);

    public constructor() {
        super(i18n.global.t(AppLabels.CATEGORIES));
    }

    /** @returns Every category belonging to the user, fetched from the server. */
    async fetchData(): Promise<ICategory[]> {
        return await api.categories.getCategories()
    }

    /** @param data Raw category list from the server. */
    setData(data: ICategory[]) {
        this.m_categories.value = data.map(category => new Category(category));
    }

    /** @returns The currently loaded categories. */
    public getCategories(): Category[] {
        return this.m_categories.value;
    }

    /**
     * @param id Category id to look up.
     * @returns The matching category, or undefined if not loaded.
     */
    public getCategory(id: number): Category | undefined {
        return this.m_categories.value.find(category => category.getCategoryId() === id);
    }

    /**
     * Create a new category and append it to the local list.
     * @param name New category's name.
     */
    public async addCategory(name: string) {
        try {
            const category = await api.categories.addCategory(name);
            this.m_categories.value = [...this.m_categories.value, new Category(category)];
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_NEW_CATEGORY_ADDED)})
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Delete a category and remove it from the local list.
     * @param id Category id to delete.
     */
    public async deleteCategory(id: number) {
        const index = this.m_categories.value.findIndex(category => category.getCategoryId() === id);
        if(index != -1 ) {
            try {
                await api.categories.deleteCategory(id);
                this.m_categories.value.splice(index, 1);
                this.m_categories.value = [...this.m_categories.value];
                appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_DELETED_CATEGORY)})
            } catch (e) {
                console.error(e);
            }
        }
    }
}
