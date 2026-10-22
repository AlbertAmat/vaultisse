/** View model for a book category, wrapping `ICategory` with reactive rename support. */
import ICategory from "@vaultisse/types/category/ICategory";
import {api} from "@/plugins/api";
import {Ref, ref} from "vue";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

export default class Category {
    /** Category id, immutable once loaded. */
    private readonly m_categoryId: number;

    /** Category name. */
    private readonly m_categoryName: Ref<string>;

    /** @param data Raw category data from the server. */
    public constructor(data: ICategory) {
        this.m_categoryId = data.id;
        this.m_categoryName = ref(data.name);
    }

    /** @returns The category id. */
    public getCategoryId(): number {
        return this.m_categoryId;
    }

    /** @returns The category name. */
    public getCategoryName(): string {
        return this.m_categoryName.value;
    }

    /**
     * Rename this category on the server and update local state.
     * @param name New category name.
     */
    public async update(name: string) {
        await api.categories.updateCategory(this.m_categoryId, name)
        this.m_categoryName.value = name;
        appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_CATEGORY_UPDATED)})
    }
}
