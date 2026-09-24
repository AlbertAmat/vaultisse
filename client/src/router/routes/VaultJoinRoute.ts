import {ARoute} from "@/router/ARoute";

/** Route to a vault's invite-link landing page (`/app/vault/join/:uuid`) - see VaultJoinView.vue. */
export class VaultJoinRoute extends ARoute {

    /** Vue Router path pattern for this route. */
    public static PATH = "/vault/join/:uuid";

    /** Route name shown in Vue Router config. */
    private m_name: string = "Vault join";

    /** @returns The Vue Router route config for the vault-join view. */
    public getRoute() {
        return {
            name: this.m_name,
            path: VaultJoinRoute.PATH,
            component: () => import('@/views/vault/VaultJoinView.vue'),
        }
    }

    /**
     * @param uuid The vault's invitation uuid, e.g. `vaultJoinRoute.getPath("abc-123")` -> "/vault/join/abc-123".
     * @returns The navigable URL for that vault's invite-link landing page.
     */
    public getPath(uuid: string) {
        return VaultJoinRoute.PATH.replace(":uuid", uuid);
    }
}

/** Singleton instance used throughout the app for navigation. */
export const vaultJoinRoute = new VaultJoinRoute();
