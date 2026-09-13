<template>
	<page-component :model="controller">
		<template v-slot:append>
			<v-btn
				@click="createLocation()"
				class="text-none"
				color="primary"
				small
				variant="elevated"
			>
				{{t(AppLabels.ADD)}}
			</v-btn>
		</template>

		<template v-slot:default>
			<empty-state
				v-if="locations.length === 0"
				icon="mdi-map-marker-plus-outline"
				:chip-icons="['mdi-map-marker-outline', 'mdi-warehouse', 'mdi-bookshelf', 'mdi-office-building-outline', 'mdi-map-marker-radius-outline', 'mdi-book-outline', 'mdi-store-outline', 'mdi-map-outline']"
				:title="t(AppLabels.EMPTY_LOCATIONS_TITLE)"
				:description="t(AppLabels.EMPTY_LOCATIONS_DESC)"
			>
				<v-btn
					@click="createLocation()"
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
					v-for="location in locations"
					:key="location.id"
					class="pb-card entity-card"
				>
					<div class="entity-card-header" @click="toggleExpand(location.id)">
						<v-icon color="primary" size="20">mdi-map-marker-outline</v-icon>

						<div class="entity-card-title-group">
							<span class="entity-card-name">{{ location.name }}</span>
							<span v-if="location.description" class="entity-card-desc">{{ location.description }}</span>
						</div>

						<v-chip v-if="location.default" density="compact" color="primary" variant="tonal" class="entity-card-default">{{t(AppLabels.DEFAULT)}}</v-chip>

						<v-chip density="compact" class="entity-card-count">{{ location.totalBooks }}</v-chip>

						<div class="entity-card-actions" @click.stop>
							<v-icon
								@click="setDefaultLocation(location.id)"
								:color="location.default ? 'primary' : undefined"
								size="small"
								class="mx-1"
								:title="t(AppLabels.SET_AS_DEFAULT_LOCATION)"
							>
								{{ location.default ? 'mdi-star' : 'mdi-star-outline' }}
							</v-icon>
							<v-icon
								@click="editLocation(location.id)"
								size="small"
								class="mx-1"
							>
								mdi-pencil
							</v-icon>
							<v-btn
								icon
								variant="text"
								density="compact"
								@click="deleteItem(location.id)"
								:loading="deleteLoading.includes(location.id)"
								:disabled="deleteLoading.includes(location.id)"
								class="mx-1"
							>
								<v-icon size="small" color="error">mdi-delete</v-icon>
							</v-btn>
						</div>

						<v-icon
							class="entity-card-chevron"
							:class="{'entity-card-chevron--open': expanded.includes(location.id)}"
						>
							mdi-chevron-down
						</v-icon>
					</div>

					<v-expand-transition>
						<div v-if="expanded.includes(location.id)" class="entity-card-body">
							<location-books-table :location="controller.getLocation(location.id)"/>
						</div>
					</v-expand-transition>
				</div>
			</div>

			<location-dialog
				v-if="dialog"
				v-model="dialog"
				:location="selectedLocation"
				:controller="controller"
			/>
		</template>
	</page-component>
</template>

<script setup lang="ts">
/**
 * Locations management view: a card per location (expanding a card shows
 * its books via `LocationBooksTable`), with inline edit/delete, an empty
 * state when there are none, and the add/edit dialog. Deletes also sync
 * `ApplicationService`'s cached location list.
 */
import PageComponent from "@/views/PageComponent.vue";
import LocationsController from "@/controller/locations/LocationsController";
import {computed, ref, Ref, ShallowRef, shallowRef} from "vue";
import LocationDialog from "@/views/locations/LocationDialog.vue";
import {confirmationDialogController} from "@/components/confirmationDialog/ConfirmationDialogController";
import {applicationService} from "@/service/ApplicationService";
import LocationExt from "@/model/location/LocationExt";
import LocationBooksTable from "@/views/locations/LocationBooksTable.vue";
import EmptyState from "@/components/emptyState/EmptyState.vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

const controller = new LocationsController();

const {t} = useI18n();

/**
 *
 */
const dialog: Ref<boolean> = ref(false);

/**
 *
 */
const selectedLocation: ShallowRef<LocationExt | undefined> = shallowRef(undefined);

/**
 *
 */
const deleteLoading: Ref<number[]> = ref([]);

/**
 * Ids of the location cards currently expanded to show their books.
 */
const expanded: Ref<number[]> = ref([]);

/**
 *
 */
const locations = computed(() => {
	return controller.getLocations().map(location => {
		return {
			id: location.getId(),
			name: location.getName(),
			description: location.getDescription(),
			default: location.isDefault(),
			totalBooks: location.getTotalBooks()
		}
	})
})

/**
 *
 * @param locationId
 */
async function setDefaultLocation(locationId: number) {
	await controller.setDefaultLocation(locationId);
	applicationService.setLocations(controller.getLocations())
}

/**
 *
 * @param locationId
 */
function editLocation(locationId: number) {
	const location = controller.getLocations().find(location => location.getId() === locationId);
	if (location) {
		selectedLocation.value = location;
		dialog.value = true;
	}
}

/**
 *
 */
function createLocation() {
	selectedLocation.value = undefined;
	dialog.value = true;
}

/**
 *
 * @param locationId
 */
async function deleteItem(locationId: number) {
	const location = controller.getLocation(locationId);
	confirmationDialogController.showDialog(
		`${t(AppLabels.DELETE_LOCATION)} ${location ? location.getName() : ''}`,
		t(AppLabels.DELETE_LOCATION_DESC),
		t(AppLabels.DELETE)
	).then(async () => {
		try {
			deleteLoading.value.push(locationId);
			await controller.deleteLocation(locationId);
			applicationService.setLocations(controller.getLocations())
		} finally {
			deleteLoading.value.splice(deleteLoading.value.indexOf(locationId), 1);
		}
	});
}

/**
 *
 * @param locationId
 */
function toggleExpand(locationId: number) {
	const index = expanded.value.indexOf(locationId);
	if (index === -1) {
		expanded.value.push(locationId);
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

.entity-card-desc {
	font-size: 12.5px;
	color: var(--pb-text-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.entity-card-count {
	flex-shrink: 0;
}

.entity-card-default {
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