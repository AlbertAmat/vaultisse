<template>
	<!--
	  System (route /system, menu: Platform > System)

	  The version you run (and whether a newer one exists), the database (size, status, where it is), the migrations that were applied
	  and when, and runtime facts. Data: GET /system/details, POST /system/check-updates.
	  Database status: Healthy | Needs attention (a problem was found, e.g. the database is larger than the alert limit) | Not reachable.
	-->
	<div class="page">
		<page-header title="System" subtitle="The version you run, the database it uses and how healthy it is, and the upgrades that were applied to it.">
			<v-btn variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="load">Refresh</v-btn>
		</page-header>

		<template v-if="info">
			<!-- Version -->
			<v-card class="pa-5 mb-4">
				<div class="d-flex flex-wrap align-center ga-3 mb-3">
					<div class="text-subtitle-1 font-weight-medium">Version</div>
					<v-chip v-if="info.version.updateAvailable === true" color="warning" variant="flat" size="small" prepend-icon="mdi-arrow-up-circle-outline">Update available</v-chip>
					<v-chip v-else-if="info.version.updateAvailable === false" color="success" variant="tonal" size="small" prepend-icon="mdi-check-circle-outline">Up to date</v-chip>
					<v-chip v-else size="small" variant="tonal" prepend-icon="mdi-help-circle-outline">{{ info.version.isDevBuild ? "Development build" : "Can't tell" }}</v-chip>
					<v-spacer/>
					<v-btn v-if="info.version.checkEnabled" size="small" variant="tonal" prepend-icon="mdi-cloud-search-outline" :loading="checking" @click="checkUpdates">Check now</v-btn>
				</div>
				<dl class="facts">
					<dt>Installed</dt><dd class="mono">{{ info.version.installed }}</dd>
					<dt>Latest release</dt>
					<dd>
						<template v-if="info.version.latest">
							<span class="mono">{{ info.version.latest }}</span>
							<span v-if="info.version.publishedAt" class="text-medium-emphasis"> · {{ dateOnly(info.version.publishedAt) }}</span>
							<a v-if="info.version.releaseUrl" :href="info.version.releaseUrl" target="_blank" rel="noopener noreferrer" class="ml-2">Release notes</a>
						</template>
						<span v-else class="text-medium-emphasis">—</span>
					</dd>
					<dt>Last checked</dt><dd>{{ info.version.checkEnabled ? relative(info.version.checkedAt) : "Version check is off" }}</dd>
				</dl>
				<v-alert v-if="info.version.updateAvailable" type="info" variant="tonal" density="compact" class="mt-3">
					To update, pull the new image and restart: <span class="mono">docker compose pull && docker compose up -d</span>. Database upgrades are applied automatically on start.
				</v-alert>
				<v-alert v-if="info.version.error" type="warning" variant="tonal" density="compact" class="mt-3">{{ info.version.error }}</v-alert>
				<p v-if="!info.version.checkEnabled" class="text-caption text-medium-emphasis mt-3">
					The version check is switched off. Turn it on under <router-link to="/settings">Settings</router-link> (Admin portal). It only reads the public list of releases and sends nothing about this installation.
				</p>
			</v-card>

			<!-- Database -->
			<v-card class="pa-5 mb-4">
				<div class="d-flex flex-wrap align-center ga-3 mb-3">
					<div class="text-subtitle-1 font-weight-medium">Database</div>
					<v-chip :color="statusColor" variant="flat" size="small" :prepend-icon="statusIcon">{{ statusText }}</v-chip>
				</div>
				<v-alert v-for="problem in info.database.problems" :key="problem" :type="info.database.status === 'down' ? 'error' : 'warning'" variant="tonal" density="compact" class="mb-2">{{ problem }}</v-alert>

				<v-row class="mt-1">
					<v-col cols="12" md="6">
						<div class="text-caption text-medium-emphasis mb-1">How this server connects</div>
						<dl class="facts">
							<dt>Name</dt><dd class="mono">{{ db.connection.name ?? "—" }}</dd>
							<dt>Host</dt><dd class="mono">{{ db.connection.host ?? "—" }}</dd>
							<dt>Port</dt><dd class="mono">{{ db.connection.port ?? (db.connection.mode === "socket" ? "— (socket)" : "—") }}</dd>
							<dt>User</dt><dd class="mono">{{ db.connection.user ?? "—" }}</dd>
							<dt>Mode</dt><dd>{{ db.connection.mode === "tcp" ? "Network (TCP)" : "Unix socket" }}</dd>
						</dl>
					</v-col>
					<v-col cols="12" md="6">
						<div class="text-caption text-medium-emphasis mb-1">What the database reports</div>
						<dl v-if="db.server" class="facts">
							<dt>Address</dt><dd class="mono">{{ db.server.address ?? "— (socket)" }}{{ db.server.port ? `:${db.server.port}` : "" }}</dd>
							<dt>Server</dt><dd>{{ db.server.version }}</dd>
							<dt>Running for</dt><dd>{{ db.server.uptimeSeconds !== null ? duration(db.server.uptimeSeconds) : "—" }}</dd>
							<dt>Response time</dt><dd>{{ db.latencyMs }} ms</dd>
						</dl>
						<p v-else class="text-body-2 text-medium-emphasis">Not reachable.</p>
					</v-col>
				</v-row>

				<template v-if="db.sizeBytes !== null">
					<v-divider class="my-4"/>
					<v-row>
						<v-col cols="12" md="6">
							<div class="text-caption text-medium-emphasis">Size on disk</div>
							<div class="text-h5 font-weight-bold">{{ bytes(db.sizeBytes) }}</div>
							<div class="text-caption text-medium-emphasis">Everything in the database: catalogs, users, files, logs.</div>
						</v-col>
						<v-col v-if="db.connections" cols="12" md="6">
							<div class="text-caption text-medium-emphasis">Connections</div>
							<div class="d-flex justify-space-between text-body-2"><span>{{ db.connections.current }} of {{ db.connections.max }} in use</span><span>pool: {{ db.connections.poolTotal - db.connections.poolIdle }} busy · {{ db.connections.poolIdle }} idle · {{ db.connections.poolWaiting }} waiting</span></div>
							<v-progress-linear :model-value="(db.connections.current * 100) / db.connections.max" :color="db.connections.current / db.connections.max >= 0.85 ? 'error' : 'primary'" height="6" rounded class="mt-1"/>
						</v-col>
					</v-row>

					<div class="text-subtitle-2 mt-4 mb-1">Largest tables</div>
					<div class="table-wrap">
						<v-table density="compact">
							<thead><tr><th>Table</th><th>Rows (approx.)</th><th class="text-right">Size</th><th style="width: 40%"></th></tr></thead>
							<tbody>
								<tr v-for="table in db.largestTables" :key="table.name">
									<td class="mono">{{ table.name }}</td>
									<td>{{ num(table.rows) }}</td>
									<td class="text-right text-no-wrap">{{ bytes(table.bytes) }}</td>
									<td><v-progress-linear :model-value="(table.bytes * 100) / (db.largestTables[0]?.bytes || 1)" color="primary" height="4" rounded/></td>
								</tr>
							</tbody>
						</v-table>
					</div>
				</template>
			</v-card>

			<!-- Migrations -->
			<v-card class="pa-5 mb-4">
				<div class="text-subtitle-1 font-weight-medium mb-1">Database conversions</div>
				<p class="text-body-2 text-medium-emphasis mb-3">
					Each new version can change the database's structure. The server applies those upgrade steps by itself when it starts, once each, and records when. {{ info.migrations.total }} so far.
				</p>
				<div class="table-wrap">
					<v-table density="compact">
						<thead><tr><th>Upgrade step</th><th>Applied</th><th></th></tr></thead>
						<tbody>
							<tr v-for="(migration, i) in shown" :key="migration.filename">
								<td class="mono">{{ migration.filename }}</td>
								<td class="text-no-wrap">{{ dateTime(migration.appliedAt) }}</td>
								<td class="text-medium-emphasis">{{ i === 0 && showAll ? "" : relative(migration.appliedAt) }}</td>
							</tr>
						</tbody>
					</v-table>
				</div>
				<v-btn v-if="info.migrations.items.length > 8" variant="text" size="small" class="mt-2" @click="showAll = !showAll">{{ showAll ? "Show fewer" : `Show all ${info.migrations.total}` }}</v-btn>
				<p class="text-caption text-medium-emphasis mt-2">On a fresh install, every step is recorded at the first start. On an upgraded database, a step that was already present is recorded the first time this version saw it.</p>
			</v-card>

			<!-- Runtime -->
			<v-card class="pa-5">
				<div class="text-subtitle-1 font-weight-medium mb-3">This server</div>
				<dl class="facts">
					<dt>Instance id</dt><dd class="mono" style="word-break: break-all">{{ info.instanceUuid }}</dd>
					<dt>Running for</dt><dd>{{ duration(info.runtime.uptimeSeconds) }}</dd>
					<dt>Node.js</dt><dd class="mono">{{ info.runtime.node }}</dd>
					<dt>System</dt><dd>{{ info.runtime.platform }} ({{ info.runtime.arch }})</dd>
					<dt>Host name</dt><dd class="mono">{{ info.runtime.hostname }}{{ info.runtime.inDocker ? " · in Docker" : "" }}</dd>
					<dt>Memory</dt><dd>{{ info.runtime.memoryMb }} MB</dd>
					<dt>Environment</dt><dd>{{ info.runtime.environment }}</dd>
				</dl>
			</v-card>
		</template>
	</div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from "vue";
