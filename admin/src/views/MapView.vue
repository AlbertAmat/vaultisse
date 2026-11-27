<template>
	<!--
	  Login map (route /map, menu: Security & compliance)

	  Where people sign in from, placed by IP address on an OpenStreetMap. The server places addresses with an offline database (no address
	  is sent to a third party); your browser only loads the map tiles from openstreetmap.org.
	  Data:   GET /map/logins?days=7|30|90|365 -> {points: [{lat, lon, city, country, logins, failed, accounts, addresses}], countries, totals}
	  A circle is one place (addresses that resolve to the same spot are merged); its size is the number of events and it turns red when
	  failed attempts outnumber sign-ins. Popups never name a person. Private addresses (10.x, 192.168.x) have no place and are only counted.
	-->
	<div class="page">
		<page-header title="Login map" subtitle="Where people sign in from, placed by IP address. Locations come from an offline database on this server: no address is sent to anyone.">
			<v-select v-model="days" :items="periods" density="compact" style="width: 170px" hide-details @update:model-value="load"/>
			<v-btn icon="mdi-refresh" variant="text" aria-label="Reload" :loading="loading" @click="load"/>
		</page-header>

		<v-alert v-if="data && !data.available" type="warning" variant="tonal" class="mb-4" icon="mdi-map-marker-off-outline">
			The location database couldn't be loaded, so nothing can be placed on the map. Reinstall the server's dependencies (<code>geoip-lite</code>).
		</v-alert>

		<v-row v-if="data" class="mb-1">
			<v-col cols="6" md="3"><stat-card label="Sign-ins" :value="data.totals.logins" icon="mdi-login" color="primary"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Failed attempts" :value="data.totals.failed" icon="mdi-shield-alert-outline" color="error"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Countries" :value="data.countries.length" icon="mdi-earth" color="info"/></v-col>
			<v-col cols="6" md="3"><stat-card label="Not placed" :value="data.totals.unlocated" icon="mdi-map-marker-question-outline" color="warning" hint="Private or local addresses, or unknown to the database"/></v-col>
		</v-row>

		<v-card class="mt-2">
			<div class="d-flex flex-wrap align-center ga-4 pa-3 pb-0">
				<v-switch v-model="showOk" color="primary" label="Sign-ins" hide-details density="compact" @update:model-value="draw"/>
				<v-switch v-model="showFailed" color="error" label="Failed attempts" hide-details density="compact" @update:model-value="draw"/>
				<v-spacer/>
				<span class="text-caption text-medium-emphasis legend"><i class="dot ok"/>sign-ins <i class="dot bad"/>mostly failed attempts · bigger = more</span>
			</div>
			<div ref="mapEl" class="map" :class="{dim: state.theme === 'library'}"/>
		</v-card>
		<p class="text-caption text-medium-emphasis mt-2">
			Accuracy is that of a free database: the country is nearly always right, the city often, never the street. Addresses behind a VPN, a mobile carrier or a proxy show where that network ends.
			<template v-if="data && data.totals.unlocated > 0">Behind Docker or a reverse proxy without <code>TRUST_PROXY=true</code> every visitor looks like a private address and can't be placed.</template>
			<template v-if="data?.totals.truncated"> Only the busiest 5,000 addresses are shown.</template>
			Map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors; the tiles are loaded from openstreetmap.org by your browser.
		</p>

		<v-card class="mt-4">
			<div class="text-subtitle-1 font-weight-medium pa-4 pb-0">Busiest places</div>
			<div class="table-wrap">
				<v-table density="compact">
					<thead><tr><th>Place</th><th>Country</th><th class="text-right">Sign-ins</th><th class="text-right">Accounts</th><th class="text-right">Failed</th><th class="text-right">Addresses</th><th>Last sign-in</th></tr></thead>
					<tbody>
						<tr v-for="p in (data?.points ?? []).slice(0, 15)" :key="`${p.lat},${p.lon}`" class="row-click" @click="focus(p)">
							<td>{{ place(p) }}</td>
							<td>{{ country(p.country) }}</td>
							<td class="text-right">{{ p.logins }}</td>
							<td class="text-right">{{ p.accounts || "—" }}</td>
							<td class="text-right" :class="{'text-error': p.failed > 0}">{{ p.failed || "—" }}</td>
							<td class="text-right">{{ p.addresses }}</td>
							<td class="text-no-wrap">{{ p.lastLogin ? relative(p.lastLogin) : "—" }}</td>
						</tr>
						<tr v-if="!data?.points.length"><td colspan="7" class="text-center text-medium-emphasis pa-6">{{ loading ? "Loading…" : "Nothing to show for this period." }}</td></tr>
					</tbody>
				</v-table>
			</div>
		</v-card>
	</div>
