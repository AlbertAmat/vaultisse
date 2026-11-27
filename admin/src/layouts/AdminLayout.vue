<template>
	<v-navigation-drawer v-model="drawer" :permanent="mdAndUp" :temporary="!mdAndUp" width="240" class="app-menu" :dark="true">
		<div class="d-flex align-center pt-4 pb-3 pl-5 pr-2 ga-2">
			<brand-mark/>
			<div class="ml-1">
				<div class="app-menu-title pb-display">Vaultisse</div>
				<div class="pb-eyebrow">Admin console</div>
			</div>
		</div>
		<v-list nav density="compact" slim class="app-menu-list">
			<v-list-item v-for="item in items" :key="item.to" :to="item.to" :prepend-icon="item.icon" :title="item.title" density="compact" class="app-menu-item" exact/>
		</v-list>
		<template #append>
			<div class="pa-4 text-caption app-menu-foot">
				<span v-if="!canWrite()" class="d-block mb-1"><v-icon size="14">mdi-eye-outline</v-icon> Read-only account</span>
				Instance admin portal
			</div>
		</template>
	</v-navigation-drawer>

	<v-app-bar app density="compact" class="app-bar" border :elevation="0">
		<v-app-bar-nav-icon v-if="!mdAndUp" aria-label="Menu" @click="drawer = !drawer"/>
		<v-app-bar-title>{{ route.meta.title }}</v-app-bar-title>
		<v-btn :icon="state.theme === 'beige' ? 'mdi-weather-night' : 'mdi-weather-sunny'" aria-label="Switch theme" @click="setTheme(state.theme === 'beige' ? 'library' : 'beige')"/>
		<v-menu>
			<template #activator="{ props }">
				<v-btn v-bind="props" variant="text" class="text-none" prepend-icon="mdi-account-circle-outline" append-icon="mdi-menu-down">
					<span class="d-none d-sm-inline">{{ state.admin?.name }}</span>
				</v-btn>
			</template>
			<v-list density="compact">
				<v-list-item :title="state.admin?.email" :subtitle="state.admin?.role" disabled/>
				<v-divider/>
				<v-list-item prepend-icon="mdi-key-outline" title="Change password" @click="passwordDialog = true"/>
				<v-list-item prepend-icon="mdi-logout" title="Sign out" @click="logout"/>
			</v-list>
		</v-menu>
	</v-app-bar>

	<v-main>
		<router-view/>
	</v-main>

	<password-dialog v-model="passwordDialog"/>
	<onboarding-dialog v-model="state.onboardingOpen"/>
</template>

<script setup lang="ts">
import {onMounted, ref} from "vue";
import {useRoute, useRouter} from "vue-router";
import {useDisplay} from "vuetify";
import {api} from "@/api";
import {canWrite, setTheme, state} from "@/store";
import BrandMark from "@/components/BrandMark.vue";
import PasswordDialog from "@/components/PasswordDialog.vue";
import OnboardingDialog from "@/components/OnboardingDialog.vue";

const route = useRoute();
const router = useRouter();
const {mdAndUp} = useDisplay();
const drawer = ref(mdAndUp.value);
const passwordDialog = ref(false);

const items = [
	{to: "/", title: "Overview", icon: "mdi-view-dashboard-outline"},
	{to: "/users", title: "Accounts", icon: "mdi-account-multiple-outline"},
	{to: "/vaults", title: "Vaults", icon: "mdi-bookshelf"},
	{to: "/plans", title: "Plans & quotas", icon: "mdi-layers-outline"},
	{to: "/deletions", title: "Deletions", icon: "mdi-delete-clock-outline"},
	{to: "/terms", title: "Terms & notices", icon: "mdi-file-sign"},
	{to: "/announcements", title: "Announcements", icon: "mdi-bullhorn-outline"},
	{to: "/broadcast", title: "Email users", icon: "mdi-email-multiple-outline"},
	{to: "/security", title: "Security", icon: "mdi-shield-alert-outline"},
	{to: "/map", title: "Login map", icon: "mdi-map-marker-radius-outline"},
	{to: "/compliance", title: "Compliance", icon: "mdi-clipboard-check-outline"},
	{to: "/logs", title: "Logs", icon: "mdi-text-box-search-outline"},
	{to: "/audit", title: "Audit trail", icon: "mdi-clipboard-text-clock-outline"},
	{to: "/notifications", title: "Notifications", icon: "mdi-bell-outline"},
	{to: "/settings", title: "Settings", icon: "mdi-cog-outline"},
	{to: "/system", title: "System", icon: "mdi-server-outline"},
	{to: "/admins", title: "Admins", icon: "mdi-account-key-outline"},
];

// The first time a superadmin gets in (and nobody has finished or skipped it before), the setup guide opens by itself.
onMounted(async () => {
	if (!canWrite()) {
		return;
	}
	try {
		if (!(await api.onboarding.status()).completed) {
			state.onboardingOpen = true;
		}
	} catch {
		// Not essential; the guide can be opened from Settings.
	}
});

async function logout() {
	try {
		await api.auth.logout();
	} finally {
		state.admin = null;
		router.replace({name: "login"});
	}
}
</script>

<style scoped>
/* The client's "shelf frame" navigation (client/src/components/app/AppMenu.vue). */
.app-menu {
	background: var(--pb-nav-bg) !important;
	color: var(--pb-nav-text);
	border-right: 1px solid var(--pb-nav-border-strong) !important;
}

.app-menu :deep(.v-navigation-drawer__border) {
	display: none;
}

.app-menu :deep(.v-navigation-drawer__content) {
	display: flex;
	flex-direction: column;
}

.app-menu-title {
	font-weight: 600;
	font-size: 17px;
	line-height: 1.1;
	color: var(--pb-nav-text);
}

.app-menu .pb-eyebrow {
	color: var(--pb-nav-text-muted);
	font-size: 10px;
}

.app-menu-list {
	flex: 1;
	padding-top: 4px;
}

.app-menu-item {
	border-radius: 10px;
	margin: 2px 8px;
	color: var(--pb-nav-text-muted);
}

.app-menu :deep(.v-list-item--active) {
	background: var(--pb-nav-active-bg);
	color: var(--pb-nav-accent);
	font-weight: 600;
	box-shadow: inset 3px 0 0 0 var(--pb-nav-accent);
}

.app-menu :deep(.v-list-item--active .v-icon) {
	color: var(--pb-nav-accent);
}

.app-menu-foot {
	color: var(--pb-nav-text-muted);
}

.app-bar {
	background: var(--pb-surface) !important;
	border-color: var(--pb-border) !important;
}
</style>
