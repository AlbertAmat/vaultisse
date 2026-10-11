<template>
	<v-snackbar
		v-model="isVisible"
		:timeout="-1"
		location="bottom"
		min-height="68"
		:elevation="4"
		class="cookie-consent"
	>
		<div class="d-flex align-center flex-wrap ga-2">
			<v-icon icon="mdi-cookie-outline" class="mr-1"/>

			<span style="flex: 1 1 260px;">
				{{ uiLabels.cookieConsentMessage }}
				<router-link :to="legalRoute.getPath('cookie-policy')" @click="isVisible = false">
					{{ uiLabels.cookieConsentLearnMore }}
				</router-link>
			</span>
		</div>

		<template v-slot:actions>
			<v-btn
				color="primary"
				variant="flat"
				density="comfortable"
				@click="accept"
			>
				{{ uiLabels.cookieConsentAccept }}
			</v-btn>
		</template>
	</v-snackbar>
</template>

<script setup lang="ts">
/**
 * One-time cookie consent banner, mounted in App.vue. Purely informational
 * (the app only sets the strictly-necessary session cookie, no opt-out is
 * offered) - "accept" just records the choice in `localStorage` so the
 * banner doesn't show again.
 */
import {computed, onMounted, ref} from "vue";
import {useI18n} from "vue-i18n";
import {legalUiLabels, normalizeLegalLocale} from "@/views/legal/legalData";
import {legalRoute} from "@/router/routes/LegalRoute";

const COOKIE_CONSENT_STORAGE_KEY = "pb_cookie_consent";

const {locale} = useI18n();

const isVisible = ref(false);

const uiLabels = computed(() => legalUiLabels[normalizeLegalLocale(locale.value)]);

function accept() {
	localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({accepted: true, date: new Date().toISOString()}));
	isVisible.value = false;
}

onMounted(() => {
	isVisible.value = !localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
});
</script>

<style scoped lang="scss">
.cookie-consent :deep(.v-snackbar__wrapper) {
	max-width: 640px;
	background: var(--pb-surface);
	border: 1px solid var(--pb-border);
	color: var(--pb-text);
}
</style>
