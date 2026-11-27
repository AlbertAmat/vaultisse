<template>
	<!--
	  Plans & quotas (route /plans, menu: Customers > Plans & quotas)

	  Limits per vault for hosting Vaultisse for other people: maximum books, members and storage (empty = unlimited).
	  Quotas are enforced only while the admin portal is on. The default plan applies to every vault without a plan of its own.
	  Data:   GET /api/admin/plans, POST/PUT/DELETE /api/admin/plans/:id, PUT /api/admin/plans/default
	-->
	<div class="page">
		<page-header title="Plans & quotas" subtitle="Limits per vault, for hosting this for other people. A vault without a plan uses the default plan; empty limits mean unlimited.">
			<v-btn v-if="canWrite()" color="primary" variant="flat" prepend-icon="mdi-plus" @click="edit(null)">New plan</v-btn>
		</page-header>

		<!-- Explains how plans behave when a limit is reached (adding is refused, nothing is deleted). -->
		<v-alert type="info" variant="tonal" density="compact" class="mb-4" icon="mdi-information-outline">
			Quotas only stop vaults from <em>adding</em> more: a vault already above a lowered limit keeps what it has. Billing isn't part of this: plans are assigned by hand under Vaults.
		</v-alert>

		<v-card>
			<div class="table-wrap">
				<v-table>
					<thead>
						<tr><th>Plan</th><th>Books</th><th>Members</th><th>Storage</th><th>Vaults</th><th></th></tr>
					</thead>
					<tbody>
						<tr v-for="plan in plans" :key="plan.id">
							<td>
								<div class="font-weight-medium">{{ plan.name }} <v-chip v-if="plan.isDefault" size="x-small" color="primary" variant="tonal" class="ml-1">default</v-chip></div>
								<div class="text-caption text-medium-emphasis mono">{{ plan.code }}</div>
							</td>
							<td>{{ limit(plan.maxBooks) }}</td>
							<td>{{ limit(plan.maxMembers) }}</td>
							<td>{{ plan.maxStorageMb === null ? "Unlimited" : `${num(plan.maxStorageMb)} MB` }}</td>
							<td>{{ plan.vaultCount }}</td>
							<td class="text-right text-no-wrap">
								<template v-if="canWrite()">
									<v-btn v-if="!plan.isDefault" size="small" variant="text" @click="makeDefault(plan.id)">Make default</v-btn>
									<v-btn v-else size="small" variant="text" @click="makeDefault(null)">Clear default</v-btn>
									<v-btn size="small" variant="text" @click="edit(plan)">Edit</v-btn>
									<v-btn size="small" variant="text" color="error" @click="removing = plan">Delete</v-btn>
								</template>
							</td>
						</tr>
						<tr v-if="!plans.length"><td colspan="6" class="text-center text-medium-emphasis pa-8">No plans yet. Without one, nothing is limited.</td></tr>
					</tbody>
				</v-table>
			</div>
		</v-card>

		<!-- Create / edit a plan. Example: code "pro", name "Pro", 5000 books, 25 members, 2000 MB. -->
		<v-dialog v-model="dialog" max-width="460">
			<v-card class="pa-2">
				<v-card-title>{{ editing ? "Edit plan" : "New plan" }}</v-card-title>
				<v-card-text>
					<v-text-field v-model="form.name" label="Name" class="mb-3"/>
					<v-text-field v-if="!editing" v-model="form.code" label="Code" hint="Short and stable, e.g. free or pro." persistent-hint class="mb-3"/>
					<v-text-field v-model="form.maxBooks" label="Book limit" type="number" min="0" placeholder="Unlimited" class="mb-3"/>
					<v-text-field v-model="form.maxMembers" label="Member limit" type="number" min="1" placeholder="Unlimited" class="mb-3"/>
					<v-text-field v-model="form.maxStorageMb" label="Storage limit (MB)" type="number" min="0" placeholder="Unlimited" hint="Ebook files, covers and customer photos." persistent-hint/>
				</v-card-text>
				<v-card-actions>
					<v-spacer/>
					<v-btn variant="text" @click="dialog = false">Cancel</v-btn>
					<v-btn color="primary" variant="flat" :loading="saving" :disabled="!form.name || (!editing && !form.code)" @click="save">Save</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<confirm-danger-dialog :model-value="!!removing" title="Delete this plan?" action-label="Delete plan" :action="removePlan" @update:model-value="removing = null">
			<template v-if="removing">
				{{ removing.vaultCount }} {{ removing.vaultCount === 1 ? "vault uses" : "vaults use" }} <strong>{{ removing.name }}</strong>. They fall back to the default plan.
			</template>
		</confirm-danger-dialog>
	</div>
</template>

<script setup lang="ts">
import {onMounted, reactive, ref} from "vue";
import type {IPlan} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {num} from "@/utils/format";
import ConfirmDangerDialog from "@/components/ConfirmDangerDialog.vue";
import PageHeader from "@/components/PageHeader.vue";

const plans = ref<IPlan[]>([]);
const dialog = ref(false);
const editing = ref<IPlan | null>(null);
const saving = ref(false);
const removing = ref<IPlan | null>(null);
const form = reactive({name: "", code: "", maxBooks: "", maxMembers: "", maxStorageMb: ""});

/** null means unlimited: limit(null) -> "Unlimited", limit(5000) -> "5,000". */
const limit = (value: number | null) => (value === null ? "Unlimited" : num(value));
/** Form text to API value: "" -> null (unlimited), "50" -> 50. */
const toLimit = (value: string) => (value === "" || value === null ? null : Number(value));

async function load() {
	plans.value = await api.plans.list();
}

function edit(plan: IPlan | null) {
	editing.value = plan;
	form.name = plan?.name ?? "";
	form.code = plan?.code ?? "";
	form.maxBooks = plan?.maxBooks?.toString() ?? "";
	form.maxMembers = plan?.maxMembers?.toString() ?? "";
	form.maxStorageMb = plan?.maxStorageMb?.toString() ?? "";
	dialog.value = true;
}

async function save() {
	saving.value = true;
	try {
		const input = {name: form.name, maxBooks: toLimit(form.maxBooks), maxMembers: toLimit(form.maxMembers), maxStorageMb: toLimit(form.maxStorageMb)};
		if (editing.value) {
			await api.plans.update(editing.value.id, input);
		} else {
			await api.plans.create({...input, code: form.code});
		}
		dialog.value = false;
		notify("Plan saved.");
		await load();
	} finally {
		saving.value = false;
	}
}

async function makeDefault(id: number | null) {
	await api.plans.setDefault(id);
	await load();
}

async function removePlan() {
	await api.plans.remove(removing.value!.id);
	notify("Plan deleted.");
	await load();
}

onMounted(load);
</script>
