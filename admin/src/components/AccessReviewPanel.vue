<template>
	<v-card>
		<div class="d-flex flex-wrap align-center ga-3 pa-4 pb-0">
			<div>
				<div class="text-subtitle-1 font-weight-medium">Who has admin access</div>
				<div class="text-body-2 text-medium-emphasis">Confirm every few months that each person still needs it (ISO/IEC 27001 A.5.18). Remove anybody who doesn't under Admins.</div>
			</div>
			<v-spacer/>
			<v-btn v-if="canWrite()" color="primary" variant="flat" prepend-icon="mdi-check-all" :loading="busy" @click="confirm()">Confirm everyone still needs access</v-btn>
		</div>
		<div class="table-wrap">
			<v-table density="comfortable">
				<thead><tr><th>Admin</th><th>Role</th><th>Last sign-in</th><th>Access last confirmed</th><th></th></tr></thead>
				<tbody>
					<tr v-for="a in items" :key="a.id">
						<td><div class="font-weight-medium">{{ a.name }}<v-chip v-if="a.disabled" size="x-small" variant="tonal" class="ml-2">disabled</v-chip></div><div class="text-caption text-medium-emphasis">{{ a.email }}</div></td>
						<td>{{ a.role === "superadmin" ? "Full admin" : "Read-only" }}</td>
						<td>{{ a.lastLoginDate ? relative(a.lastLoginDate) : "never" }}</td>
						<td>
							<span v-if="a.accessReviewedAt" :class="{'text-error': stale(a)}">{{ dateOnly(a.accessReviewedAt) }}</span>
							<span v-else class="text-warning">never</span>
							<div v-if="a.reviewedBy" class="text-caption text-medium-emphasis">by {{ a.reviewedBy }}</div>
						</td>
						<td class="text-right"><v-btn v-if="canWrite() && !a.disabled" size="small" variant="tonal" @click="confirm([a.id])">Confirm</v-btn></td>
					</tr>
				</tbody>
			</v-table>
		</div>
	</v-card>
</template>

<script setup lang="ts">
import {onMounted, ref} from "vue";
import type {IAccessReview} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateOnly, relative} from "@/utils/format";

const emit = defineEmits<{changed: []}>();
const items = ref<IAccessReview[]>([]);
const busy = ref(false);
const DAYS = 180;
const stale = (a: IAccessReview) => !!a.accessReviewedAt && Date.now() - new Date(a.accessReviewedAt).getTime() > DAYS * 86400000;

async function load() {
	items.value = await api.compliance.access();
}

async function confirm(ids?: number[]) {
	busy.value = true;
	try {
		const n = await api.compliance.confirmAccess(ids);
		notify(`Access confirmed for ${n} admin${n === 1 ? "" : "s"}.`);
		await load();
		emit("changed");
	} finally {
		busy.value = false;
	}
}

onMounted(load);
</script>
