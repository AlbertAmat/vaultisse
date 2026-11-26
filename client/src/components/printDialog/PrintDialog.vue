<template>
	<v-menu
		v-model="model"
		location="end"
		:offset="15"
		:close-on-content-click="false"
	>
		<template v-slot:activator="{ props }">
			<v-list-item
				nav
				v-bind="props"
				:title="t(AppLabels.PRINT_QUEUE)"
				prepend-icon="mdi-printer-outline"
				density="compact"
				class="mx-2 print-queue-item"
			>
				<template v-slot:prepend>
					<v-badge
						location="top right"
						color="primary"
						:content="printDialogController.getTotalLabels()"
					>
						<v-icon
							icon="mdi-printer-outline"
							:color="printDialogController.getTotalLabels() == 0 ? undefined : 'primary'"
						/>
					</v-badge>
				</template>
			</v-list-item>
		</template>

		<v-card rounded width="400px">
			<v-card-title
				class="print-dialog-header py-2"
			>
				<span>{{t(AppLabels.PRINT_QUEUE)}}</span>

				<v-spacer/>

				<v-btn
					@click="model = false"
					variant="text"
					density="compact"
					icon
				>
					<v-icon>mdi-close</v-icon>
				</v-btn>
			</v-card-title>

			<v-card-text class="pt-3 pb-2" style="font-size: 14px">
				{{t(AppLabels.TOTAL_LABELS_TO_PRINT)}} <b>{{controller.getTotalLabels()}}</b>
			</v-card-text>

			<v-list
				v-if="controller.getTotalLabels() > 0"
				density="compact"
				class="print-queue-list py-0"
			>
				<v-list-item
					v-for="(item, code) in controller.getLabels()"
					:key="code"
					:title="item.name"
					:subtitle="code"
					density="compact"
				>
					<template v-slot:prepend>
						<img
							v-if="item.imageUrl != null"
							:src="item.imageUrl"
							class="print-queue-thumb"
						/>
						<div
							v-else
							class="print-queue-thumb print-queue-thumb-placeholder"
						>
							<v-icon size="small">mdi-image-outline</v-icon>
						</div>
					</template>

					<template v-slot:append>
						<v-btn
							@click="controller.removeLabel(code)"
							:title="t(AppLabels.DELETE)"
							icon="mdi-close"
							variant="text"
							density="compact"
							size="small"
						/>
					</template>
				</v-list-item>
			</v-list>

			<div v-if="canEditCatalog" class="px-3 pb-3">
				<v-btn
					@click="addPending()"
					:loading="loadingPending"
					:disabled="loadingPending"
					prepend-icon="mdi-printer-pos-plus-outline"
					variant="tonal"
					color="primary"
					density="compact"
					class="text-none"
					block
				>
					{{t(AppLabels.PRINT_ADD_PENDING)}}
				</v-btn>
			</div>

			<v-divider/>

			<v-card-actions class="pr-4">
				<v-spacer/>
				<v-btn
					@click="controller.cancel()"
					variant="text"
					density="compact"
					color="error"
					class="mr-3 text-none"
				>
					{{t(AppLabels.CLEAR_QUEUE)}}
				</v-btn>

				<v-btn
					@click="controller.print()"
					color="primary"
					variant="elevated"
					density="compact"
					class="text-none"
				>
					{{t(AppLabels.PRINT)}}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-menu>
</template>

<script setup lang="ts">
/**
 * Print-queue menu shown from the app menu: displays how many barcode
 * labels are queued (added via `printDialogController.addLabel()` when a
 * book stock is created) and lets the user print them all as one PDF or
 * clear the queue. See PrintDialogController.ts.
 */
import {printDialogController} from "@/components/printDialog/PrintDialogController";
import {computed, ref} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {api} from "@/plugins/api";
import {applicationService} from "@/service/ApplicationService";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import BookStock from "@/model/book/BookStock";

const controller = printDialogController;

const {t} = useI18n();

const canEditCatalog = computed(() => applicationService.canEditCatalog());

const loadingPending = ref(false);

/** Queues the copies whose label was never printed, a batch at a time. */
async function addPending() {
	try {
		loadingPending.value = true;
		const {total, stocks} = await api.books.getPendingLabels();
		if (total === 0) {
			appSnackbarController.show({message: t(AppLabels.SNACKBAR_NO_PENDING_LABELS)});
			return;
		}
		const added = controller.addLabels(stocks.map((stock) => ({
			code: stock.code,
			name: stock.name,
			label: BookStock.drawLabel(stock.code, stock.name),
			imageUrl: stock.image_url
		})));
		const remaining = total - stocks.length;
		appSnackbarController.show({
			message: remaining > 0
				? t(AppLabels.SNACKBAR_PENDING_LABELS_MORE, {count: added, remaining})
				: t(AppLabels.SNACKBAR_PENDING_LABELS_ADDED, {count: added})
		});
	} catch (e) {
		console.error("Error adding pending labels", e);
	} finally {
		loadingPending.value = false;
	}
}

const model = computed({
	get() {
		return controller.isVisible();
	},
	set(value: boolean) {
		controller.setVisible(value);
	}
})

</script>

<style scoped lang="scss">
/* Matches AppMenu.vue's .app-menu-item - this activator sits in the same
   nav list (below the divider), so it needs the same muted nav text color
   instead of Vuetify's default list-item color. */
.print-queue-item {
	color: var(--pb-nav-text-muted);
}

.print-queue-list {
	max-height: 240px;
	overflow-y: auto;
}

.print-queue-thumb {
	height: 40px;
	width: 30px;
	margin-right: 10px;
	border-radius: 2px;
	object-fit: cover;
}

.print-queue-thumb-placeholder {
	background-color: var(--pb-surface-alt);
	display: flex;
	align-items: center;
	justify-content: center;
}

.print-dialog-header {
	display:flex;
	align-items: center;
	font-family: var(--pb-font-display);
	background-color: var(--pb-nav-bg);
	color: var(--pb-nav-text);
}
</style>