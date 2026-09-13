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
				<v-alert
					v-if="errorMessage"
					type="error"
					density="compact"
					class="mb-4"
				>
					{{errorMessage}}
				</v-alert>

				<video v-show="!errorMessage" ref="videoRef" class="barcode-reader" muted playsinline></video>
			</v-card-text>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Small icon button that opens a dialog using the device camera (via
 * @zxing/browser, which is far more reliable at 1D/EAN-13 detection than
 * the unmaintained html5-qrcode this used to rely on) to scan a
 * barcode/QR code. Emits `value` with the decoded text and auto-closes on
 * the first successful scan. Used anywhere a stock code or ISBN can be
 * typed, as a camera-based alternative.
 *
 * Uses a template ref (not `getElementById`) for the video element because
 * several instances of this component can be mounted at once (global app
 * bar + a dialog on the current page) - looking the element up by a shared
 * id would attach the reader to whichever instance's element happens to be
 * first in the DOM instead of the one the user actually opened.
 */
import { nextTick, ref, watch } from "vue";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, ChecksumException, DecodeHintType, FormatException, NotFoundException } from "@zxing/library";
import { useI18n } from "vue-i18n";
import { AppLabels } from "@/plugins/i18n/AppLabels";

const emit = defineEmits<{
	(e: 'value', value: string): void
}>()

const {t} = useI18n();

const dialog = ref(false);
const videoRef = ref<HTMLVideoElement | null>(null);
const errorMessage = ref<string | null>(null);

const hints = new Map();
// ISBNs are always EAN-13. Keep a couple of related 1D formats plus QR
// (this component doubles as a generic stock-code scanner) rather than
// leaving every format enabled, which slows down and confuses the decoder.
hints.set(DecodeHintType.POSSIBLE_FORMATS, [
	BarcodeFormat.EAN_13,
	BarcodeFormat.EAN_8,
	BarcodeFormat.UPC_A,
	BarcodeFormat.UPC_E,
	BarcodeFormat.CODE_128,
	BarcodeFormat.QR_CODE,
]);
hints.set(DecodeHintType.TRY_HARDER, true);

// The default delayBetweenScanAttempts (500ms, i.e. 2 decode attempts per
// second) is far too slow for a handheld 1D barcode scan: the video preview
// itself still looks sharp at full framerate, but the decoder only gets 2
// still frames a second to work with, and any one of those can land
// mid-motion-blur or slightly misaligned. Match roughly the old
// html5-qrcode config (fps: 10) instead.
const codeReader = new BrowserMultiFormatReader(hints, {delayBetweenScanAttempts: 100});
let controls: { stop: () => void } | null = null;

function stopScanner() {
	controls?.stop();
	controls = null;
}

watch(dialog, async (val) => {
	if (val) {
		errorMessage.value = null;

		// Camera access is blocked outright on an insecure origin (plain
		// HTTP) - fail fast with an actionable message instead of letting
		// getUserMedia throw an opaque error later.
		if (!window.isSecureContext) {
			errorMessage.value = t(AppLabels.BARCODE_SCANNER_INSECURE_CONNECTION);
			return;
		}

		await nextTick();
		if (!videoRef.value) {
			return;
		}

		try {
			controls = await codeReader.decodeFromConstraints(
				{
					video: {
						facingMode: "environment",
						// Ask for a bigger frame than the getUserMedia default
						// (often 640x480) - EAN-13's narrow bars need more
						// pixels to resolve cleanly. "ideal" so it's just a
						// preference, not a hard requirement.
						width: {ideal: 1920},
						height: {ideal: 1080},
						// Best-effort only: unsupported "advanced" constraints
						// are ignored per spec rather than rejected, so this is
						// safe on browsers (like iOS Safari/Chrome) that don't
						// support focusMode.
						advanced: [{focusMode: "continuous"}] as unknown as MediaTrackConstraintSet[],
					},
				},
				videoRef.value,
				(result, error) => {
					if (result) {
						emit("value", result.getText());
						dialog.value = false;
						stopScanner();
						return;
					}
					// NotFoundException/ChecksumException/FormatException just mean no
					// valid barcode was found in this particular frame, which zxing
					// throws on almost every frame during normal scanning. Anything
					// else is a real decoding problem worth surfacing.
					const isExpectedMiss = error instanceof NotFoundException
						|| error instanceof ChecksumException
						|| error instanceof FormatException;
					if (error && !isExpectedMiss) {
						console.warn("Barcode scan error:", error);
					}
				}
			);
		} catch (err) {
			console.error("Camera start error:", err);
			errorMessage.value = t(AppLabels.BARCODE_SCANNER_CAMERA_ERROR);
		}
	} else {
		stopScanner();
	}
});
</script>

<style scoped lang="scss">
.barcode-reader {
	width: 100%;
	height: 250px;
	object-fit: cover;
	border: 2px dashed var(--pb-border-strong);
	border-radius: 8px;
	overflow: hidden;
}
</style>
