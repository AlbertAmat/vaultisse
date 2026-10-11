<template>
	<v-dialog
		:model-value="isVisible"
		max-width="640"
		persistent
		scrollable
	>
		<v-card>
			<v-card-title class="d-flex align-center ga-2">
				<v-icon icon="mdi-shield-check-outline"/>
				{{ uiLabels.securityNoticeTitle }}
			</v-card-title>

			<v-card-text style="max-height: 55vh;">
				<p class="mb-4">{{ uiLabels.securityNoticeIntro }}</p>
				<legal-content :blocks="securityMeasuresDoc.blocks"/>
			</v-card-text>

			<v-card-actions>
				<router-link
					:to="legalRoute.getPath('security-measures')"
					class="text-body-medium mr-auto"
				>
					{{ uiLabels.securityNoticeLearnMore }}
				</router-link>

				<v-btn
					color="primary"
					variant="flat"
					:loading="accepting"
					@click="accept"
				>
					{{ uiLabels.securityNoticeAccept }}
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/**
 * Persistent, non-dismissable dialog shown after login to accounts flagged
 * as a public institution, until they acknowledge the security-measures
 * summary. Mounted once in App.vue, inside the authenticated app shell (so
 * `applicationService.getUser()` is always already loaded here).
 *
 * Held back until the Terms of Service dialog (TermsOfServiceDialog.vue) has
 * been accepted, so the two persistent dialogs never stack on top of each
 * other for a public-institution account on its first login.
 *
 * Acceptance is recorded server-side (see UserRoute.ts
 * `POST /user/security-notice/accept` and the `user_security_notice_
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
const securityMeasuresDoc = computed(() => getLegalDoc("security-measures", locale.value));

const isVisible = computed(() =>
	applicationService.getUser().isPublicInstitution() &&
	!applicationService.getUser().hasAcceptedSecurityNotice() &&
	applicationService.getUser().hasAcceptedTermsOfService()
);

const accepting = ref(false);

async function accept() {
	accepting.value = true;
	try {
		await applicationService.getUser().acceptSecurityNotice();
	} finally {
		accepting.value = false;
	}
}
</script>
