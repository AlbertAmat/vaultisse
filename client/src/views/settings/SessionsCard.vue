<template>
	<settings-card :title="t(AppLabels.USERCONF_SESSIONS)">
		<p class="v-card-subtitle pl-0 mb-4" style="white-space: normal">{{t(AppLabels.USERCONF_SESSIONS_DESC)}}</p>

		<div v-if="loading" class="d-flex justify-center my-6">
			<v-progress-circular indeterminate color="primary" />
		</div>

		<empty-state
			v-else-if="sessions.length === 0"
			compact
			icon="mdi-monitor"
			:title="t(AppLabels.USERCONF_SESSIONS_EMPTY)"
		/>

		<div v-else class="sessions-list">
			<div
				v-for="session in sessions"
				:key="session.id"
				class="sessions-row"
			>
				<v-icon size="22" class="sessions-row-icon">{{deviceIcon(parseUserAgent(session.userAgent).deviceType)}}</v-icon>

				<div class="sessions-row-text">
					<div class="sessions-row-title">
						<span>{{deviceLabel(session.userAgent)}}</span>
						<v-chip v-if="session.isCurrent" size="x-small" color="primary" variant="tonal" class="ml-2">
							{{t(AppLabels.USERCONF_SESSION_CURRENT)}}
						</v-chip>
					</div>
					<p class="v-card-subtitle pl-0 sessions-row-subtitle">
						{{session.ipAddress}} &middot; {{t(AppLabels.USERCONF_SESSION_LAST_ACTIVE)}} {{formatDate(session.lastSeenDate)}}
					</p>
				</div>

				<v-btn
					:loading="revokingId === session.id"
					:disabled="revokingId !== null"
					variant="tonal"
					size="small"
					class="text-none"
					@click="revoke(session)"
				>
					{{t(AppLabels.USERCONF_SESSION_LOG_OUT)}}
				</v-btn>
			</div>
		</div>
	</settings-card>
</template>

<script setup lang="ts">
/**
 * Settings > Active sessions: lists the current user's active login
 * sessions (device/IP/last-seen, see GET /user/sessions) with a per-row
 * "Log out" that revokes it (DELETE /user/sessions/:id). Revoking the
 * caller's own current session redirects to `/login`, since the server
 * clears their cookie but the SPA's own state wouldn't otherwise notice.
 */
import {onMounted, ref, Ref} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import SettingsCard from "@/views/settings/SettingsCard.vue";
import EmptyState from "@/components/emptyState/EmptyState.vue";
import {userService} from "@/service/user/UserService";
import IUserSession from "@/types/user/IUserSession";
import {deviceIcon, parseUserAgent} from "@/utils/DeviceInfo";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";

const {t} = useI18n();

const loading = ref(true);
const sessions: Ref<IUserSession[]> = ref([]);
const revokingId: Ref<number | null> = ref(null);

onMounted(async () => {
	try {
		sessions.value = await userService.getSessions();
	} catch (e) {
		console.error("Error while fetching active sessions", e);
	} finally {
		loading.value = false;
	}
});

function deviceLabel(userAgent: string | null): string {
	const {browser, os} = parseUserAgent(userAgent);

	if (browser && os) return `${browser} · ${os}`;
	if (browser) return browser;
	if (os) return os;
	return t(AppLabels.DEVICE_UNKNOWN);
}

function formatDate(iso: string): string {
	return new Date(iso).toLocaleString();
}

function revoke(session: IUserSession) {
	confirmationDialogController.showDialog(
		t(AppLabels.USERCONF_SESSION_LOGOUT_TITLE),
		t(AppLabels.USERCONF_SESSION_LOGOUT_DESC),
		t(AppLabels.USERCONF_SESSION_LOG_OUT)
	).then(async () => {
		try {
			revokingId.value = session.id;
			await userService.revokeSession(session.id);

			if (session.isCurrent) {
				window.location.href = "/login";
				return;
			}

			sessions.value = sessions.value.filter((s) => s.id !== session.id);
			appSnackbarController.show({message: t(AppLabels.SNACKBAR_SESSION_REVOKED)});
		} catch (e) {
			console.error("Error while revoking session", e);
		} finally {
			revokingId.value = null;
		}
	});
}
</script>

<style scoped lang="scss">
.sessions-list {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.sessions-row {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 10px 0;
	border-bottom: 1px solid var(--pb-border);
}

.sessions-row:last-child {
	border-bottom: none;
	padding-bottom: 0;
}

.sessions-row-icon {
	color: var(--pb-text-muted);
	flex-shrink: 0;
}

.sessions-row-text {
	flex: 1;
	min-width: 0;
}

.sessions-row-title {
	display: flex;
	align-items: center;
	font-size: 14px;
	font-weight: 530;
	color: var(--pb-text);
}

.sessions-row-subtitle {
	margin: 2px 0 0;
	font-size: 12px;
}

@media (max-width: 600px) {
	.sessions-row {
		flex-wrap: wrap;
	}
}
</style>
