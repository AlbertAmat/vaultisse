<template>
	<v-dialog v-model="dialog" width="700">
		<v-card height="640">
			<v-card-title class="d-flex">
				{{t(AppLabels.CARD_SCAN)}}
				<v-spacer/>
				<v-btn variant="text" density="compact" icon @click="dialog = false">
					<v-icon>mdi-close</v-icon>
				</v-btn>
			</v-card-title>
			<v-divider/>

			<v-card-text>
				<!-- Handheld scanners type the code and press Enter. -->
				<v-text-field
					v-model="cardCode"
					:label="t(AppLabels.CARD_CODE)"
					variant="outlined"
					density="compact"
					hide-details
					autofocus
					:loading="scanning"
					@keydown.enter="scan(cardCode)"
				>
					<template v-slot:append-inner>
						<barcode-scanner @value="scan"/>
					</template>
				</v-text-field>

				<template v-if="activity">
					<div class="d-flex align-center my-4" style="gap: 14px">
						<v-avatar v-if="activity.customer.photo" size="64" rounded="lg">
							<v-img :src="activity.customer.photo" cover/>
						</v-avatar>
						<div>
							<div style="font-weight: 600">{{activity.customer.name}}</div>
							<div class="text-medium-emphasis">{{activity.customer.group_name || t(AppLabels.NO_GROUP)}}</div>
						</div>
					</div>

					<v-text-field
						ref="bookInput"
						v-model="bookCode"
						:label="t(AppLabels.CARD_LEND_SCAN)"
						variant="outlined"
						density="compact"
						hide-details
						:loading="lending"
						@keydown.enter="lend(bookCode)"
					>
						<template v-slot:append-inner>
							<barcode-scanner @value="lend"/>
						</template>
					</v-text-field>

					<v-tabs v-model="tab" density="compact" color="primary" class="mt-3">
						<v-tab value="loans" class="text-none">{{t(AppLabels.DASHBOARD_ON_LOAN)}} ({{activity.loans.length}})</v-tab>
						<v-tab value="history" class="text-none">{{t(AppLabels.LOAN_HISTORY)}}</v-tab>
					</v-tabs>

					<v-window v-model="tab">
						<v-window-item value="loans">
							<v-list density="compact">
								<v-list-item
									v-for="loan in activity.loans"
									:key="loan.code"
									:title="loan.name"
									:subtitle="`${loan.code} · ${t(AppLabels.LOANED_ON)} ${formatDate(loan.loaned_at)}`"
								>
									<template v-slot:append>
										<v-btn
											variant="outlined"
											density="compact"
											class="text-none"
											:disabled="returning.includes(loan.code)"
											@click="giveBack(loan.code)"
										>
											{{t(AppLabels.RETURN)}}
										</v-btn>
									</template>
								</v-list-item>
							</v-list>
						</v-window-item>
						<v-window-item value="history">
							<v-list density="compact">
								<v-list-item
									v-for="(entry, index) in activity.history"
									:key="index"
									:title="entry.book_name"
									:subtitle="`${entry.stock_code} · ${t(AppLabels.LOANED_ON)} ${formatDate(entry.loaned_at)} · ${entry.returned_at ? `${t(AppLabels.RETURNED_ON)} ${formatDate(entry.returned_at)}` : t(AppLabels.STILL_ON_LOAN)}`"
								/>
							</v-list>
						</v-window-item>
					</v-window>
				</template>
			</v-card-text>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * The lending desk: scan a library card to see what its owner has and has
 * had, then scan books to lend them (or return them from the list).
 */
import {computed, nextTick, ref, Ref, shallowRef} from "vue";
import {useI18n} from "vue-i18n";
import {ICardActivity} from "@vaultisse/types/customer/ICustomerCard";
import {api} from "@/plugins/api";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {appSnackbarController} from "@/components/appSnackbar/AppSnackbarController";
import BarcodeScanner from "@/components/barcodeScanner/BarcodeScanner.vue";

const props = defineProps<{modelValue: boolean}>();
const emit = defineEmits<{
	(e: 'update:modelValue', value: boolean): void
	/** A loan or return happened, so loan counts elsewhere are stale. */
	(e: 'changed'): void
}>();
const {t} = useI18n();

const dialog = computed({
	get: () => props.modelValue,
	set: (val: boolean) => emit('update:modelValue', val),
});

const cardCode = ref("");
const bookCode = ref("");
const activity = shallowRef<ICardActivity | null>(null);
const tab = ref("loans");
const scanning = ref(false);
const lending = ref(false);
const returning: Ref<string[]> = ref([]);
const bookInput = ref<HTMLInputElement | null>(null);

const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString() : "-";

async function scan(code: string) {
	if (!code.trim() || scanning.value) {
		return;
	}
	try {
		scanning.value = true;
		// Clear first: a failed scan must not leave the previous customer on screen.
		activity.value = null;
		activity.value = await api.customers.scanCard(code.trim());
		tab.value = "loans";
		await nextTick();
		bookInput.value?.focus();
	} catch (e) {
		console.error("Error scanning card", e);
	} finally {
		cardCode.value = "";
		scanning.value = false;
	}
}

async function lend(code: string) {
	const current = activity.value;
	if (!current || !code.trim() || lending.value) {
		return;
	}
	try {
		lending.value = true;
		const updated = await api.customers.lendByScan(current.customer.id, code.trim());
		// Ignore the answer if another card was scanned meanwhile.
		if (activity.value === current) {
			activity.value = updated;
		}
		tab.value = "loans";
		appSnackbarController.show({message: t(AppLabels.SNACKBAR_BOOK_LENT)});
		emit('changed');
	} catch (e) {
		console.error("Error lending by scan", e);
	} finally {
		bookCode.value = "";
		lending.value = false;
	}
}

async function giveBack(code: string) {
	const current = activity.value;
	if (!current) {
		return;
	}
	try {
		returning.value.push(code);
		await api.customers.removeCustomerBook(current.customer.id, code);
		const updated = await api.customers.scanCard(current.customer.uuid);
		if (activity.value?.customer.id === current.customer.id) {
			activity.value = updated;
		}
		appSnackbarController.show({message: t(AppLabels.SNACKBAR_RETURN_BOOKS)});
		emit('changed');
	} catch (e) {
		console.error("Error returning book", e);
	} finally {
		returning.value = returning.value.filter((item) => item !== code);
	}
}
</script>
