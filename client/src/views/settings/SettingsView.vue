<template>
	<page-component :model="controller">
		<template v-slot:append>
			<v-btn
				@click="save()"
				:loading="saving"
				:disabled="disableSave"
				color="primary"
				variant="elevated"
				class="text-none"
			>
				{{t(AppLabels.SAVE)}}
			</v-btn>
		</template>
		<template v-slot:default>
			<div style="width: 100%; padding-top: 10px; padding-bottom: 10px;">
				<settings-card :title="t(AppLabels.USERCONF_MY_PROFILE)">
					<div class="settings-profile-row">
						<v-avatar
							class="mr-6"
							size="70"
							color="primary"
						>
							<img
								v-if="controller.getUser().hasImage()"
								:src="controller.getUser().getImage()"
								style="width: 100%; height: 100%; object-fit: cover"
							/>
							<v-icon v-else dark size="30">mdi-account</v-icon>
						</v-avatar>
						<div class="settings-profile-actions-wrap">
							<div class="d-flex flex-wrap settings-profile-actions">
								<v-btn
									@click="changeImage()"
									:loading="uploadingImage"
									:disabled="uploadingImage"
									variant="tonal"
									class="text-none"
								>
									{{t(AppLabels.USERCONF_CHANGE_IMAGE)}}
								</v-btn>
								<v-btn
									@click="removeImage"
									:loading="deletingImage"
									:disabled="deletingImage"
									variant="tonal"
									class="ml-4 text-none"
								>
									{{ t(AppLabels.USERCONF_REMOVE_IMAGE) }}
								</v-btn>

								<!-- hidden input-->
								<input type="file" id="fileInput" accept="image/png, image/jpeg" style="display: none">
							</div>
							<p class="v-card-subtitle pl-0 mt-2">{{t(AppLabels.USERCONF_IMAGE_SUPPORT)}}</p>
						</div>
					</div>
					<div class="settings-fields-row" style="width: 100%; display: flex">
						<v-text-field
							:model-value="controller.getUser().getCode()"
							:label="t(AppLabels.CODE)"
							density="compact"
							variant="outlined"
							readonly
							disabled
							hide-details
							class="mr-2 settings-filed"
						/>

						<v-text-field
							v-model="name"
							:label="t(AppLabels.USERCONF_NAME)"
							density="compact"
							variant="outlined"
							hide-details
							class="ml-2 settings-filed"
						/>
					</div>
				</settings-card>

				<settings-card :title="t(AppLabels.USERCONF_APPEARANCE)">
					<div class="theme-picker">
						<button
							type="button"
							class="theme-swatch"
							:class="{'theme-swatch--active': controller.getUser().getTheme() === 'beige'}"
							:disabled="switchingTheme"
							@click="selectTheme('beige')"
						>
							<span class="theme-swatch-preview theme-swatch-preview--beige">
								<span class="theme-swatch-nav"></span>
								<span class="theme-swatch-card"></span>
							</span>
							<span class="theme-swatch-label">
								<span class="theme-swatch-name">{{t(AppLabels.USERCONF_THEME_BEIGE)}}</span>
								<span class="theme-swatch-desc">{{t(AppLabels.USERCONF_THEME_BEIGE_DESC)}}</span>
							</span>
							<v-icon
								v-if="controller.getUser().getTheme() === 'beige'"
								color="primary"
								class="theme-swatch-check"
							>mdi-check-circle</v-icon>
						</button>

						<button
							type="button"
							class="theme-swatch"
							:class="{'theme-swatch--active': controller.getUser().getTheme() === 'library'}"
							:disabled="switchingTheme"
							@click="selectTheme('library')"
						>
							<span class="theme-swatch-preview theme-swatch-preview--library">
								<span class="theme-swatch-nav"></span>
								<span class="theme-swatch-card"></span>
							</span>
							<span class="theme-swatch-label">
								<span class="theme-swatch-name">{{t(AppLabels.USERCONF_THEME_LIBRARY)}}</span>
								<span class="theme-swatch-desc">{{t(AppLabels.USERCONF_THEME_LIBRARY_DESC)}}</span>
							</span>
							<v-icon
								v-if="controller.getUser().getTheme() === 'library'"
								color="primary"
								class="theme-swatch-check"
							>mdi-check-circle</v-icon>
						</button>
					</div>

					<div class="settings-row" style="margin-top: 24px">
						<div class="settings-row-text">
							<p style="font-size: 14px; font-weight: 530">{{t(AppLabels.USERCONF_COMPACT_MENU)}}</p>
							<p
								class="v-card-subtitle pl-0"
								style="white-space: normal"
							>
								{{t(AppLabels.USERCONF_COMPACT_MENU_DESC)}}
							</p>
						</div>
						<v-switch
							:model-value="controller.getUser().isSidebarRail()"
							color="primary"
							hide-details
							:loading="switchingSidebarRail"
							:disabled="switchingSidebarRail"
							@update:model-value="toggleSidebarRail"
						/>
					</div>
				</settings-card>

				<settings-card :title="t(AppLabels.USERCONF_FEATURES)">
					<div class="settings-row">
						<div class="settings-row-text">
							<p style="font-size: 14px; font-weight: 530">{{t(AppLabels.USERCONF_LEASING)}}</p>
							<p
								class="v-card-subtitle pl-0"
								style="white-space: normal"
							>
								{{t(AppLabels.USERCONF_LEASING_DESC)}}
							</p>
						</div>
						<v-switch
							:model-value="controller.getUser().isLeasingEnabled()"
							color="primary"
							hide-details
							:loading="switchingLeasingEnabled"
							:disabled="switchingLeasingEnabled"
							@update:model-value="toggleLeasingEnabled"
						/>
					</div>
				</settings-card>

				<settings-card :title="t(AppLabels.USERCONF_LANGUAGE_REGION)">
					<div class="settings-fields-row" style="width: 100%; display: flex">
						<v-select
							v-model="language"
							:items="supportedLanguages"
							item-value="value"
							item-title="text"
							:label="t(AppLabels.USERCONF_LANGUAGE)"
							density="compact"
							variant="outlined"
							hide-details
							class="mr-2 settings-filed"
						/>

						<v-select
							v-model="region"
							:items="regions"
							item-value="code"
							item-title="region"
							:label="t(AppLabels.USERCONF_REGION)"
							density="compact"
							variant="outlined"
							hide-details
							class="ml-2 settings-filed"
						/>
					</div>
				</settings-card>
				<settings-card :title="t(AppLabels.USERCONF_ACCOUNT_SECURITY)">
					<div class="settings-row" style="margin-bottom: 16px">
						<div class="settings-row-text">
							<p style="font-size: 14px; font-weight: 530">{{t(AppLabels.USERCONF_EMAIL)}}</p>
							<p
								class="v-card-subtitle pl-0"
								style="white-space: normal"
							>
								{{t(AppLabels.USERCONF_EMAIL_DESC)}}
							</p>
						</div>
						<v-text-field
							v-model="email"
							density="compact"
							variant="outlined"
							hide-details
							style="max-width: 280px; width: 100%"
						/>
					</div>

					<div class="settings-row">
						<div class="settings-row-text">
							<p style="font-size: 14px; font-weight: 530">{{t(AppLabels.USERCONF_CHANGE_PASSWORD)}}</p>
							<p
								class="v-card-subtitle pl-0"
								style="white-space: normal"
							>
								{{t(AppLabels.USERCONF_CHANGE_PASSWORD_DESC)}}
							</p>
						</div>
						<change-password-dialog :controller="controller"/>
					</div>

					<div class="settings-row" style="margin-top: 16px">
						<div class="settings-row-text">
							<p style="font-size: 14px; font-weight: 530">
								{{t(AppLabels.TWOFA_TITLE)}}
								<v-chip
									:color="controller.getUser().isTotpEnabled() ? 'success' : undefined"
									size="x-small"
									class="ml-2"
								>
									{{controller.getUser().isTotpEnabled() ? t(AppLabels.TWOFA_STATUS_ENABLED) : t(AppLabels.TWOFA_STATUS_DISABLED)}}
								</v-chip>
							</p>
							<p
								class="v-card-subtitle pl-0"
								style="white-space: normal"
							>
								{{t(AppLabels.TWOFA_DESC)}}
							</p>
						</div>
						<two-factor-setup-dialog v-if="!controller.getUser().isTotpEnabled()" :controller="controller"/>
						<two-factor-disable-dialog v-else :controller="controller"/>
					</div>

					<div class="settings-row" style="margin-top: 16px">
						<div class="settings-row-text">
							<p style="color: rgb(var(--v-theme-error)); font-weight: 530">{{t(AppLabels.USERCONF_DELETE)}}</p>
							<p
								class="v-card-subtitle pl-0"
								style="white-space: normal"
							>
								{{t(AppLabels.USERCONF_DELETE_DESC)}}
							</p>
						</div>
						<delete-account-dialog :controller="controller"/>
					</div>
				</settings-card>

				<div class="settings-security-row">
					<sessions-card/>
					<login-activity-card/>
				</div>
			</div>
		</template>
	</page-component>
