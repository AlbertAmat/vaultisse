<template>
	<v-app :theme="state.theme">
		<router-view v-if="state.ready"/>
		<div v-else class="boot">
			<v-progress-circular indeterminate color="primary" size="28" width="3"/>
		</div>

		<reauth-dialog/>

		<v-snackbar v-model="state.snack.show" :color="state.snack.color" :timeout="5000" location="bottom right">
			{{ state.snack.text }}
			<template #actions>
				<v-btn variant="text" @click="state.snack.show = false">Close</v-btn>
			</template>
		</v-snackbar>
	</v-app>
</template>

<script setup lang="ts">
import {state} from "@/store";
import ReauthDialog from "@/components/ReauthDialog.vue";
</script>

<style>
.v-application {
	font-family: var(--pb-font-body) !important;
}

h1, h2, .text-h5, .text-h6 {
	font-family: var(--pb-font-display);
}

.boot {
	min-height: 100vh;
	display: grid;
	place-items: center;
}

.mono {
	font-family: var(--pb-font-mono);
}

.v-card {
	border: 1px solid var(--pb-border);
	box-shadow: var(--pb-shadow);
}

.page {
	padding: 24px;
	max-width: 1400px;
	margin: 0 auto;
}

@media (max-width: 600px) {
	.page {
		padding: 16px;
	}
}

.table-wrap {
	overflow-x: auto;
}

.row-click {
	cursor: pointer;
}

.row-click:hover {
	background: rgba(var(--v-theme-on-surface), 0.05);
}
</style>