import type {ISystemDetails} from "@vaultisse/types/admin/IAdmin";
import {api} from "@/api";
import {notify} from "@/store";
import {bytes, dateOnly, dateTime, duration, num, relative} from "@/utils/format";
import PageHeader from "@/components/PageHeader.vue";

const info = ref<ISystemDetails | null>(null);
const loading = ref(false);
const checking = ref(false);
const showAll = ref(false);

// Only used inside the v-if above, where `info` is set.
const db = computed(() => info.value!.database);
/** The migration history is long: show the 8 latest, or all with "Show all". */
const shown = computed(() => (showAll.value ? info.value!.migrations.items : info.value!.migrations.items.slice(0, 8)));
const statusColor = computed(() => ({ok: "success", warning: "warning", down: "error"}[db.value.status]));
const statusIcon = computed(() => ({ok: "mdi-check-circle-outline", warning: "mdi-alert-outline", down: "mdi-close-circle-outline"}[db.value.status]));
const statusText = computed(() => ({ok: "Healthy", warning: "Needs attention", down: "Not reachable"}[db.value.status]));

async function load() {
	loading.value = true;
	try {
		info.value = await api.systemDetails();
	} finally {
		loading.value = false;
	}
}

async function checkUpdates() {
	checking.value = true;
	try {
		const version = await api.checkUpdates();
		if (info.value) {
			info.value.version = version;
		}
		notify(version.error ? "Couldn't check for updates." : version.updateAvailable ? "A new version is available." : "You're up to date.", version.error ? "warning" : "success");
	} finally {
		checking.value = false;
	}
}

onMounted(load);
</script>

<style scoped>
.facts {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 6px 18px;
	font-size: 0.9rem;
}

.facts dt {
	opacity: 0.65;
}
</style>
