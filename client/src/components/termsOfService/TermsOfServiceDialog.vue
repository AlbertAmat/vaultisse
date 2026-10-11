<template>
	<v-dialog
		:model-value="isVisible"
		max-width="640"
		persistent
		scrollable
	>
		<v-card>
			<v-card-title class="d-flex align-center ga-2">
				<v-icon icon="mdi-file-document-outline"/>
				{{ uiLabels.termsOfServiceNoticeTitle }}
			</v-card-title>

			<v-card-text style="max-height: 55vh;">
				<p class="mb-4">{{ uiLabels.termsOfServiceNoticeIntro }}</p>
				<legal-content :blocks="termsOfServiceDoc.blocks"/>
			</v-card-text>

			<v-card-actions>
				<router-link
					:to="legalRoute.getPath('terms-of-service')"
					class="text-body-medium mr-auto"
				>
					{{ uiLabels.termsOfServiceNoticeLearnMore }}
				</router-link>

				<v-btn
					color="primary"
					variant="flat"
					:loading="accepting"
					@click="accept"
				>
					{{ uiLabels.termsOfServiceNoticeAccept }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Persistent, non-dismissable dialog shown after login to every account
 * until it accepts the Terms of Service - unlike SecurityNoticeDialog.vue,
 * this isn't gated by isPublicInstitution(). Mounted once in App.vue,
 * inside the authenticated app shell (so `applicationService.getUser()` is
 * always already loaded here).
 *
 * Acceptance is recorded server-side (see UserRoute.ts
 * `POST /user/terms-of-service/accept` and the `user_terms_of_service_
 * acknowledgements` table) so it doesn't show again for this user, on this
 * device or any other.
 */
import {computed, ref} from "vue";
import {useI18n} from "vue-i18n";
import LegalContent from "@/components/legal/LegalContent.vue";
import {legalUiLabels, normalizeLegalLocale, getLegalDoc} from "@/views/legal/legalData";
import {legalRoute} from "@/router/routes/LegalRoute";
import {applicationService} from "@/service/ApplicationService";

const {locale} = useI18n();

const uiLabels = computed(() => legalUiLabels[normalizeLegalLocale(locale.value)]);
const termsOfServiceDoc = computed(() => getLegalDoc("terms-of-service", locale.value));

const isVisible = computed(() => !applicationService.getUser().hasAcceptedTermsOfService());

const accepting = ref(false);

async function accept() {
	accepting.value = true;
	try {
		await applicationService.getUser().acceptTermsOfService();
	} finally {
		accepting.value = false;
	}
}
</script>
