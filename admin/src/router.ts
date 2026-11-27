/** Routes of the admin console. Everything except the login needs a signed-in admin. */
import {createRouter, createWebHistory} from "vue-router";
import {api} from "@/api";
import {state} from "@/store";

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: "/change-password", name: "change-password", component: () => import("@/views/ChangePasswordView.vue"), meta: {title: "Choose a new password"}},
        {path: "/login", name: "login", component: () => import("@/views/LoginView.vue"), meta: {public: true}},
        {
            path: "/",
            component: () => import("@/layouts/AdminLayout.vue"),
            children: [
                {path: "", name: "overview", component: () => import("@/views/OverviewView.vue"), meta: {title: "Overview"}},
                {path: "settings", name: "settings", component: () => import("@/views/SettingsView.vue"), meta: {title: "Settings"}},
                {path: "users", name: "users", component: () => import("@/views/UsersView.vue"), meta: {title: "Accounts"}},
                {path: "vaults", name: "vaults", component: () => import("@/views/VaultsView.vue"), meta: {title: "Vaults"}},
                {path: "plans", name: "plans", component: () => import("@/views/PlansView.vue"), meta: {title: "Plans & quotas"}},
                {path: "deletions", name: "deletions", component: () => import("@/views/DeletionsView.vue"), meta: {title: "Deletions"}},
                {path: "security", name: "security", component: () => import("@/views/SecurityView.vue"), meta: {title: "Security"}},
                {path: "logs", name: "logs", component: () => import("@/views/LogsView.vue"), meta: {title: "Logs"}},
                {path: "audit", name: "audit", component: () => import("@/views/AuditView.vue"), meta: {title: "Audit trail"}},
                {path: "admins", name: "admins", component: () => import("@/views/AdminsView.vue"), meta: {title: "Admins"}},
                {path: ":pathMatch(.*)*", name: "not-found", component: () => import("@/views/NotFoundView.vue"), meta: {title: "Not found"}},
            ],
        },
    ],
});

router.beforeEach(async (to) => {
    if (!state.ready) {
        try {
            state.admin = await api.auth.me();
        } catch {
            state.admin = null;
        }
        state.ready = true;
    }
    if (to.meta.public) {
        return state.admin ? {name: "overview"} : true;
    }
    if (!state.admin) {
        return {name: "login"};
    }
    // A generated or admin-set password must be replaced before anything else.
    if (state.admin.mustChangePassword) {
        return to.name === "change-password" ? true : {name: "change-password"};
    }
    return to.name === "change-password" ? {name: "overview"} : true;
});

router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · Vaultisse Admin` : "Vaultisse Admin";
});

export default router;
