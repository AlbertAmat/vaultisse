<template>
	<div>
		<p class="text-caption text-medium-emphasis mb-3">
			{{ t(AppLabels.GROUPS_DRAG_DROP_HINT) }}
		</p>

		<v-table density="compact">
			<thead>
				<tr>
					<th style="width: 40px"></th>
					<th>{{t(AppLabels.NAME)}}</th>
					<th>{{t(AppLabels.DESCRIPTION)}}</th>
					<th>{{t(AppLabels.TOTAL_CUSTOMERS)}}</th>
					<th class="text-right">{{t(AppLabels.ACTIONS)}}</th>
				</tr>
			</thead>
			<tbody>
				<template v-for="row in groupRows" :key="row.key">
					<tr
						:class="{'drop-target': dragOverKey === row.key}"
						@dragover.prevent="onDragOverGroup(row.key)"
						@dragleave="onDragLeaveGroup(row.key)"
						@drop="onDropOnGroup($event, row)"
					>
						<td>
							<v-btn
								icon
								variant="text"
								density="compact"
								size="small"
								@click="toggleExpand(row.key)"
							>
								<v-icon size="small">{{ expandedKeys.has(row.key) ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
							</v-btn>
						</td>
						<td>{{ row.name }}</td>
						<td>{{ row.description }}</td>
						<td><v-chip density="compact">{{ row.totalCustomers }}</v-chip></td>
						<td class="text-right">
							<template v-if="!row.isUnassigned">
								<v-icon
									@click="editGroup(row.id!)"
									small
									class="mx-1"
								>
									mdi-pencil
								</v-icon>
								<v-btn
									icon
									variant="text"
									density="compact"
									@click="deleteGroupRow(row.id!)"
									:loading="deleteLoading.includes(row.id!)"
									:disabled="deleteLoading.includes(row.id!)"
									class="mx-1"
								>
									<v-icon small color="error">mdi-delete</v-icon>
								</v-btn>
							</template>
						</td>
					</tr>

					<tr v-if="expandedKeys.has(row.key)">
						<td :colspan="5" class="pa-0">
							<v-sheet class="pa-3" style="background: var(--pb-surface-alt)">
								<div v-if="(selectedByGroup[row.key] || []).length > 0" class="d-flex align-center mb-3">
									<span class="mr-3"><b>{{ (selectedByGroup[row.key] || []).length }}</b> {{ t(AppLabels.SELECTED) }}</span>
									<v-select
										v-model="moveTargetByGroup[row.key]"
										:items="moveTargetItems(row.key)"
										item-title="title"
										item-value="value"
										:label="t(AppLabels.MOVE_TO_GROUP)"
										density="compact"
										variant="outlined"
										hide-details
										style="max-width: 240px"
										class="mr-2"
									></v-select>
									<v-btn
										size="small"
										color="primary"
										variant="elevated"
										class="text-none"
										:disabled="moveTargetByGroup[row.key] === undefined"
										:loading="batchMoveLoading"
										@click="batchMove(row)"
									>
										{{ t(AppLabels.MOVE) }}
									</v-btn>
								</div>

								<v-table density="compact">
									<thead>
										<tr>
											<th style="width: 40px">
												<v-checkbox
													:model-value="isAllSelected(row)"
													:indeterminate="isIndeterminate(row)"
													density="compact"
													hide-details
													@update:model-value="toggleSelectAll(row, $event)"
												></v-checkbox>
											</th>
											<th style="width: 30px"></th>
											<th>{{t(AppLabels.NAME)}}</th>
											<th class="text-right">{{t(AppLabels.ACTIONS)}}</th>
										</tr>
									</thead>
									<tbody>
										<tr
											v-for="member in membersOf(row)"
											:key="member.getCustomerId()"
											draggable="true"
											@dragstart="onDragStart($event, row, member)"
										>
											<td>
												<v-checkbox
													:model-value="(selectedByGroup[row.key] || []).includes(member.getCustomerId())"
													density="compact"
													hide-details
													@update:model-value="toggleSelect(row.key, member.getCustomerId(), $event)"
												></v-checkbox>
											</td>
											<td><v-icon size="small" class="text-medium-emphasis">mdi-drag</v-icon></td>
											<td>{{ member.getCustomerName() }}</td>
											<td class="text-right">
												<v-btn
													v-if="!row.isUnassigned"
													icon
													variant="text"
													density="compact"
													:loading="removeLoading.includes(member.getCustomerId())"
													:disabled="removeLoading.includes(member.getCustomerId())"
													@click="removeMember(row, member)"
												>
													<v-icon small color="error">mdi-close</v-icon>
												</v-btn>
											</td>
										</tr>

										<tr v-if="membersOf(row).length === 0">
											<td colspan="4" class="text-medium-emphasis">{{ t(AppLabels.NO_MEMBERS) }}</td>
										</tr>
									</tbody>
								</v-table>
							</v-sheet>
						</td>
					</tr>
				</template>
			</tbody>
		</v-table>

		<customer-group-dialog
			v-if="groupDialog"
			v-model="groupDialog"
			:group="selectedGroup"
			:controller="groupsController"
		/>
	</div>
</template>

<script setup lang="ts">
/**
 * Groups tab of the customers view: an expandable table of every group
 * (plus a synthetic "No group" row for unassigned customers) where
 * expanding a group lists its members with checkboxes for batch-move and
 * drag-and-drop support to move customers between groups. All moves go
 * through `moveCustomers`, which keeps each affected group's member count
 * in sync locally instead of re-fetching. Exposes `createGroup()` so the
 * parent view's toolbar "Add" button can open the create dialog for
 * whichever tab is active.
 */
import {computed, reactive, Ref, ref, ShallowRef, shallowRef} from 'vue'
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import CustomerGroupsController from "@/controller/customers/CustomerGroupsController";
import CustomersController from "@/controller/customers/CustomersController";
import CustomerGroup from "@/model/customer/CustomerGroup";
import CustomerDetail from "@/model/customer/CustomerDetail";
import CustomerGroupDialog from "@/views/customers/components/CustomerGroupDialog.vue";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";

interface Props {
	groupsController: CustomerGroupsController,
	customersController: CustomersController,
}

interface GroupRow {
	key: string;
	id: number | null;
	name: string;
	description?: string;
	totalCustomers: number;
	isUnassigned: boolean;
}

interface DragPayload {
	customerIds: number[];
	fromRow: GroupRow;
}

const UNASSIGNED_KEY = "unassigned";

const props = defineProps<Props>();

const {t} = useI18n();

/**
 *
 */
const expandedKeys = reactive(new Set<string>());

/**
 *
 */
const selectedByGroup = reactive<Record<string, number[]>>({});

/**
 *
 */
const moveTargetByGroup = reactive<Record<string, number | null | undefined>>({});

/**
 *
 */
const dragOverKey: Ref<string | null> = ref(null);

/**
 *
 */
const batchMoveLoading: Ref<boolean> = ref(false);

/**
 *
 */
const deleteLoading: Ref<number[]> = ref([]);

/**
 *
 */
const removeLoading: Ref<number[]> = ref([]);

/**
 *
 */
const groupDialog: Ref<boolean> = ref(false);

/**
 *
 */
const selectedGroup: ShallowRef<CustomerGroup | undefined> = shallowRef(undefined);

/**
 *
 */
let draggedPayload: DragPayload | null = null;

/**
 *
 */
const groupRows = computed<GroupRow[]>(() => {
	const rows: GroupRow[] = props.groupsController.getGroups().map(group => {
		return {
			key: `g-${group.getId()}`,
			id: group.getId(),
			name: group.getName(),
			description: group.getDescription(),
			totalCustomers: group.getTotalCustomers(),
			isUnassigned: false,
		}
	});

	const unassignedCount = props.customersController.getCustomers()
		.filter(customer => customer.getGroupId() == null).length;

	rows.push({
		key: UNASSIGNED_KEY,
		id: null,
		name: t(AppLabels.NO_GROUP),
		description: undefined,
		totalCustomers: unassignedCount,
		isUnassigned: true,
	});

	return rows;
})

/**
 *
 * @param row
 */
function membersOf(row: GroupRow): CustomerDetail[] {
	return props.customersController.getCustomers().filter(customer => customer.getGroupId() === row.id);
}

/**
 *
 * @param key
 */
function toggleExpand(key: string) {
	if (expandedKeys.has(key)) {
		expandedKeys.delete(key);
	} else {
		expandedKeys.add(key);
	}
}

/**
 *
 * @param key
 * @param customerId
 * @param checked
 */
function toggleSelect(key: string, customerId: number, checked: boolean | null) {
	const current = selectedByGroup[key] || [];
	if (checked) {
		selectedByGroup[key] = current.includes(customerId) ? current : [...current, customerId];
	} else {
		selectedByGroup[key] = current.filter(id => id !== customerId);
	}
}

/**
 *
 * @param row
 */
function isAllSelected(row: GroupRow): boolean {
	const members = membersOf(row);
	const selected = selectedByGroup[row.key] || [];
	return members.length > 0 && selected.length === members.length;
}

/**
 *
 * @param row
 */
function isIndeterminate(row: GroupRow): boolean {
	const selected = selectedByGroup[row.key] || [];
	return selected.length > 0 && !isAllSelected(row);
}

/**
 *
 * @param row
 * @param checked
 */
function toggleSelectAll(row: GroupRow, checked: boolean | null) {
	selectedByGroup[row.key] = checked ? membersOf(row).map(member => member.getCustomerId()) : [];
}

/**
 *
 * @param key
 */
function moveTargetItems(key: string) {
	const items: { title: string, value: number | null }[] = props.groupsController.getGroups()
		.filter(group => `g-${group.getId()}` !== key)
		.map(group => ({title: group.getName(), value: group.getId()}));

	if (key !== UNASSIGNED_KEY) {
		items.push({title: t(AppLabels.NO_GROUP), value: null});
	}

	return items;
}

/**
 * Moves a set of customers from one group to another, keeping every
 * affected group's customer count in sync.
 *
 * @param customerIds
 * @param fromRow
 * @param targetGroupId
 */
async function moveCustomers(customerIds: number[], fromRow: GroupRow, targetGroupId: number | null) {
	if (fromRow.id === targetGroupId) {
		return;
	}

	const targetGroup = targetGroupId != null ? props.groupsController.getGroup(targetGroupId) : undefined;

	for (const customerId of customerIds) {
		const customer = props.customersController.getCustomer(customerId);
		if (!customer) {
			continue;
		}

		const previousGroupId = customer.getGroupId();

		if (targetGroup) {
			await customer.assignToGroup(targetGroup.getId(), targetGroup.getName());
			targetGroup.incrementTotalCustomers();
		} else {
			await customer.removeFromGroup();
		}

		if (previousGroupId != null) {
			props.groupsController.getGroup(previousGroupId)?.decrementTotalCustomers();
		}
	}
}

/**
 *
 * @param row
 */
async function batchMove(row: GroupRow) {
	const targetId = moveTargetByGroup[row.key];
	const ids = selectedByGroup[row.key] || [];
	if (targetId === undefined || ids.length === 0) {
		return;
	}

	try {
		batchMoveLoading.value = true;
		await moveCustomers(ids, row, targetId);
		selectedByGroup[row.key] = [];
		moveTargetByGroup[row.key] = undefined;
	} finally {
		batchMoveLoading.value = false;
	}
}

/**
 *
 * @param event
 * @param row
 * @param member
 */
function onDragStart(event: DragEvent, row: GroupRow, member: CustomerDetail) {
	const selected = selectedByGroup[row.key] || [];
	const customerIds = selected.includes(member.getCustomerId()) && selected.length > 1
		? selected
		: [member.getCustomerId()];

	draggedPayload = {customerIds, fromRow: row};

	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", String(member.getCustomerId()));
	}
}

/**
 *
 * @param key
 */
function onDragOverGroup(key: string) {
	dragOverKey.value = key;
}

/**
 *
 * @param key
 */
function onDragLeaveGroup(key: string) {
	if (dragOverKey.value === key) {
		dragOverKey.value = null;
	}
}

/**
 *
 * @param event
 * @param row
 */
async function onDropOnGroup(event: DragEvent, row: GroupRow) {
	event.preventDefault();
	dragOverKey.value = null;

	if (!draggedPayload) {
		return;
	}

	const {customerIds, fromRow} = draggedPayload;
	draggedPayload = null;

	if (fromRow.key === row.key) {
		return;
	}

	await moveCustomers(customerIds, fromRow, row.id);
	selectedByGroup[fromRow.key] = (selectedByGroup[fromRow.key] || []).filter(id => !customerIds.includes(id));
}

/**
 *
 * @param row
 * @param member
 */
async function removeMember(row: GroupRow, member: CustomerDetail) {
	try {
		removeLoading.value.push(member.getCustomerId());
		await member.removeFromGroup();
		if (row.id != null) {
			props.groupsController.getGroup(row.id)?.decrementTotalCustomers();
		}
	} finally {
		removeLoading.value.splice(removeLoading.value.indexOf(member.getCustomerId()), 1);
	}
}

/**
 *
 */
function createGroup() {
	selectedGroup.value = undefined;
	groupDialog.value = true;
}

/**
 *
 * @param id
 */
function editGroup(id: number) {
	selectedGroup.value = props.groupsController.getGroup(id);
	groupDialog.value = true;
}

/**
 *
 * @param id
 */
async function deleteGroupRow(id: number) {
	const group = props.groupsController.getGroup(id);
	confirmationDialogController.showDialog(
		`${t(AppLabels.DELETE_GROUP)} ${group ? group.getName() : ''}`,
		t(AppLabels.DELETE_GROUP_DESC),
		t(AppLabels.DELETE)
	).then(async () => {
		try {
			deleteLoading.value.push(id);
			await props.groupsController.deleteGroup(id);
			await props.customersController.reload();
		} finally {
			deleteLoading.value.splice(deleteLoading.value.indexOf(id), 1);
		}
	});
}

defineExpose({createGroup});
</script>

<style scoped lang="scss">
.drop-target {
	background-color: rgba(33, 150, 243, 0.12);
}
</style>