</template>

<script setup lang="ts">
import {nextTick, onBeforeUnmount, onMounted, ref} from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type {ILoginMap, IMapPoint} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {state} from "@/store";
import {relative} from "@/utils/format";
import PageHeader from "@/components/PageHeader.vue";
import StatCard from "@/components/StatCard.vue";

const periods = [{title: "Last 7 days", value: 7}, {title: "Last 30 days", value: 30}, {title: "Last 90 days", value: 90}, {title: "Last year", value: 365}];
const days = ref(30);
const data = ref<ILoginMap | null>(null);
const loading = ref(false);
const showOk = ref(true);
const showFailed = ref(true);
const mapEl = ref<HTMLDivElement>();
let map: L.Map | undefined;
let layer: L.LayerGroup | undefined;

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], {type: "region"}) : null;
const country = (code: string): string => {
	try {
		return regionNames?.of(code) ?? code;
	} catch {
		return code;
	}
};
const place = (p: IMapPoint): string => [p.city, p.region].filter(Boolean).join(", ") || "Somewhere in the country";

/** Builds the popup with DOM text nodes (not HTML), so a place name can never inject markup. */
function popup(p: IMapPoint): HTMLElement {
	const el = document.createElement("div");
	const title = document.createElement("strong");
	title.textContent = `${place(p)} · ${country(p.country)}`;
	el.append(title);
	const line = (text: string) => {
		const row = document.createElement("div");
		row.textContent = text;
		el.append(row);
	};
	line(`${p.logins} sign-in${p.logins === 1 ? "" : "s"}${p.accounts ? ` by ${p.accounts} account${p.accounts === 1 ? "" : "s"}` : ""}`);
	if (p.failed > 0) line(`${p.failed} failed attempt${p.failed === 1 ? "" : "s"}`);
	line(`${p.addresses} address${p.addresses === 1 ? "" : "es"}`);
	if (p.lastLogin) line(`Last sign-in ${relative(p.lastLogin)}`);
	return el;
}

/** Redraws the circles for the two switches (sign-ins / failed attempts) and zooms the map to fit them. Radius = 6 + 2 * sqrt(events), at most 26. */
function draw() {
	if (!map || !layer) return;
	layer.clearLayers();
	const bounds: L.LatLngExpression[] = [];
	for (const p of data.value?.points ?? []) {
		const ok = showOk.value ? p.logins : 0;
		const bad = showFailed.value ? p.failed : 0;
		if (ok + bad === 0) continue;
		const mostlyFailed = bad > ok;
		const color = mostlyFailed ? "#c0392b" : "#8b5a2b";
		L.circleMarker([p.lat, p.lon], {radius: Math.min(26, 6 + Math.sqrt(ok + bad) * 2), color, weight: 2, fillColor: color, fillOpacity: 0.45})
			.bindPopup(popup(p)).addTo(layer);
		bounds.push([p.lat, p.lon]);
	}
	if (bounds.length > 0) {
		map.fitBounds(L.latLngBounds(bounds), {padding: [40, 40], maxZoom: 6});
	} else {
		map.setView([25, 10], 2);
	}
}

function focus(p: IMapPoint) {
	map?.setView([p.lat, p.lon], Math.max(map.getZoom(), 7));
}

async function load() {
	loading.value = true;
	try {
		data.value = await api.map.logins(days.value);
		await nextTick();
		draw();
	} finally {
		loading.value = false;
	}
}

onMounted(async () => {
	map = L.map(mapEl.value!, {worldCopyJump: true, minZoom: 2}).setView([25, 10], 2);
	L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 18, attribution: "© OpenStreetMap contributors"}).addTo(map);
	layer = L.layerGroup().addTo(map);
	await load();
});
onBeforeUnmount(() => map?.remove());
</script>

<style scoped>
.map {
	height: 520px;
	margin: 12px;
	border-radius: 10px;
	overflow: hidden;
	border: 1px solid var(--pb-border);
	z-index: 0;
}

/* Soften the bright tiles in the dark theme. */
.map.dim :deep(.leaflet-tile-pane) {
	filter: brightness(0.7) contrast(1.05) saturate(0.8);
}

.legend {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.dot {
	display: inline-block;
	width: 10px;
	height: 10px;
	border-radius: 50%;
	margin-left: 8px;
}

.dot.ok {
	background: #8b5a2b;
}

.dot.bad {
	background: #c0392b;
}
</style>
