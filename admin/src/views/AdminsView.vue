<template>
	<div class="page">
		<page-header title="Admins" subtitle="Who can sign in to this console. Admins are separate from regular accounts and must use two-factor authentication.">
			<v-btn v-if="canWrite()" color="primary" variant="flat" prepend-icon="mdi-plus" @click="dialog = true">New admin</v-btn>
		</page-header>

		<v-card>
			<div class="table-wrap">
				<v-table>
					<thead><tr><th>Admin</th><th>Role</th><th>Two-factor</th><th>Last sign-in</th><th></th></tr></thead>
					<tbody>
						<tr v-for="admin in admins" :key="admin.id">
							<td>
								<div class="font-weight-medium">{{ admin.name }} <v-chip v-if="admin.id === state.admin?.id" size="x-small" variant="tonal" class="ml-1">you</v-chip> <v-chip v-if="admin.disabled" size="x-small" color="error" variant="tonal" class="ml-1">disabled</v-chip></div>
								<div class="text-caption text-medium-emphasis">{{ admin.email }}</div>
							</td>
							<td>{{ admin.role === "superadmin" ? "Superadmin" : "Read-only" }}</td>
							<td>{{ admin.totpEnabled ? "On" : "Not set up yet" }}</td>
							<td>{{ relative(admin.lastLoginDate) }}</td>
							<td class="text-right text-no-wrap">
								<v-menu v-if="canWrite() && admin.id !== state.admin?.id">
									<template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-vertical" variant="text" size="small" aria-label="Actions"/></template>
									<v-list density="compact">
										<v-list-item :title="admin.role === 'superadmin' ? 'Make read-only' : 'Make superadmin'" @click="update(admin, {role: admin.role === 'superadmin' ? 'readonly' : 'superadmin'})"/>
										<v-list-item :title="admin.disabled ? 'Enable' : 'Disable'" @click="update(admin, {disabled: !admin.disabled})"/>
										<v-list-item title="Reset two-factor" @click="resetTwoFactor(admin)"/>
										<v-list-item title="Delete…" base-color="error" @click="removing = admin"/>
									</v-list>
								</v-menu>
							</td>
						</tr>
					</tbody>
				</v-table>
			</div>
		</v-card>

		<v-card class="mt-6">
			<div class="d-flex align-center pa-4 pb-0">
				<div>
					<div class="text-subtitle-1 font-weight-medium">Active sessions</div>
					<div class="text-body-2 text-medium-emphasis">Where admins are signed in right now. End any you don't recognise; a sign-in from a country an admin never used before also emails the admins.</div>
				</div>
				<v-spacer/>
				<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="loadSessions"/>
			</div>
			<div class="table-wrap">
				<v-table density="comfortable">
					<thead><tr><th>Admin</th><th>Device</th><th>Address</th><th>Signed in</th><th>Last active</th><th></th></tr></thead>
					<tbody>
						<tr v-for="session in sessions" :key="session.id">
							<td><div class="font-weight-medium">{{ session.adminName }}<v-chip v-if="session.current" size="x-small" color="success" variant="tonal" class="ml-2">this session</v-chip></div><div class="text-caption text-medium-emphasis">{{ session.adminEmail }}</div></td>
							<td>{{ device(session.userAgent) }}</td>
							<td><span class="mono">{{ session.ipAddress ?? "—" }}</span><div class="text-caption text-medium-emphasis">{{ place(session) }}</div></td>
							<td class="text-no-wrap">{{ dateTime(session.createdDate) }}</td>
							<td class="text-no-wrap">{{ relative(session.lastSeenDate) }}</td>
							<td class="text-right"><v-btn v-if="canWrite() && !session.current" size="small" variant="tonal" color="error" @click="endSession(session)">End session</v-btn></td>
						</tr>
						<tr v-if="!sessions.length"><td colspan="6" class="text-center text-medium-emphasis pa-6">No other session.</td></tr>
					</tbody>
				</v-table>
			</div>
		</v-card>

		<p class="text-caption text-medium-emphasis mt-3">
			Locked out? Run <span class="mono">node index.js admin:reset --email you@example.com</span> inside the app's container to set a new password and remove two-factor.
		</p>

		<v-dialog v-model="dialog" max-width="440">
			<v-card class="pa-2">
				<v-card-title>New admin</v-card-title>
				<v-card-text>
					<v-text-field v-model="form.name" label="Name" class="mb-3"/>
					<v-text-field v-model="form.email" label="Email" type="email" class="mb-3"/>
					<v-text-field v-model="form.password" label="Initial password" type="password" autocomplete="new-password" hint="At least 12 characters with upper and lower case, a number and a symbol. They sign in with it, then set up two-factor." persistent-hint class="mb-3"/>
					<v-select v-model="form.role" :items="[{title: 'Read-only (can look, not change)', value: 'readonly'}, {title: 'Superadmin (can change everything)', value: 'superadmin'}]" label="Role"/>
				</v-card-text>
				<v-card-actions>
					<v-spacer/>
					<v-btn variant="text" @click="dialog = false">Cancel</v-btn>
					<v-btn color="primary" variant="flat" :loading="saving" :disabled="!form.name || !form.email || !form.password" @click="create">Create</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<confirm-danger-dialog :model-value="!!removing" title="Delete this admin?" action-label="Delete admin" :action="remove" @update:model-value="removing = null">
			<template v-if="removing"><strong>{{ removing.email }}</strong> can no longer sign in. Their entries in the audit trail stay.</template>
		</confirm-danger-dialog>
	</div>