</template>

<script setup lang="ts">
/**
 * Account settings view: profile picture, name/email/language/region form
 * (save is disabled until a field actually differs from the loaded user),
 * password change (`ChangePasswordDialog`), and account deletion.
 */
import PageComponent from "@/views/PageComponent.vue";
import SettingsController from "@/controller/settings/SettingsController";
import {Ref, ref, computed} from "vue";
import SettingsCard from "@/views/settings/SettingsCard.vue";
import ChangePasswordDialog from "@/views/settings/ChangePasswordDialog.vue";
import TwoFactorSetupDialog from "@/views/settings/TwoFactorSetupDialog.vue";
import TwoFactorDisableDialog from "@/views/settings/TwoFactorDisableDialog.vue";
import DeleteAccountDialog from "@/views/settings/DeleteAccountDialog.vue";
import SessionsCard from "@/views/settings/SessionsCard.vue";
import LoginActivityCard from "@/views/settings/LoginActivityCard.vue";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import {useI18n} from "vue-i18n";
import {applyTheme} from "@/plugins/theme";

const controller = new SettingsController();

const {t} = useI18n();

/**
 *
 */
const saving: Ref<boolean> = ref(false);

/**
 *
 */
const deletingImage: Ref<boolean> = ref(false);

/**
 *
 */
