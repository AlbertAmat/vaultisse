<template>
	<v-navigation-drawer v-model="drawer" :permanent="mdAndUp" width="248">
		<div class="d-flex align-center ga-3 pa-4">
			<v-avatar color="primary" size="34" rounded="lg"><v-icon color="background">mdi-shield-key-outline</v-icon></v-avatar>
			<div>
				<div class="font-weight-bold">Vaultisse</div>
				<div class="text-caption text-medium-emphasis">Admin console</div>
			</div>
		</div>
		<v-list nav density="comfortable" class="px-2">
			<v-list-item v-for="item in items" :key="item.to" :to="item.to" :prepend-icon="item.icon" :title="item.title" rounded="lg" exact/>
		</v-list>
		<template #append>
			<div class="pa-3 text-caption text-medium-emphasis">
				<span v-if="!canWrite()" class="d-block mb-1"><v-icon size="14">mdi-eye-outline</v-icon> Read-only account</span>
				Instance admin portal
			</div>
		</template>
	</v-navigation-drawer>

	<v-app-bar flat border="b" color="surface">
		<v-app-bar-nav-icon v-if="!mdAndUp" aria-label="Menu" @click="drawer = !drawer"/>
		<v-app-bar-title>{{ route.meta.title }}</v-app-bar-title>
		<v-btn :icon="state.dark ? 'mdi-weather-sunny' : 'mdi-weather-night'" aria-label="Switch theme" @click="setDark(!state.dark)"/>
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
</template>

<script setup lang="ts">
import {ref} from "vue";
import {useRoute, useRouter} from "vue-router";
import {useDisplay} from "vuetify";
import {api} from "@/api";
import {canWrite, setDark, state} from "@/store";
import PasswordDialog from "@/components/PasswordDialog.vue";

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
	{to: "/security", title: "Security", icon: "mdi-shield-alert-outline"},
	{to: "/logs", title: "Logs", icon: "mdi-text-box-search-outline"},
	{to: "/audit", title: "Audit trail", icon: "mdi-clipboard-text-clock-outline"},
	{to: "/settings", title: "Settings", icon: "mdi-cog-outline"},
	{to: "/admins", title: "Admins", icon: "mdi-account-key-outline"},
];

async function logout() {
	try {
		await api.auth.logout();
	} finally {
		state.admin = null;
		router.replace({name: "login"});
	}
}
</script>
