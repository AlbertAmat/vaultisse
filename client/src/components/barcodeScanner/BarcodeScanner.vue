<template>
	<v-dialog v-model="dialog" width="500">
		<template v-slot:activator="{ props: activatorProps }">
			<v-btn v-bind="activatorProps" variant="text" icon density="compact">
				<v-icon>mdi-barcode-scan</v-icon>
			</v-btn>
		</template>

		<v-card max-height="400px" min-height="300px">
			<v-card-title>{{t(AppLabels.SCAN_BARCODE)}}</v-card-title>
			<v-divider></v-divider>

			<v-card-text>
				<div id="barcode-reader" style="width:100%; height:250px;"></div>
			</v-card-text>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Small icon button that opens a dialog using the device camera (via
 * html5-qrcode) to scan a barcode/QR code. Emits `value` with the decoded
 * text and auto-closes on the first successful scan. Used anywhere a stock
 * code or ISBN can be typed, as a camera-based alternative.
 */
import { ref, watch} from "vue";
import { Html5Qrcode } from "html5-qrcode";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";

const emit = defineEmits<{
	(e: 'value', value: string): void
}>()

const {t} = useI18n();

const dialog = ref(false);
let html5QrCode: Html5Qrcode | null = null;

watch(dialog, async (val) => {
	if (val) {
		// Start scanner
		if (!html5QrCode) {
			setTimeout(async () => {
				console.log("dd", document.getElementById("barcode-reader"))
				html5QrCode = new Html5Qrcode("barcode-reader");

				try {
					await html5QrCode.start(
						{facingMode: "environment"},
						{fps: 10, qrbox: {width: 250, height: 250}},
						(decodedText) => {
							emit("value", decodedText);
							dialog.value = false;
							// Auto stop once detected
							html5QrCode?.stop();
						},
						(error) => {
							// Ignore scanning errors
						}
					);
				} catch (err) {
					console.error("Camera start error:", err);
				}
			}, 100)
		}
	} else {
		// Stop scanner
		if (html5QrCode) {
			await html5QrCode.stop();
			html5QrCode = null;
		}
	}
});

</script>

<style scoped lang="scss">
#barcode-reader {
	border: 2px dashed var(--pb-border-strong);
	border-radius: 8px;
	overflow: hidden;
}
</style>
