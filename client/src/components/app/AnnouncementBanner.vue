<template>
	<div v-if="visible.length" class="notices" role="region" aria-live="polite">
		<div v-for="notice in visible" :key="notice.key" class="notice" :class="`notice--${notice.level}`">
			<v-icon size="18" class="notice-icon">{{ icons[notice.level] }}</v-icon>
			<span class="notice-text">{{ notice.message }}</span>
			<v-btn v-if="notice.dismissible" icon="mdi-close" size="x-small" variant="text" density="comfortable" aria-label="Close" @click="dismiss(notice.id)"/>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * Banners set by the instance's admins in the admin portal: announcements (info/warning can be dismissed,
 * critical stays) and the maintenance notice (stays while maintenance mode is on). Fetched from the public
 * `GET /app/notice` on load, every two minutes, and when the tab regains focus. The text comes straight from
 * the admin, so it isn't translated.
 */
import {computed, onBeforeUnmount, onMounted, ref} from "vue";
import {api} from "@/plugins/api";

type Level = "info" | "warning" | "critical" | "maintenance";
interface Notice {
	key: string;
	id: number;
	message: string;
	level: Level;
	dismissible: boolean;
}

const STORAGE_KEY = "dismissed-announcements";
const icons: Record<Level, string> = {
	info: "mdi-information-outline",
	warning: "mdi-alert-outline",
	critical: "mdi-alert-octagon-outline",
	maintenance: "mdi-wrench-clock",
};

const notices = ref<Notice[]>([]);
const dismissed = ref<number[]>(readDismissed());
let timer: ReturnType<typeof setInterval> | undefined;

function readDismissed(): number[] {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
	} catch {
		return [];
	}
}

const visible = computed(() => notices.value.filter((notice) => !notice.dismissible || !dismissed.value.includes(notice.id)));

function dismiss(id: number) {
	dismissed.value = [...dismissed.value, id].slice(-50);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(dismissed.value));
	} catch {
		// Private mode: it just comes back on the next visit.
	}
}

async function load() {
	try {
		const {data} = await api.http.get("/app/notice", {suppressErrorDialog: true});
		const list: Notice[] = [];
		if (data.maintenance) {
			list.push({key: "maintenance", id: -1, message: data.maintenance.message, level: "maintenance", dismissible: false});
		}
		for (const item of data.announcements ?? []) {
			list.push({key: `a${item.id}`, id: item.id, message: item.message, level: item.level, dismissible: item.level !== "critical"});
		}
		notices.value = list;
	} catch {
		// A banner is never worth an error dialog.
	}
}

const onFocus = () => load();

onMounted(() => {
	load();
	timer = setInterval(load, 2 * 60 * 1000);
	window.addEventListener("focus", onFocus);
});
onBeforeUnmount(() => {
	clearInterval(timer);
	window.removeEventListener("focus", onFocus);
});
</script>

<style scoped>
.notices {
	position: sticky;
	top: 0;
	z-index: 5;
}

.notice {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 16px;
	font-size: 0.9rem;
	border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.notice-text {
	flex: 1;
}

.notice--info {
	background: #e3f0fb;
	color: #174a7c;
}

.notice--warning {
	background: #fdf0d5;
	color: #7a4b00;
}

.notice--critical {
	background: #fbe1e1;
	color: #8a1c1c;
}

.notice--maintenance {
	background: #2b2318;
	color: #f3ede1;
}

.notice--maintenance .notice-icon {
	color: #f5b942;
}
</style>