</template>

<script setup lang="ts">
import {onMounted, reactive, ref} from "vue";
import type {AdminRole, IAdminSession, IAdminUser} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify, state} from "@/store";
import {dateTime, relative} from "@/utils/format";
import ConfirmDangerDialog from "@/components/ConfirmDangerDialog.vue";
import PageHeader from "@/components/PageHeader.vue";

const admins = ref<IAdminUser[]>([]);
const sessions = ref<IAdminSession[]>([]);
const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], {type: "region"}) : null;

/** "Chrome on Windows" from a user agent string. */
function device(ua: string | null): string {
	if (!ua) return "Unknown";
	const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|node|axios|supertest/i.test(ua) ? "Script" : "Browser";
	const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
	return os ? `${browser} on ${os}` : browser;
}

function place(session: IAdminSession): string {
	if (!session.country) return session.ipAddress ? "Private or unknown address" : "";
	let country = session.country;
	try {
		country = regionNames?.of(session.country) ?? session.country;
	} catch {
		// Keep the code.
	}
	return [session.city, country].filter(Boolean).join(", ");
}

async function loadSessions() {
	sessions.value = await api.admins.sessions();
}

async function endSession(session: IAdminSession) {
	await api.admins.revokeSession(session.id);
	notify(`The session of ${session.adminName} was ended.`);
	await loadSessions();
}
const dialog = ref(false);
const saving = ref(false);
const removing = ref<IAdminUser | null>(null);
const form = reactive({name: "", email: "", password: "", role: "readonly" as AdminRole});

async function load() {
	await Promise.all([api.admins.list().then((list) => (admins.value = list)), loadSessions()]);
}

async function create() {
	saving.value = true;
	try {
		await api.admins.create({...form});
		dialog.value = false;
		form.name = form.email = form.password = "";
		notify("Admin created. They set up two-factor at their first sign-in.");
		await load();
	} finally {
		saving.value = false;
	}
}

async function update(admin: IAdminUser, changes: {role?: AdminRole; disabled?: boolean}) {
	await api.admins.update(admin.id, changes);
	notify("Saved.");
	await load();
}

async function resetTwoFactor(admin: IAdminUser) {
	await api.admins.resetTwoFactor(admin.id);
	notify("Two-factor removed. They set it up again at their next sign-in.");
	await load();
}

async function remove() {
	await api.admins.remove(removing.value!.id);
	notify("Admin deleted.");
	await load();
}

onMounted(load);
</script>
