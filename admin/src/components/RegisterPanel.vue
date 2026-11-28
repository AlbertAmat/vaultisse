<template>
	<!--
	  Compliance > Registers: policies, suppliers, risks and assets (what an ISMS asks to keep). One table per kind, switched with the chips.
	  A policy past its review date turns control A.5.1 red; suppliers feed A.5.19, assets A.5.9.
	  Data:   GET/POST /compliance/register?kind=, PUT/DELETE /compliance/register/:id
	-->
	<div>
		<v-card>
			<div class="d-flex flex-wrap align-center ga-3 pa-4 pb-0">
				<v-chip-group v-model="kind" mandatory selected-class="text-primary" @update:model-value="load">
					<v-chip v-for="k in kinds" :key="k.value" :value="k.value" variant="text" filter>{{ k.plural }}</v-chip>
				</v-chip-group>
				<v-spacer/>
				<v-btn v-if="canWrite()" color="primary" variant="flat" prepend-icon="mdi-plus" @click="edit(null)">Add {{ current.single }}</v-btn>
			</div>
			<p class="text-body-2 text-medium-emphasis px-4 pt-3">{{ current.hint }}</p>
			<div class="table-wrap">
				<v-table>
					<thead><tr><th>Title</th><th>Owner</th><th v-if="current.rating">{{ current.rating }}</th><th>Status</th><th v-if="kind === 'policy'">Version</th><th>Next review</th><th></th></tr></thead>
					<tbody>
						<tr v-for="item in items" :key="item.id" class="row-click" @click="edit(item)">
							<td><div class="font-weight-medium">{{ item.title }}</div><div v-if="item.details" class="text-caption text-medium-emphasis text-truncate" style="max-width: 380px">{{ item.details }}</div></td>
							<td>{{ item.owner ?? "—" }}</td>
							<td v-if="current.rating"><v-chip v-if="item.rating" size="x-small" variant="tonal" :color="ratingColor[item.rating]">{{ item.rating }}</v-chip><template v-else>—</template></td>
							<td><v-chip size="x-small" variant="tonal" :color="item.status === 'active' ? 'success' : undefined">{{ item.status }}</v-chip></td>
							<td v-if="kind === 'policy'">{{ item.version ?? "—" }}</td>
							<td class="text-no-wrap" :class="{'text-error': overdue(item)}">{{ item.nextReviewAt ? dateOnly(item.nextReviewAt) : "—" }}</td>
							<td class="text-right"><v-btn v-if="item.referenceUrl" size="small" variant="text" icon="mdi-open-in-new" :href="item.referenceUrl" target="_blank" rel="noopener" aria-label="Open the document" @click.stop/></td>
						</tr>
						<tr v-if="!items.length"><td colspan="7" class="text-center text-medium-emphasis pa-6">Nothing listed yet.</td></tr>
					</tbody>
				</v-table>
			</div>
		</v-card>

		<v-dialog v-model="dialog" max-width="600" scrollable>
			<v-card>
				<v-card-title>{{ editing ? "Edit" : "Add" }} {{ current.single }}</v-card-title>
				<v-card-text>
					<v-text-field v-model="form.title" label="Title" maxlength="200" class="mb-3" :disabled="!canWrite()"/>
					<div class="d-flex ga-3 mb-3">
						<v-text-field v-model="form.owner" label="Owner" maxlength="100" :disabled="!canWrite()"/>
						<v-select v-model="form.status" :items="['draft', 'active', 'retired']" label="Status" :disabled="!canWrite()"/>
					</div>
					<div class="d-flex ga-3 mb-3">
						<v-select v-if="current.rating" v-model="form.rating" :items="['low', 'medium', 'high']" :label="current.rating" clearable :disabled="!canWrite()"/>
						<v-text-field v-if="kind === 'policy'" v-model="form.version" label="Version" maxlength="20" :disabled="!canWrite()"/>
					</div>
					<div class="d-flex ga-3 mb-3">
						<v-text-field v-if="kind === 'policy'" v-model="form.approvedAt" type="date" label="Approved on" :disabled="!canWrite()"/>
						<v-text-field v-model="form.nextReviewAt" type="date" label="Next review" :disabled="!canWrite()"/>
					</div>
					<v-textarea v-model="form.details" :label="current.details" rows="4" auto-grow maxlength="4000" class="mb-3" :disabled="!canWrite()"/>
					<v-text-field v-model="form.referenceUrl" :label="current.link" placeholder="https://" :disabled="!canWrite()"/>
				</v-card-text>
				<v-card-actions>
					<v-btn v-if="editing && canWrite()" color="error" variant="text" @click="remove">Remove</v-btn>
					<v-spacer/><v-btn variant="text" @click="dialog = false">Cancel</v-btn>
					<v-btn v-if="canWrite()" color="primary" variant="flat" :loading="saving" :disabled="!form.title.trim()" @click="save">Save</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref} from "vue";
