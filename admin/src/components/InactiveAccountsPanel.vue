<template>
	<div>
		<v-alert v-if="preview && !preview.enabled && !preview.simulated" type="info" variant="tonal" class="mb-4" icon="mdi-account-clock-outline">
			Automatic deletion of inactive accounts is <strong>off</strong>, so nobody will be deleted. Try a period below to see who it would affect, or turn it on under Settings > Inactive accounts.
		</v-alert>

		<v-card class="pa-4 mb-4">
			<div class="d-flex flex-wrap align-end ga-4">
				<div style="min-width: 220px; flex: 1">
					<div class="text-subtitle-2">What if accounts are deleted after…</div>
					<div class="d-flex ga-2 align-start mt-2">
						<v-text-field v-model="days" type="number" min="1" :placeholder="preview?.configuredDays ? String(preview.configuredDays) : 'days'" suffix="days idle" style="max-width: 200px" @keyup.enter="load"/>
						<v-btn variant="tonal" :loading="loading" @click="load">Preview</v-btn>
						<v-btn v-if="days" variant="text" @click="days = ''; load()">Use the setting</v-btn>
					</div>
				</div>
				<v-select v-model="horizon" :items="[{title: 'next 7 days', value: 7}, {title: 'next 14 days', value: 14}, {title: 'next 30 days', value: 30}, {title: 'next 90 days', value: 90}]" label="Who is next, within" style="max-width: 200px" @update:model-value="load"/>
			</div>
			<p v-if="preview?.inactivityDays" class="text-body-2 text-medium-emphasis mt-3">
				<v-icon size="16">mdi-information-outline</v-icon>
				Accounts unused for <strong>{{ preview.inactivityDays }} days</strong> are deleted<template v-if="preview.noticeDays > 0">, after an email warning <strong>{{ preview.noticeDays }} days</strong> before</template><template v-else>, with no warning</template>.
				<span v-if="preview.simulated" class="text-warning">Simulation only: nothing is changed.</span>
				<span v-if="preview.noticeDays > 0 && !preview.mailEnabled" class="text-error"> Email isn't set up, so the warnings can't be sent.</span>
			</p>
		</v-card>

		<div v-if="preview?.inactivityDays" class="d-flex flex-wrap ga-2 mb-3">
			<v-chip color="error" variant="tonal" prepend-icon="mdi-delete-alert-outline">{{ preview.counts.due }} deleted at the next daily run</v-chip>
			<v-chip color="warning" variant="tonal" prepend-icon="mdi-email-alert-outline">{{ preview.counts.warned }} warned, waiting</v-chip>
			<v-chip color="info" variant="tonal" prepend-icon="mdi-email-fast-outline">{{ preview.counts.toWarn }} to be warned next</v-chip>
			<v-chip variant="tonal" prepend-icon="mdi-clock-outline">{{ preview.counts.upcoming }} coming up</v-chip>
		</div>

		<v-card>
			<div class="table-wrap">
				<v-table>
					<thead><tr><th>Account</th><th>Last active</th><th>Status</th><th>Warned</th><th>Deleted</th><th></th></tr></thead>
					<tbody>
						<tr v-for="item in preview?.items ?? []" :key="item.id">
							<td><div class="font-weight-medium">{{ item.name }}</div><div class="text-caption text-medium-emphasis">{{ item.code }} · {{ item.email }}</div></td>
							<td>{{ relative(item.lastActivity) }}<div class="text-caption text-medium-emphasis">{{ dateOnly(item.lastActivity) }}</div></td>
							<td><v-chip size="x-small" variant="tonal" :color="color[item.status]">{{ text[item.status] }}</v-chip></td>
							<td>{{ item.warnedAt ? dateOnly(item.warnedAt) : item.warnOn && preview?.noticeDays ? (new Date(item.warnOn) <= new Date() ? "at the next run" : `on ${dateOnly(item.warnOn)}`) : "—" }}</td>
							<td class="text-no-wrap">{{ item.status === "due" ? "next run" : dateOnly(item.deleteOn) }}<div class="text-caption text-medium-emphasis">{{ item.status === "due" ? "" : relative(item.deleteOn) }}</div></td>
							<td class="text-right text-no-wrap">
								<v-btn size="small" variant="text" :to="`/users?search=${encodeURIComponent(item.code)}`">Open</v-btn>
								<v-btn v-if="canWrite() && !preview?.simulated" size="small" variant="tonal" prepend-icon="mdi-shield-check-outline" @click="keep(item.id, item.name)">Keep</v-btn>
							</td>
						</tr>
						<tr v-if="!(preview?.items.length) && !loading"><td colspan="6" class="text-center text-medium-emphasis pa-8">{{ preview?.inactivityDays ? "No account is affected within this period." : "Nothing to show." }}</td></tr>
					</tbody>
				</v-table>
			</div>
		</v-card>
		<p class="text-caption text-medium-emphasis mt-3">
			"Keep" counts the account as active now, which restarts its clock and cancels a warning. Never listed (so never deleted): accounts that can't sign in anyway, borrowers with copies still on loan, and the only admin of a vault shared with others.
			The cleanup runs once a day.
		</p>
	</div>
</template>

<script setup lang="ts">
import {onMounted, ref} from "vue";
import type {IInactivityPreview, InactivityStatus} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateOnly, relative} from "@/utils/format";

const preview = ref<IInactivityPreview | null>(null);
const days = ref("");
const horizon = ref(14);
const loading = ref(false);

const text: Record<InactivityStatus, string> = {due: "Deleted next run", warned: "Warned", to_warn: "To be warned", upcoming: "Coming up"};
const color: Record<InactivityStatus, string | undefined> = {due: "error", warned: "warning", to_warn: "info", upcoming: undefined};

async function load() {
	loading.value = true;
	try {
		preview.value = await api.inactivity.preview({days: days.value ? Number(days.value) : undefined, horizon: horizon.value});
	} finally {
		loading.value = false;
	}
}

async function keep(id: number, name: string) {
	await api.inactivity.keep(id);
	notify(`${name} counts as active now.`);
	await load();
}

onMounted(load);
</script>
