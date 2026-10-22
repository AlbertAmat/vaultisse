<template>
	<v-dialog
		v-model="model"
		width="600"
		persistent
		:close-on-content-click="false"
	>
		<v-card>
			<v-card-title
				class="bg-error py-3 pr-2 d-flex align-center"
			>
				<v-icon
					color="white"
					class="mr-3"
				>
					mdi-alert
				</v-icon>

				{{t(AppLabels.ERROR_OCCURRED)}}
				<v-spacer></v-spacer>

				<v-btn
					density="comfortable"
					variant="text"
					icon
					@click="model = false"
				>
					<v-icon>mdi-close</v-icon>
				</v-btn>
			</v-card-title>

			<v-divider/>

			<v-card-text style="min-height: 60px; padding-top: 20px">
				{{ errorText }}
			</v-card-text>

			<v-divider></v-divider>

			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn
					density="comfortable"
					variant="text"
					@click="model = false"
					class="text-none ml-1"
				>
					{{ t(AppLabels.CLOSE) }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Single app-wide error dialog, mounted once in App.vue. Displayed by
 * the API client's `onError` handler for any unhandled API error (see
 * `plugins/api.ts`), showing the server's response body if present.
 */
import {errorDialogController} from "@/components/errorDialog/ErrorDialogController";
import {computed} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

const {t} = useI18n();

const controller = errorDialogController;

/**
 * The text to show: the server's `{ "error": "..." }` message when it sent one,
 * otherwise its raw response body, otherwise the client-side error message.
 */
const errorText = computed(() => {
	const error = controller.getError();
	const data: unknown = error?.response?.data;
	if (data === undefined || data === null || data === "") {
		return error?.message ?? "";
	}
	if (typeof data === "object" && typeof (data as {error?: unknown}).error === "string") {
		return (data as {error: string}).error;
	}
	return typeof data === "string" ? data : JSON.stringify(data);
});

const model = computed({
	get() {
		return controller.isVisible();
	},
	set(val: boolean) {
		controller.setVisible(val);
	}
})
</script>