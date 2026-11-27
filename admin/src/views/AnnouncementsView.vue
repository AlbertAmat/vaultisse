<template>
	<!--
	  Announcements & maintenance mode (route /announcements, menu: Communication)

	  Announcements: a banner every user of the app sees (info and warning can be dismissed, critical cannot).
	  Maintenance mode: the whole app becomes read-only; changes are refused with your message, reading still works.
	  Data:   GET /api/admin/announcements (items + maintenance state), PUT /api/admin/announcements/maintenance
	  Example banner: "Maintenance tonight at 22:00 (about 20 minutes)." level=warning, starts now, ends tomorrow 06:00.
	-->
	<div class="page">
		<page-header title="Announcements" subtitle="A banner every user of the app sees (a maintenance window, news), and a maintenance mode that makes the whole app read-only.">
			<v-btn v-if="canWrite()" color="primary" variant="flat" prepend-icon="mdi-plus" @click="edit(null)">New announcement</v-btn>
		</page-header>

		<!-- Maintenance mode -->
		<v-card class="pa-5 mb-4" :class="{maintenance: maintenance?.enabled}">
			<div class="d-flex flex-wrap align-center ga-4">
				<v-avatar :color="maintenance?.enabled ? 'warning' : undefined" variant="tonal" size="44"><v-icon>mdi-wrench-clock</v-icon></v-avatar>
				<div style="flex: 1; min-width: 240px">
					<div class="text-subtitle-1 font-weight-medium">
						Maintenance mode
						<v-chip size="x-small" class="ml-2" :color="maintenance?.enabled ? 'warning' : undefined" variant="tonal">{{ maintenance?.enabled ? "ON" : "off" }}</v-chip>
					</div>
					<p class="text-body-2 text-medium-emphasis mt-1">
						<template v-if="maintenance?.enabled">The app is read-only since {{ relative(maintenance.since) }}. People can read and sign in, but every change is refused. Users see: <em>"{{ maintenance.message }}"</em></template>
						<template v-else>Makes the app read-only for everyone while you upgrade or move data. People can still read their library and sign in; every change is refused with your message. The admin console is not affected.</template>
					</p>
				</div>
				<v-btn v-if="canWrite()" :color="maintenance?.enabled ? 'success' : 'warning'" variant="flat" :prepend-icon="maintenance?.enabled ? 'mdi-play-circle-outline' : 'mdi-pause-circle-outline'" @click="maintenanceDialog = true">
					{{ maintenance?.enabled ? "End maintenance" : "Start maintenance…" }}
				</v-btn>
			</div>
		</v-card>

		<!-- Announcements -->
		<v-card>
			<div class="table-wrap">
				<v-table>
					<thead><tr><th>Message</th><th>Level</th><th>Shown</th><th>State</th><th></th></tr></thead>
					<tbody>
						<tr v-for="item in items" :key="item.id">
							<td style="max-width: 420px">{{ item.message }}<div class="text-caption text-medium-emphasis">by {{ item.createdBy ?? "—" }}</div></td>
							<td><v-chip size="x-small" variant="tonal" :color="levelColor(item.level)">{{ item.level }}</v-chip></td>
							<td class="text-caption">{{ dateTime(item.startsAt) }}<br>{{ item.endsAt ? `until ${dateTime(item.endsAt)}` : "until removed" }}</td>
							<td><v-chip size="x-small" variant="tonal" :color="stateColor[item.state]">{{ stateText[item.state] }}</v-chip></td>
							<td class="text-right text-no-wrap">
								<template v-if="canWrite()">
									<v-btn size="small" variant="text" @click="toggle(item)">{{ item.enabled ? "Switch off" : "Switch on" }}</v-btn>
									<v-btn size="small" variant="text" @click="edit(item)">Edit</v-btn>
									<v-btn size="small" variant="text" color="error" @click="removing = item">Delete</v-btn>
								</template>
							</td>
						</tr>
						<tr v-if="!items.length"><td colspan="5" class="text-center text-medium-emphasis pa-8">No announcements. Users see no banner.</td></tr>
					</tbody>
				</v-table>
			</div>
		</v-card>

		<!-- Create / edit -->
		<v-dialog v-model="dialog" max-width="560">
			<v-card class="pa-2">
				<v-card-title>{{ editing ? "Edit announcement" : "New announcement" }}</v-card-title>
				<v-card-text>
					<v-textarea v-model="form.message" label="Message" rows="3" auto-grow counter="500" maxlength="500" placeholder="Maintenance tonight at 22:00, the library will be read-only for about an hour." class="mb-3"/>
					<v-select v-model="form.level" :items="levels" label="Look" class="mb-3"/>
					<v-row dense>
						<v-col cols="12" sm="6"><v-text-field v-model="form.startsAt" type="datetime-local" label="Show from"/></v-col>
						<v-col cols="12" sm="6"><v-text-field v-model="form.endsAt" type="datetime-local" label="Hide after" hint="Empty = until you remove it" persistent-hint/></v-col>
					</v-row>
					<div class="text-caption text-medium-emphasis mt-4 mb-1">How users will see it</div>
					<div class="banner-preview" :class="`lv-${form.level}`">
						<v-icon size="18">{{ levelIcon[form.level] }}</v-icon>
						<span>{{ form.message || "Your message appears here." }}</span>
					</div>
				</v-card-text>
				<v-card-actions>
					<v-spacer/>
					<v-btn variant="text" @click="dialog = false">Cancel</v-btn>
					<v-btn color="primary" variant="flat" :loading="saving" :disabled="!form.message.trim()" @click="save">{{ editing ? "Save" : "Publish" }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Maintenance -->
		<v-dialog v-model="maintenanceDialog" max-width="500">
			<v-card class="pa-2">
				<v-card-title class="d-flex align-center ga-2"><v-icon color="warning">mdi-wrench-clock</v-icon>{{ maintenance?.enabled ? "End maintenance mode" : "Start maintenance mode" }}</v-card-title>
				<v-card-text>
					<template v-if="maintenance?.enabled">
						<p class="text-body-2">Everyone can make changes again straight away.</p>
					</template>
					<template v-else>
						<p class="text-body-2 mb-3">From now on <strong>every change by every user is refused</strong> (adding books, lending, editing, uploads, registering) until you end it. Reading and signing in keep working.</p>
						<v-textarea v-model="maintenanceMessage" label="Message users see" rows="2" auto-grow counter="500" maxlength="500" :placeholder="defaultMessage"/>
					</template>
				</v-card-text>
				<v-card-actions>
					<v-spacer/>
					<v-btn variant="text" @click="maintenanceDialog = false">Cancel</v-btn>
					<v-btn :color="maintenance?.enabled ? 'success' : 'warning'" variant="flat" :loading="saving" @click="setMaintenance(!maintenance?.enabled)">{{ maintenance?.enabled ? "End maintenance" : "Make the app read-only" }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<confirm-danger-dialog :model-value="!!removing" title="Delete this announcement?" action-label="Delete" :action="remove" @update:model-value="removing = null">
			<template v-if="removing">"{{ removing.message }}" is removed for good. To hide it for a while, switch it off instead.</template>
		</confirm-danger-dialog>
	</div>
</template>

<script setup lang="ts">
import {onMounted, reactive, ref} from "vue";
import type {AnnouncementLevel, IAnnouncement, IMaintenance} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateTime, relative} from "@/utils/format";
import ConfirmDangerDialog from "@/components/ConfirmDangerDialog.vue";
import PageHeader from "@/components/PageHeader.vue";

const items = ref<IAnnouncement[]>([]);
const maintenance = ref<IMaintenance | null>(null);
const dialog = ref(false);
const maintenanceDialog = ref(false);
const maintenanceMessage = ref("");
const editing = ref<IAnnouncement | null>(null);
const removing = ref<IAnnouncement | null>(null);
const saving = ref(false);
const form = reactive({message: "", level: "info" as AnnouncementLevel, startsAt: "", endsAt: ""});
const defaultMessage = "The app is in maintenance mode. You can read your library, but changes are disabled for now.";

const levels = [
	{title: "Information (blue, can be dismissed)", value: "info"},
	{title: "Warning (amber, can be dismissed)", value: "warning"},
	{title: "Critical (red, stays)", value: "critical"},
];
const levelIcon = {info: "mdi-information-outline", warning: "mdi-alert-outline", critical: "mdi-alert-octagon-outline"};
const levelColor = (level: string) => ({info: "info", warning: "warning", critical: "error"}[level]);
const stateText = {active: "Showing now", scheduled: "Scheduled", expired: "Ended", off: "Switched off"};
const stateColor = {active: "success", scheduled: "info", expired: undefined, off: undefined} as Record<string, string | undefined>;

/** ISO date -> value of a datetime-local input (local time). */
const toLocal = (iso: string | null) => {
	if (!iso) return "";
	const date = new Date(iso);
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
/** datetime-local value -> ISO (UTC) string, or null when empty. */
const fromLocal = (value: string) => (value ? new Date(value).toISOString() : null);

async function load() {
	const result = await api.announcements.list();
	items.value = result.items;
	maintenance.value = result.maintenance;
}

function edit(item: IAnnouncement | null) {
	editing.value = item;
	form.message = item?.message ?? "";
	form.level = item?.level ?? "info";
	form.startsAt = toLocal(item?.startsAt ?? new Date().toISOString());
	form.endsAt = toLocal(item?.endsAt ?? null);
	dialog.value = true;
}

async function save() {
	saving.value = true;
	try {
		if (editing.value) {
			await api.announcements.update(editing.value.id, {message: form.message, level: form.level, startsAt: fromLocal(form.startsAt) ?? new Date().toISOString(), endsAt: fromLocal(form.endsAt), enabled: editing.value.enabled});
		} else {
			await api.announcements.create({message: form.message, level: form.level, startsAt: fromLocal(form.startsAt), endsAt: fromLocal(form.endsAt)});
		}
		dialog.value = false;
		notify(editing.value ? "Saved." : "Published. Users see it within a minute.");
		await load();
	} finally {
		saving.value = false;
	}
}

async function toggle(item: IAnnouncement) {
	await api.announcements.update(item.id, {message: item.message, level: item.level, startsAt: item.startsAt, endsAt: item.endsAt, enabled: !item.enabled});
	await load();
}

async function remove() {
	await api.announcements.remove(removing.value!.id);
	notify("Announcement deleted.");
	await load();
}

/** Turning maintenance on needs a fresh verification (it stops every change for every user); turning it off does not. */
async function setMaintenance(enabled: boolean) {
	saving.value = true;
	try {
		maintenance.value = await api.announcements.setMaintenance(enabled, maintenanceMessage.value);
		maintenanceDialog.value = false;
		notify(enabled ? "The app is read-only now." : "Maintenance mode ended. Changes are possible again.", enabled ? "warning" : "success");
	} finally {
		saving.value = false;
	}
}

onMounted(load);
</script>

<style scoped>
.maintenance {
	border-color: rgb(var(--v-theme-warning)) !important;
}

.banner-preview {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 14px;
	border-radius: 10px;
	font-size: 0.9rem;
}

.lv-info {
	background: #e3f0fb;
	color: #174a7c;
}

.lv-warning {
	background: #fdf0d5;
	color: #7a4b00;
}

.lv-critical {
	background: #fbe1e1;
	color: #8a1c1c;
}
</style>
