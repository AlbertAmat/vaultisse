<template>
	<div class="page">
		<page-header title="Audit trail" subtitle="Everything admins did here. The database refuses to change or delete these entries, so this record can't be edited from the portal.">
			<v-btn icon="mdi-refresh" variant="text" aria-label="Refresh" @click="load"/>
		</page-header>

		<v-card>
			<div class="d-flex flex-wrap ga-3 pa-4">
				<v-text-field v-model="action" prepend-inner-icon="mdi-magnify" placeholder="Action, e.g. user. or settings.update" clearable style="max-width: 340px" @update:model-value="debounced"/>
				<v-select v-model="entityType" :items="entityTypes" clearable placeholder="Any target" style="max-width: 200px" @update:model-value="reload"/>
			</div>
			<div class="table-wrap">
				<v-table density="compact">
					<thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Address</th><th>Detail</th></tr></thead>
					<tbody>
						<tr v-for="entry in items" :key="entry.id">
							<td class="text-no-wrap">{{ dateTime(entry.createdDate) }}</td>
							<td>{{ entry.adminEmail ?? "system" }}</td>
							<td><v-chip size="x-small" variant="tonal" :color="color(entry.action)" class="mono">{{ entry.action }}</v-chip></td>
							<td>{{ entry.entityLabel ?? "—" }}<div v-if="entry.entityType" class="text-caption text-medium-emphasis">{{ entry.entityType }}{{ entry.entityId ? ` #${entry.entityId}` : "" }}</div></td>
							<td class="mono">{{ entry.ipAddress ?? "—" }}</td>
							<td class="text-caption text-medium-emphasis mono">{{ Object.keys(entry.metadata).length ? JSON.stringify(entry.metadata) : "" }}</td>
						</tr>
						<tr v-if="!items.length && !loading"><td colspan="6" class="text-center text-medium-emphasis pa-8">Nothing recorded.</td></tr>
					</tbody>
				</v-table>
			</div>
			<pager :page="page" :page-size="pageSize" :total="total" @update:page="page = $event; load()"/>
		</v-card>
	</div>
</template>

<script setup lang="ts">
import {onMounted, ref} from "vue";
import type {IAuditEntry} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {dateTime} from "@/utils/format";
import PageHeader from "@/components/PageHeader.vue";
import Pager from "@/components/Pager.vue";

const items = ref<IAuditEntry[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 25;
const loading = ref(false);
const action = ref("");
const entityType = ref<string | null>(null);
const entityTypes = ["user", "vault", "plan", "settings", "admin", "ip", "session"];

/** Destructive actions stand out. */
const color = (name: string) => (/delete|disable|suspend|block|failed|reset/.test(name) ? "error" : /approve|enable|restore|unsuspend|login|create/.test(name) ? "success" : undefined);

async function load() {
	loading.value = true;
	try {
		const result = await api.logs.audit({action: action.value ?? "", entityType: entityType.value ?? undefined, page: page.value, pageSize});
		items.value = result.items;
		total.value = result.total;
	} finally {
		loading.value = false;
	}
}

function reload() {
	page.value = 1;
	return load();
}

let timer: ReturnType<typeof setTimeout> | undefined;
const debounced = () => {
	clearTimeout(timer);
	timer = setTimeout(reload, 300);
};

onMounted(load);
</script>
