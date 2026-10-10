import {ARoute} from "@/router/ARoute";

/** Route to a vault member's own loans and loan history (`/app/my-loans`). */
export class MyLoansRoute extends ARoute {

    /** Vue Router path pattern for this route. */
    public static PATH = "/my-loans";

    /** Route name shown in Vue Router config. */
    private m_name: string = "MyLoans";

    /** @returns The Vue Router route config for the my-loans view. */
    public getRoute() {
        return  {
            name: this.m_name,
            path: MyLoansRoute.PATH,
            component: () => import('@/views/loans/MyLoansView.vue'),
        }
    }

    /** @returns The navigable URL for the my-loans view. */
    public getPath() {
        return MyLoansRoute.PATH;
    }
}

/** Singleton instance used throughout the app for navigation. */
export const myLoansRoute = new MyLoansRoute();
