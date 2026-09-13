<template>
	<page-component :model="controller">
		<template v-slot:append>
			<template v-if="activeTab === 'customers'">
				<v-btn
					@click="createCustomer()"
					class="text-none ml-3"
					color="primary"
					small
					variant="elevated"
				>
					{{t(AppLabels.ADD)}}
				</v-btn>
			</template>

			<v-btn
				v-else
				@click="groupsTree?.createGroup()"
				class="text-none ml-3"
				color="primary"
				small
				variant="elevated"
			>
				{{t(AppLabels.ADD)}}
			</v-btn>
		</template>

		<template v-slot:default>
			<v-tabs v-model="activeTab" density="compact" class="mb-4" color="primary">
				<v-tab value="customers" class="text-none">{{t(AppLabels.CUSTOMERS)}}</v-tab>
				<v-tab value="groups"  class="text-none">{{t(AppLabels.GROUPS)}}</v-tab>
			</v-tabs>

			<v-window v-model="activeTab" style="flex: 1; height: 100%; display: flex; flex-direction: column">
				<v-window-item value="customers" style="flex: 1; display: flex; flex-direction: column">
					<empty-state
						v-if="customers.length === 0"
						icon="mdi-account-plus-outline"
						:chip-icons="['mdi-account-outline', 'mdi-account-group-outline', 'mdi-book-account-outline', 'mdi-account-heart-outline', 'mdi-book-outline', 'mdi-account-edit-outline', 'mdi-account-multiple-outline', 'mdi-book-open-page-variant']"
						:title="t(AppLabels.EMPTY_CUSTOMERS_TITLE)"
						:description="t(AppLabels.EMPTY_CUSTOMERS_DESC)"
					>
						<v-btn
							@click="createCustomer()"
							class="text-none"
							color="primary"
							small
							variant="elevated"
						>
							{{t(AppLabels.ADD)}}
						</v-btn>
					</empty-state>

					<div v-else class="entity-card-list">
						<div
							v-for="customer in customers"
							:key="customer.id"
							class="pb-card entity-card"
						>
							<div class="entity-card-header" @click="toggleExpand(customer.id)">
								<v-icon color="primary" size="20">mdi-account-outline</v-icon>

								<div class="entity-card-title-group">
									<span class="entity-card-name">{{ customer.name }}</span>
								</div>

								<v-chip v-if="customer.groupName" density="compact" class="entity-card-group">{{ customer.groupName }}</v-chip>
								<span v-else class="text-medium-emphasis entity-card-group">{{ t(AppLabels.NO_GROUP) }}</span>

								<v-chip density="compact" class="entity-card-count">{{ customer.totalBooks }}</v-chip>

								<div class="entity-card-actions" @click.stop>
									<v-icon
										@click="editCustomer(customer.id)"
										size="small"
										class="mx-1"
									>
										mdi-pencil
									</v-icon>
									<v-btn
										icon
										variant="text"
										density="compact"
										@click="deleteItem(customer.id)"
										:loading="deleteLoading.includes(customer.id)"
										:disabled="deleteLoading.includes(customer.id)"
										class="mx-1"
									>
										<v-icon size="small" color="error">mdi-delete</v-icon>
									</v-btn>
								</div>

								<v-icon
									class="entity-card-chevron"
									:class="{'entity-card-chevron--open': expanded.includes(customer.id)}"
								>
									mdi-chevron-down
								</v-icon>
							</div>

							<v-expand-transition>
								<div v-if="expanded.includes(customer.id)" class="entity-card-body">
									<customer-books-table :customer="controller.getCustomer(customer.id)"/>
								</div>
							</v-expand-transition>
						</div>
					</div>
				</v-window-item>

				<v-window-item value="groups">
					<customer-groups-tree
						ref="groupsTree"
						:groups-controller="groupsController"
						:customers-controller="controller"
					/>
				</v-window-item>
			</v-window>

			<customer-dialog
				v-if="dialog"
				v-model="dialog"
				:customer="selectedCustomer"
				:controller="controller"
				:groups-controller="groupsController"
			/>
		</template>
	</page-component>
</template>

