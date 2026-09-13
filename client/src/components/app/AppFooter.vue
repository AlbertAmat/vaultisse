<template>
	<v-footer app border="t" class="app-footer px-5">
		<span class="text-medium-emphasis">© {{ year }} {{ uiLabels.footerCopyright }}</span>
		<span v-if="version" class="text-medium-emphasis app-footer-version">v{{ version }}</span>

		<v-spacer></v-spacer>

		<router-link :to="legalRoute.getPath('privacy-policy')">{{ uiLabels.footerPrivacyPolicy }}</router-link>
		<router-link :to="legalRoute.getPath('terms-of-service')">{{ uiLabels.footerTermsOfService }}</router-link>
		<router-link :to="legalRoute.getPath('cookie-policy')">{{ uiLabels.footerCookiePolicy }}</router-link>
	</v-footer>
</template>

<script setup lang="ts">
/** App-wide footer: copyright line and links to the legal documents (see LegalRoute/legalData.ts). */
import {computed, onMounted, ref} from "vue";
import {useI18n} from "vue-i18n";
import {legalUiLabels, normalizeLegalLocale} from "@/views/legal/legalData";
import {legalRoute} from "@/router/routes/LegalRoute";
import {appService} from "@/service/app/AppService";

const {locale} = useI18n();

const year = new Date().getFullYear();

const uiLabels = computed(() => legalUiLabels[normalizeLegalLocale(locale.value)]);

// Fetched once on mount; left null (and hidden) if the call fails, so a
// version-check hiccup never breaks the footer's copyright/legal links.
const version = ref<string | null>(null);

onMounted(async () => {
	try {
		const data = await appService.getVersion();
		version.value = data.version;
	} catch (e) {
		console.error("Error fetching app version. ", e);
	}
});
</script>

<style scoped lang="scss">
.app-footer {
	font-size: 13px;
	min-height: 40px !important;
	height: 40px;
	background: var(--pb-surface) !important;
	color: var(--pb-text-muted);

	.app-footer-version {
		margin-left: 12px;
		opacity: 0.7;
	}

	a {
		margin-left: 20px;
		color: inherit;
		text-decoration: none;

		&:hover {
			color: var(--pb-primary);
			text-decoration: underline;
		}
	}
}

/*
 * The copyright line plus three links don't fit on one row at phone widths -
 * wrap instead of clipping, and let the footer grow past its usual 40px to
 * fit the extra line (v-footer's `app` prop keeps the layout's reserved
 * space in sync with this automatically).
 */
@media (max-width: 600px) {
	.app-footer {
		height: auto !important;
		min-height: 40px !important;
		flex-wrap: wrap;
		justify-content: center;
		gap: 4px 16px;
		padding-top: 8px;
		padding-bottom: 8px;
		text-align: center;
	}

	.app-footer a,
	.app-footer .app-footer-version {
		margin-left: 0;
	}

	.app-footer :deep(.v-spacer) {
		display: none;
	}
}
</style>
