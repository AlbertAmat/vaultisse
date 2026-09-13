<template>
	<settings-card :title="t(AppLabels.USERCONF_LOGIN_ACTIVITY)">
		<p class="v-card-subtitle pl-0 mb-4" style="white-space: normal">{{t(AppLabels.USERCONF_LOGIN_ACTIVITY_DESC)}}</p>

		<div v-if="loading" class="d-flex justify-center my-6">
			<v-progress-circular indeterminate color="primary" />
		</div>

		<empty-state
			v-else-if="entries.length === 0"
			compact
			icon="mdi-history"
			:title="t(AppLabels.USERCONF_LOGIN_ACTIVITY_EMPTY)"
		/>

		<div v-else class="activity-list">
			<div
				v-for="entry in entries"
				:key="entry.id"
				class="activity-row"
			>
				<v-icon size="20" :color="iconColor(entry.action)" class="activity-row-icon">{{actionIcon(entry.action)}}</v-icon>

				<div class="activity-row-text">
					<span class="activity-row-title">{{actionLabel(entry.action)}}</span>
					<p class="v-card-subtitle pl-0 activity-row-subtitle">
						{{formatDate(entry.createdDate)}}
						<template v-if="ipOf(entry)"> &middot; {{ipOf(entry)}}</template>
					</p>
				</div>
			</div>
		</div>
	</settings-card>
</template>

<script setup lang="ts">
/**
 * Settings > Recent logins: the current user's last sign-ins, failed
 * sign-in attempts, sign-outs, and password changes (see GET /user/activity,
 * backed by the generic `activity_log` table filtered to auth events).
 * Read-only - unlike SessionsCard.vue, there's nothing to revoke here.
 */
import {onMounted, ref, Ref} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import SettingsCard from "@/views/settings/SettingsCard.vue";
import EmptyState from "@/components/emptyState/EmptyState.vue";
import {userService} from "@/service/user/UserService";
import IActivityLogEntry from "@/types/user/IActivityLogEntry";

const {t} = useI18n();

const loading = ref(true);
const entries: Ref<IActivityLogEntry[]> = ref([]);

onMounted(async () => {
	try {
		entries.value = await userService.getActivity();
	} catch (e) {
		console.error("Error while fetching login activity", e);
	} finally {
		loading.value = false;
	}
});

function actionIcon(action: IActivityLogEntry["action"]): string {
	switch (action) {
		case "login": return "mdi-login-variant";
		case "login_failed": return "mdi-alert-circle-outline";
		case "logout": return "mdi-logout-variant";
		case "password_changed": return "mdi-key-outline";
	}
}

function iconColor(action: IActivityLogEntry["action"]): string | undefined {
	return action === "login_failed" ? "error" : undefined;
}

function actionLabel(action: IActivityLogEntry["action"]): string {
	switch (action) {
		case "login": return t(AppLabels.ACTIVITY_LOGIN);
		case "login_failed": return t(AppLabels.ACTIVITY_LOGIN_FAILED);
		case "logout": return t(AppLabels.ACTIVITY_LOGOUT);
		case "password_changed": return t(AppLabels.ACTIVITY_PASSWORD_CHANGED);
	}
}

function ipOf(entry: IActivityLogEntry): string | null {
	const ip = entry.metadata?.ip;
	return typeof ip === "string" ? ip : null;
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleString();
}
</script>

<style scoped lang="scss">
.activity-list {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.activity-row {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 8px 0;
	border-bottom: 1px solid var(--pb-border);
}

.activity-row:last-child {
	border-bottom: none;
	padding-bottom: 0;
}

.activity-row-icon {
	flex-shrink: 0;
}

.activity-row-text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.activity-row-title {
	font-size: 14px;
	font-weight: 530;
	color: var(--pb-text);
}

.activity-row-subtitle {
	margin: 2px 0 0;
	font-size: 12px;
}
</style>
