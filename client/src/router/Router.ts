/**
 * Vue Router instance for the SPA, mounted under the `/app` base path
 * (matches the server-side catch-all in server/src/routes/auth/AuthRoute.ts that
 * serves index.html for any `/app/*` request, enabling deep-linking/refresh).
 * Each entry delegates to a `router/routes/*Route.ts` singleton's `getRoute()`.
 */
import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import {searchRoute} from "@/router/routes/SearchRoute";
import {DashboardRoute, dashboardRoute} from "@/router/routes/DashboardRoute";
import {bookRoute} from "@/router/routes/BookRoute";
import {notFoundRoute} from "@/router/routes/NotFoundRoute";
import {locationsRoute} from "@/router/routes/LocationsRoute";
import {categoriesRoute} from "@/router/routes/CategoriesRoute";
import {settingsRoute} from "@/router/routes/SettingsRoute";
import {customersRoute} from "@/router/routes/CustomersRoute";
import {authorsRoute} from "@/router/routes/AuthorsRoute";
import {loansRoute} from "@/router/routes/LoansRoute";
import {legalRoute} from "@/router/routes/LegalRoute";
import {vaultJoinRoute} from "@/router/routes/VaultJoinRoute";
import {applicationService} from "@/service/ApplicationService";

// Define your routes
const routes: Array<RouteRecordRaw> = [
    {
        path: '/',
        redirect: DashboardRoute.PATH,
    },
    dashboardRoute.getRoute(),
    searchRoute.getRoute(),
    bookRoute.getRoute(),
    locationsRoute.getRoute(),
    categoriesRoute.getRoute(),
    customersRoute.getRoute(),
    authorsRoute.getRoute(),
    loansRoute.getRoute(),
    settingsRoute.getRoute(),
    legalRoute.getRoute(),
    vaultJoinRoute.getRoute(),

    // Not found
    notFoundRoute.getRoute(),
]

// Create the router instance
const router = createRouter({
    history: createWebHistory('/app'),
    routes,
})

/**
 * Defense-in-depth only: the server already gates every /app/* request on a
 * valid session cookie (httpOnly, so it can't be inspected here directly),
 * so this can't be the sole auth check. It closes the gap where a session
 * expires *after* the SPA has loaded - without this, a client-side
 * navigation between routes would briefly render a protected view's shell
 * before its own data fetch failed with 401. If the last policy fetch
 * failed (see ApplicationService.fetchPolicy), send the user to the
 * server-rendered /login page instead of letting the SPA render further.
 */
router.beforeEach((to, from, next) => {
    if (applicationService.hasError()) {
        window.location.href = "/login";
        return;
    }

    // The Loans and Customers pages are opt-in (see Settings > Features).
    // Their nav items are already hidden when disabled (see AppMenu.vue) -
    // this stops a direct/bookmarked link from reaching them regardless.
    const leasingPaths: string[] = [customersRoute.getPath(), loansRoute.getPath()];
    if (leasingPaths.includes(to.path) && !applicationService.getUser().isLeasingEnabled()) {
        next(DashboardRoute.PATH);
        return;
    }

    next();
});

export default router