const uploadingImage: Ref<boolean> = ref(false);

/**
 *
 */
const switchingTheme: Ref<boolean> = ref(false);

/**
 *
 */
const switchingSidebarRail: Ref<boolean> = ref(false);

/**
 *
 */
const switchingLeasingEnabled: Ref<boolean> = ref(false);

const name: Ref<string> = ref(controller.getUser().getName());
const email: Ref<string> = ref(controller.getUser().getEmail());
const language: Ref<string> = ref(controller.getUser().getLanguage());
const region: Ref<string> = ref(controller.getUser().getRegion());

// TODO: USE system_languages table
const supportedLanguages = [
	{text: "English", value: "en"},
	{text: "Spanish", value: "es"},
	{text: "Catalan", value: "ca"},
	{text: "Italian", value: "it"},
]

const regions = [
	{"code": "AU", "region": "Australia"},
	{"code": "BR", "region": "Brazil"},
	{"code": "CA", "region": "Canada"},
	{"code": "CN", "region": "China"},
	{"code": "FR", "region": "France"},
	{"code": "DE", "region": "Germany"},
	{"code": "IT", "region": "Italy"},
	{"code": "JP", "region": "Japan"},
	{"code": "MX", "region": "Mexico"},
	{"code": "PT", "region": "Portugal"},
	{"code": "RU", "region": "Russia"},
	{"code": "SA", "region": "Saudi Arabia"},
	{"code": "ES", "region": "Spain"},
	{"code": "TW", "region": "Taiwan"},
	{"code": "GB", "region": "United Kingdom"},
	{"code": "US", "region": "United States"}
]