<script setup lang="ts">
/**
 * Customers management view: two tabs - a card per customer (expanding a
 * card shows their loaned books via `CustomerBooksTable`) with inline
 * edit/delete, and a groups tab (`CustomerGroupsTree`). Runs
 * `CustomersController` and `CustomerGroupsController` side by side since
 * both tabs share one page.
 */
import PageComponent from "@/views/PageComponent.vue";
import {computed, ref, Ref, ShallowRef, shallowRef} from "vue";
import CustomerDialog from "@/views/customers/components/CustomerDialog.vue";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";
import CustomersController from "@/controller/customers/CustomersController";
import CustomerGroupsController from "@/controller/customers/CustomerGroupsController";
import Customer from "@/model/customer/Customer";
import CustomerBooksTable from "@/views/customers/components/CustomerBooksTable.vue";
import EmptyState from "@/components/emptyState/EmptyState.vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import CustomerGroupsTree from "@/views/customers/components/CustomerGroupsTree.vue";
import CustomerDetail from "@/model/customer/CustomerDetail";

const controller = new CustomersController();
const groupsController = new CustomerGroupsController();

const {t} = useI18n();

/**
 *
 */
const activeTab: Ref<string> = ref("customers");

/**
 *
 */
const groupsTree: ShallowRef<InstanceType<typeof CustomerGroupsTree> | null> = shallowRef(null);

/**
 *
 */
const dialog: Ref<boolean> = ref(false);

/**
 *
 */
const selectedCustomer: ShallowRef<CustomerDetail | undefined> = shallowRef(undefined);

/**
 *
 */
const deleteLoading: Ref<number[]> = ref([]);

/**
 * Ids of the customer cards currently expanded to show their loaned books.
 */
const expanded: Ref<number[]> = ref([]);

/**
 *
 */
const customers = computed(() => {
	return controller.getCustomers().map(customer => {
		return {
			id: customer.getCustomerId(),
			name: customer.getCustomerName(),
			totalBooks: customer.getTotalBooks(),
			groupName: customer.getGroupName()
		}
	})
})

/**
 *
 * @param customerId
 */
function editCustomer(customerId: number) {
	const customer =  controller.getCustomers().find(customer => customer.getCustomerId() === customerId);
	if(customer) {
		selectedCustomer.value = customer;
		dialog.value = true;
	}
}

/**
 *
 */
function createCustomer() {
	selectedCustomer.value = undefined;
	dialog.value = true;
}

/**
 *
 * @param customerId
 */
async function deleteItem(customerId: number) {
	const customer = controller.getCustomer(customerId);
	confirmationDialogController.showDialog(
		`${t(AppLabels.DELETE_CUSTOMER)} ${customer ? customer.getCustomerName() : ''}`,
		t(AppLabels.DELETE_CUSTOMER_DESC),
		t(AppLabels.DELETE)
	).then(async () => {
		try {
			deleteLoading.value.push(customerId);
			await controller.deleteCustomer(customerId);
		} finally {
			deleteLoading.value.splice(deleteLoading.value.indexOf(customerId), 1);
		}
	});
}

/**
 *
 * @param customerId
 */
function toggleExpand(customerId: number) {
	const index = expanded.value.indexOf(customerId);
	if (index === -1) {
		expanded.value.push(customerId);
	} else {
		expanded.value.splice(index, 1);
	}
}

</script>

<style scoped lang="scss">
.entity-card-list {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.entity-card {
	overflow: hidden;
}

.entity-card-header {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 14px 18px;
	cursor: pointer;
}

.entity-card-title-group {
	flex: 1;
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.entity-card-name {
	font-size: 14px;
	font-weight: 600;
	color: var(--pb-text);
}

.entity-card-group {
	flex-shrink: 0;
	font-size: 12.5px;
}

.entity-card-count {
	flex-shrink: 0;
}

.entity-card-actions {
	display: flex;
	align-items: center;
	flex-shrink: 0;
}

.entity-card-chevron {
	flex-shrink: 0;
	transition: transform 0.15s ease;
	opacity: 0.7;
}

.entity-card-chevron--open {
	transform: rotate(180deg);
}

.entity-card-body {
	border-top: 1px solid var(--pb-border);
}
</style>