/** Backs the authors management view: loads all authors and exposes add/delete operations. */
import {BaseController} from "@/controller/BaseController";
import {ShallowRef, shallowRef} from "vue";
import IBookAuthor from "@vaultisse/types/book/IBookAuthor";
import BookAuthor from "@/model/author/BookAuthor";
import {api} from "@/plugins/api";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import {i18n} from "@/plugins/i18n/i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

export default class AuthorsController extends BaseController<IBookAuthor[]> {

    /** All authors belonging to the user, populated by `setData()`. */
    private m_authors: ShallowRef<BookAuthor[]> = shallowRef([]);

    public constructor() {
        super(i18n.global.t(AppLabels.AUTHORS));
    }

    /** @returns Every author belonging to the user, fetched from the server. */
    async fetchData(): Promise<IBookAuthor[]> {
        return await api.authors.getAuthors()
    }

    /** @param data Raw author list from the server. */
    setData(data: IBookAuthor[]) {
        this.m_authors.value = data.map(author => new BookAuthor(author));
    }

    /** @returns The currently loaded authors. */
    public getAuthors(): BookAuthor[] {
        return this.m_authors.value;
    }

    /**
     * @param id Author id to look up.
     * @returns The matching author, or undefined if not loaded.
     */
    public getAuthor(id: number): BookAuthor | undefined {
        return this.m_authors.value.find(author => author.getAuthorId() === id);
    }

    /**
     * Create a new author and append it to the local list.
     * @param name New author's name.
     */
    public async addAuthor(name: string) {
        try {
            const customer = await api.authors.addAuthor(name);
            this.m_authors.value = [...this.m_authors.value, new BookAuthor(customer)];
            appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_NEW_AUTHOR_ADDED) + " " + name})
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Delete an author and remove it from the local list.
     * @param id Author id to delete.
     */
    public async deleteAuthor(id: number) {
        const index = this.m_authors.value.findIndex(author => author.getAuthorId() === id);
        if(index != -1 ) {
            try {
                await api.authors.deleteAuthor(id);
                this.m_authors.value.splice(index, 1);
                this.m_authors.value = [...this.m_authors.value];
                appSnackbarController.show({message: i18n.global.t(AppLabels.SNACKBAR_AUTHOR_DELETED)})
            } catch (e) {
                console.error(e);
            }
        }
    }
}