const disableSave = computed(() => {
	const empty = name.value.trim().length === 0 || email.value.trim().length === 0 || language.value.trim().length === 0 || saving.value;

	const user = controller.getUser();
	const equal = name.value === user.getName() && email.value === user.getEmail() && language.value === user.getLanguage() && region.value === user.getRegion();

	return empty || equal;
})

async function save() {
	try {
		saving.value = true;
		await controller.getUser().update(
			name.value,
			email.value,
			language.value,
			region.value
		)
	} finally {
		saving.value = false;
	}
}

/** Applies the picked theme immediately (for instant feedback), then persists it. */
async function selectTheme(theme: string) {
	if (theme === controller.getUser().getTheme() || switchingTheme.value) {
		return;
	}

	try {
		switchingTheme.value = true;
		applyTheme(theme);
		await controller.getUser().setTheme(theme);
	} finally {
		switchingTheme.value = false;
	}
}

/** Persists the compact-menu (sidebar rail) preference; AppMenu.vue picks up the change reactively. */
async function toggleSidebarRail(checked: boolean | null) {
	const value = !!checked;

	if (value === controller.getUser().isSidebarRail() || switchingSidebarRail.value) {
		return;
	}

	try {
		switchingSidebarRail.value = true;
		await controller.getUser().setSidebarRail(value);
	} finally {
		switchingSidebarRail.value = false;
	}
}

/** Persists the leasing preference; AppMenu.vue and Router.ts pick up the change reactively. */
async function toggleLeasingEnabled(checked: boolean | null) {
	const value = !!checked;

	if (value === controller.getUser().isLeasingEnabled() || switchingLeasingEnabled.value) {
		return;
	}

	try {
		switchingLeasingEnabled.value = true;
		await controller.getUser().setLeasingEnabled(value);
	} finally {
		switchingLeasingEnabled.value = false;
	}
}

async function removeImage() {
	try {
		deletingImage.value = true;
		await controller.getUser().removeImage();
	} finally {
		deletingImage.value = false;
	}
}

function changeImage() {
	const input = document.getElementById('fileInput');

	if (input) {
		// Trigger the file dialog
		input.click();

		// Listen for file selection
		input.onchange = async function (event: any) {
			const file = event.target.files?.[0]; // Optional chaining

			if (!file) return; // No file selected

			if (file.type !== "image/png" && file.type !== "image/jpeg") {
				alert(t(AppLabels.USERCONF_IMAGE_FORMAT_ALERT));
				event.target.value = ""; // Clear the input
				return;
			}

			if (file.size > 2 * 1024 * 1024) {
				alert(t(AppLabels.USERCONF_IMAGE_SIZE_ALERT));
				event.target.value = ""; // Clear the input
				return;
			}

			// Call your upload logic
			try {
				uploadingImage.value = true;
				await controller.getUser().uploadImage(file);
			} finally {
				uploadingImage.value = false;
			}
		};
	}
}
</script>

<style scoped lang="scss">
.settings-filed {
	width: 50%;
}

.settings-row {
	display: flex;
	align-items: center;
	width: 100%;
	min-width: 0;
}

.settings-row-text {
	flex: 1;
	padding-right: 80px;
	min-width: 0;
}

@media (max-width: 600px) {
	.settings-row {
		flex-wrap: wrap;
		row-gap: 12px;
	}

	.settings-row-text {
		padding-right: 0;
		flex-basis: 100%;
	}
}

.settings-profile-row {
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	margin-bottom: 30px;
}

.settings-profile-actions-wrap {
	min-width: 0;
}

.settings-profile-actions {
	gap: 8px;
}

.settings-profile-actions .ml-4 {
	margin-left: 0 !important;
}

.settings-security-row {
	display: flex;
	align-items: flex-start;
	gap: 20px;
}