import type {IRegisterEntry, RegisterKind} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {canWrite, notify} from "@/store";
import {dateOnly} from "@/utils/format";

const emit = defineEmits<{changed: []}>();

/** Per kind: names, which optional fields the form shows (rating, version, approval date) and the hint under the tabs. */
const kinds: {value: RegisterKind; single: string; plural: string; rating?: string; details: string; link: string; hint: string}[] = [
	{value: "policy", single: "policy", plural: "Policies", details: "What it covers", link: "Link to the document", hint: "Information security, access control, backup, incident response, acceptable use, record of processing (GDPR art. 30)... Each with its approval and next review (ISO/IEC 27001 A.5.1)."},
	{value: "supplier", single: "supplier", plural: "Suppliers", rating: "Criticality", details: "What they do for you and which data they handle", link: "Link to the contract or data processing agreement", hint: "Hosting, email delivery, backups, DNS, monitoring: everyone who handles your data or keeps the service running (A.5.19, GDPR art. 28)."},
	{value: "risk", single: "risk", plural: "Risks", rating: "Risk level", details: "The risk, its cause and how it is treated", link: "Link to the treatment plan", hint: "What could go wrong, how likely and how bad, and what you do about it (the risk register an ISMS asks for)."},
	{value: "asset", single: "asset", plural: "Assets", rating: "Criticality", details: "What it is, where it lives and what it holds", link: "Link to documentation", hint: "Servers, databases, backups, domains, accounts and services that carry information, each with an owner (A.5.9)."},
];
const ratingColor = {low: "success", medium: "warning", high: "error"} as const;

const kind = ref<RegisterKind>("policy");
const items = ref<IRegisterEntry[]>([]);
const dialog = ref(false);
const editing = ref<IRegisterEntry | null>(null);
const saving = ref(false);
const form = reactive({title: "", owner: "", status: "active" as "draft" | "active" | "retired", rating: null as "low" | "medium" | "high" | null, version: "", details: "", referenceUrl: "", approvedAt: "", nextReviewAt: ""});
const current = computed(() => kinds.find((k) => k.value === kind.value)!);
const today = () => new Date().toISOString().slice(0, 10);
const overdue = (item: IRegisterEntry) => item.status === "active" && !!item.nextReviewAt && item.nextReviewAt < today();

function edit(item: IRegisterEntry | null) {
	editing.value = item;
	form.title = item?.title ?? "";
	form.owner = item?.owner ?? "";
	form.status = item?.status ?? "active";
	form.rating = item?.rating ?? null;
	form.version = item?.version ?? "";
	form.details = item?.details ?? "";
	form.referenceUrl = item?.referenceUrl ?? "";
	form.approvedAt = item?.approvedAt ?? "";
	form.nextReviewAt = item?.nextReviewAt ?? "";
	dialog.value = true;
}

async function save() {
	saving.value = true;
	try {
		const input = {
			kind: kind.value, title: form.title.trim(), owner: form.owner.trim() || null, status: form.status, rating: form.rating,
			version: form.version.trim() || null, details: form.details.trim() || null, referenceUrl: form.referenceUrl.trim() || null,
			approvedAt: form.approvedAt || null, nextReviewAt: form.nextReviewAt || null,
		};
		if (editing.value) await api.compliance.updateRegister(editing.value.id, input);
		else await api.compliance.createRegister(input);
		notify("Saved.");
		dialog.value = false;
		await load();
		emit("changed");
	} finally {
		saving.value = false;
	}
}

async function remove() {
	if (!editing.value) return;
	await api.compliance.removeRegister(editing.value.id);
	notify("Removed.");
	dialog.value = false;
	await load();
	emit("changed");
}

async function load() {
	items.value = await api.compliance.register(kind.value);
}

onMounted(load);
</script>