.settings-security-row > * {
	flex: 1 1 0;
	min-width: 0;
}

/* Each card is its own <settings-card>, which already carries Vuetify's
   mb-5 (20px bottom margin) for spacing against the *next* sibling in the
   normal (non-flex) card list above it. Inside this row that margin just
   stacks on top of `gap`, doubling the space between the two cards - let
   `gap` be the only thing spacing them, in both the row and stacked layouts.
   Vuetify's spacing helpers (mb-5 included) are themselves `!important`,
   so overriding them needs `!important` too - a plain override here would
   silently lose and do nothing. */
.settings-security-row :deep(.settings-card) {
	margin-bottom: 0 !important;
}

@media (max-width: 900px) {
	.settings-security-row {
		flex-direction: column;
		/* align-items controls cross-axis alignment, and the cross axis
		   flips from vertical to horizontal once flex-direction becomes
		   column - "flex-start" (correct for the row, so unequal-height
		   cards don't stretch to match each other) then means "shrink to
		   content width" instead, leaving a stacked card narrower than
		   its container. Stacked cards should just span full width. */
		align-items: stretch;
	}

	/* flex: 1 1 0's zero basis is a width rule - once the row above
	   switches to a column, that same zero basis applies to height
	   instead, and an auto-height column flex container can't resolve
	   "grow to fill" against its own content, collapsing each card to
	   ~0px (clipped by Vuetify's card overflow: hidden). Stacked cards
	   should just size to their own content. */
	.settings-security-row > * {
		flex: none;
	}
}

@media (max-width: 600px) {
	.settings-filed {
		width: 100%;
	}

	.settings-filed.mr-2,
	.settings-filed.ml-2 {
		margin: 0 0 12px !important;
	}

	.settings-fields-row {
		flex-wrap: wrap;
	}
}

.theme-picker {
	display: flex;
	gap: 16px;
	flex-wrap: wrap;
}

.theme-swatch {
	position: relative;
	display: flex;
	align-items: center;
	gap: 14px;
	width: 260px;
	padding: 12px 14px;
	border: 1px solid var(--pb-border);
	border-radius: var(--pb-radius-sm);
	background: var(--pb-surface);
	cursor: pointer;
	text-align: left;
	font: inherit;
	transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.theme-swatch:hover:not(:disabled) {
	border-color: var(--pb-border-strong);
}

.theme-swatch--active {
	border-color: var(--pb-primary);
	box-shadow: 0 0 0 1px var(--pb-primary);
}

.theme-swatch-preview {
	width: 56px;
	height: 44px;
	border-radius: 8px;
	overflow: hidden;
	display: flex;
	flex-shrink: 0;
	/* Fixed (not theme-token) border: each swatch renders its own theme's
	   colors regardless of which theme is currently active, so this needs
	   to read against both a near-white and a near-black preview. */
	border: 1px solid rgba(128, 128, 128, 0.4);
}

.theme-swatch-nav {
	width: 16px;
	height: 100%;
	/* Mirrors AppMenu.vue's real sidebar border-right - same fixed
	   mid-contrast color as the outer preview border, for the same reason
	   (this strip's own background always stays dark, in both swatches). */
	border-right: 1px solid rgba(128, 128, 128, 0.4);
}

.theme-swatch-card {
	flex: 1;
}

.theme-swatch-preview--beige .theme-swatch-nav {
	background: #2b2318;
}

.theme-swatch-preview--beige .theme-swatch-card {
	background: #f7f2ea;
}

.theme-swatch-preview--library .theme-swatch-nav {
	background: #0a0e17;
}

.theme-swatch-preview--library .theme-swatch-card {
	background: #0d1420;
}

.theme-swatch-label {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
}

.theme-swatch-name {
	font-weight: 600;
	font-size: 14px;
	color: var(--pb-text);
}

.theme-swatch-desc {
	font-size: 12px;
	color: var(--pb-text-muted);
}

.theme-swatch-check {
	position: absolute;
	top: 8px;
	right: 8px;
}
</style>