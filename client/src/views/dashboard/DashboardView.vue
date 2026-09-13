<template>
	<page-component :model="controller">
		<template v-slot:append>
			<return-books-dialog/>
		</template>

		<template v-slot:default>
			<div class="dashboard-hero pb-card pb-spine-top mt-3">
				<div class="dashboard-hero-text">
					<h1 class="dashboard-hero-title pb-display">
						{{ t(AppLabels.DASHBOARD_HERO_PREFIX) }}
						<span class="dashboard-hero-count">
							{{ controller.getTotalThisMonth() }}
							<v-icon
								size="20"
								:color="upBooksTrend ? 'success' : 'error'"
							>
								{{ upBooksTrend ? 'mdi-arrow-top-right' : 'mdi-arrow-bottom-left' }}
							</v-icon>
						</span>
						{{ t(AppLabels.DASHBOARD_HERO_SUFFIX) }}
					</h1>

					<div v-if="controller.getCategoryShelves().length" class="dashboard-pills">
						<router-link :to="searchRoute.getPath()" class="dashboard-pill dashboard-pill--active">
							{{ t(AppLabels.DASHBOARD_ALL_CATEGORIES) }}
							<span class="dashboard-pill-count">{{ controller.getTotalBooks() }}</span>
						</router-link>

						<router-link
							v-for="category in controller.getCategoryShelves()"
							:key="category.id"
							:to="searchRoute.getPathForCategory(category.id)"
							class="dashboard-pill"
						>
							{{ category.name }}
							<span class="dashboard-pill-count">{{ category.count }}</span>
						</router-link>
					</div>
				</div>

				<div class="dashboard-hero-shelf">
					<empty-state
						v-if="controller.getLastBooks().length === 0"
						compact
						icon="mdi-book-plus-outline"
						:title="t(AppLabels.EMPTY_LAST_BOOKS_TITLE)"
						:description="t(AppLabels.EMPTY_LAST_BOOKS_DESC)"
					>
						<v-btn
							@click="goToLibrary()"
							class="text-none"
							color="primary"
							variant="elevated"
							size="small"
						>
							{{ t(AppLabels.ADD_BOOK) }}
						</v-btn>
					</empty-state>

					<div v-else class="dashboard-shelf-scroll">
						<router-link
							v-for="item in controller.getLastBooks()"
							:key="item.id"
							:to="getBookUrl(item.id)"
							class="dashboard-shelf-book"
						>
							<img
								:src="item.image_url ?? notFound"
								@error="onCoverError"
								class="dashboard-shelf-cover"
							/>
							<span class="dashboard-shelf-title">{{ item.name }}</span>
						</router-link>
					</div>
				</div>
			</div>

			<div v-if="categoryShelvesWithBooks.length" class="dashboard-section mt-3">
				<h2 class="dashboard-section-title pb-display">{{ t(AppLabels.DASHBOARD_BROWSE_CATEGORIES) }}</h2>

				<div
					v-for="shelf in categoryShelvesWithBooks"
					:key="shelf.id"
					class="dashboard-shelf-row"
				>
					<router-link :to="searchRoute.getPathForCategory(shelf.id)" class="dashboard-shelf-row-header">
						<span class="dashboard-shelf-row-name">{{ shelf.name }}</span>
						<span class="dashboard-shelf-row-count">{{ shelf.count }}</span>
						<v-icon size="16" color="var(--pb-text-muted)">mdi-chevron-right</v-icon>
					</router-link>

					<div class="dashboard-shelf-scroll">
						<router-link
							v-for="book in shelf.books"
							:key="book.id"
							:to="getBookUrl(book.id)"
							class="dashboard-shelf-book"
						>
							<img
								:src="book.image_url ?? notFound"
								@error="onCoverError"
								class="dashboard-shelf-cover"
							/>
							<span class="dashboard-shelf-title">{{ book.name }}</span>
						</router-link>
					</div>
				</div>
			</div>

			<div v-if="leasingEnabled" class="mt-3">
				<dashboard-card
					:title="t(AppLabels.DASHBOARD_ON_LOAN)"
					:counter="controller.getTotalBookedBooks()"
				>
					<template v-slot:actions>
						<router-link
							v-if="controller.getCurrentlyOnLoan().length > 0"
							:to="loansRoute.getPath()"
							class="dashboard-card-view-all"
						>
							{{ t(AppLabels.VIEW_ALL) }}
							<v-icon size="14">mdi-arrow-right</v-icon>
						</router-link>
					</template>

					<empty-state
						v-if="controller.getCurrentlyOnLoan().length === 0"
						compact
						icon="mdi-bookmark-check-outline"
						:title="t(AppLabels.DASHBOARD_NO_LOANS)"
					/>

					<template v-else>
						<p
							v-if="controller.getTotalBookedBooks() > controller.getCurrentlyOnLoan().length"
							class="dashboard-loans-note"
						>
							{{ t(AppLabels.DASHBOARD_LOANS_NOTE) }}
						</p>

						<div class="dashboard-loans">
							<router-link
								v-for="loan in controller.getCurrentlyOnLoan()"
								:key="`${loan.bookId}-${loan.customerId}`"
								:to="getBookUrl(loan.bookId)"
								class="dashboard-loan-row"
							>
								<img
									:src="loan.imageUrl ?? notFound"
									@error="onCoverError"
									class="dashboard-loan-cover"
								/>
								<div class="dashboard-loan-text">
									<span class="dashboard-loan-book">{{ loan.bookName }}</span>
									<span class="dashboard-loan-customer">{{ t(AppLabels.DASHBOARD_LOANED_TO) }} {{ loan.customerName }}</span>
								</div>
							</router-link>
						</div>
					</template>
				</dashboard-card>
			</div>

			<div class="mt-3 dashboard-reading-row">
				<dashboard-card :title="t(AppLabels.CURRENTLY_READING)" card-css-class="dashboard-reading-card">
					<template v-slot:actions>
						<router-link
							v-if="controller.getCurrentlyReading().length > 0"
							:to="searchRoute.getPathForFilter(SearchFilter.CURRENTLY_READING)"
							class="dashboard-card-view-all"
						>
							{{ t(AppLabels.VIEW_ALL) }}
							<v-icon size="14">mdi-arrow-right</v-icon>
						</router-link>
					</template>

					<empty-state
						v-if="controller.getCurrentlyReading().length === 0"
						compact
						icon="mdi-book-open-page-variant-outline"
						:title="t(AppLabels.DASHBOARD_NO_CURRENTLY_READING)"
					/>

					<div v-else class="dashboard-shelf-scroll">
						<router-link
							v-for="book in controller.getCurrentlyReading()"
							:key="book.id"
							:to="getBookUrl(book.id)"
							class="dashboard-shelf-book"
						>
							<img
								:src="book.image_url ?? notFound"
								@error="onCoverError"
								class="dashboard-shelf-cover"
							/>
							<span class="dashboard-shelf-title">{{ book.name }}</span>
						</router-link>
					</div>
				</dashboard-card>

				<dashboard-card :title="t(AppLabels.WANT_TO_READ)" card-css-class="dashboard-reading-card">
					<template v-slot:actions>
						<router-link
							v-if="controller.getWantToRead().length > 0"
							:to="searchRoute.getPathForFilter(SearchFilter.WANT_TO_READ)"
							class="dashboard-card-view-all"
						>
							{{ t(AppLabels.VIEW_ALL) }}
							<v-icon size="14">mdi-arrow-right</v-icon>
						</router-link>
					</template>

					<empty-state
						v-if="controller.getWantToRead().length === 0"
						compact
						icon="mdi-bookmark-outline"
						:title="t(AppLabels.DASHBOARD_NO_WANT_TO_READ)"
					/>

					<div v-else class="dashboard-shelf-scroll">
						<router-link
							v-for="book in controller.getWantToRead()"
							:key="book.id"
							:to="getBookUrl(book.id)"
							class="dashboard-shelf-book"
						>
							<img
								:src="book.image_url ?? notFound"
								@error="onCoverError"
								class="dashboard-shelf-cover"
							/>
							<span class="dashboard-shelf-title">{{ book.name }}</span>
						</router-link>
					</div>
				</dashboard-card>

				<dashboard-card :title="t(AppLabels.DASHBOARD_TOTAL_READ)" card-css-class="dashboard-reading-stat">
					<div class="dashboard-stat-number">{{ controller.getTotalRead() }}</div>
				</dashboard-card>
			</div>

			<div class="mt-3">
				<dashboard-card :title="t(AppLabels.DASHBOARD_CHART)" large>
					<books-in-time-chart :data="controller.getBooksInTime()"/>
				</dashboard-card>
			</div>
		</template>
	</page-component>
</template>

<script setup lang="ts">
/**
 * Dashboard/overview view: an editorial hero (books added this month, a
 * horizontally scrolling "shelf" of recently added covers, and category
 * pills), "browse by category" shelves, a "currently on loan" list (with a
 * link through to the full Loans view), "currently reading"/"want to read"
 * shelves with a "books read" counter, and the books-added-over-time chart,
 * all backed by `DashboardController`.
 */
import PageComponent from "@/views/PageComponent.vue";
import DashboardController from "@/controller/dashboard/DashboardController";
import DashboardCard from "@/views/dashboard/DashboardCard.vue";
import BooksInTimeChart from "@/views/dashboard/BooksInTimeChart.vue";
import {bookRoute} from "@/router/routes/BookRoute";
import {computed} from "vue";
import {useI18n} from "vue-i18n";
import {AppLabels} from "@/plugins/i18n/AppLabels";
import ReturnBooksDialog from "@/views/loans/components/ReturnBooksDialog.vue";
import EmptyState from "@/components/emptyState/EmptyState.vue";
import router from "@/router/Router";
import {searchRoute} from "@/router/routes/SearchRoute";
import {loansRoute} from "@/router/routes/LoansRoute";
import {SearchFilter} from "@/types/search/SearchFilter";
import {applicationService} from "@/service/ApplicationService";
//@ts-ignore
import notFound from "@/assets/images/notFound.jpg";

const controller = new DashboardController();

const {t} = useI18n();

function getBookUrl(id: number) {
	return bookRoute.getPath(id)
}

function goToLibrary() {
	router.push(searchRoute.getPath());
}

function onCoverError(event: Event) {
	const img = event.target as HTMLImageElement;
	img.onerror = null;
	img.src = notFound;
}

const upBooksTrend = computed(() => controller.getTotalThisMonth() > controller.getTotalLastMonth())

const leasingEnabled = computed(() => applicationService.getUser().isLeasingEnabled());

const categoryShelvesWithBooks = computed(() => controller.getCategoryShelves().filter(shelf => shelf.books.length > 1))
</script>

<style scoped lang="scss">
.dashboard-hero {
	display: flex;
	flex-wrap: wrap;
	gap: 24px;
	padding: 24px;
	background: linear-gradient(135deg, var(--pb-accent-soft), var(--pb-surface) 60%);
}

.dashboard-hero-text {
	flex: 1 1 280px;
	min-width: 0;
}

.dashboard-hero-title {
	margin: 0;
	font-size: 30px;
	font-weight: 600;
	line-height: 1.2;
	color: var(--pb-text);
}

.dashboard-hero-count {
	display: inline-flex;
	align-items: center;
	color: var(--pb-accent);
}

.dashboard-pills {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 18px;
}

.dashboard-pill {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 6px 12px;
	border-radius: 999px;
	border: 1px solid var(--pb-border);
	background: var(--pb-surface);
	font-size: 13px;
	font-weight: 500;
	color: var(--pb-text-muted);
	text-decoration: none;
	transition: border-color 0.15s ease, color 0.15s ease;
}

.dashboard-pill:hover {
	border-color: var(--pb-border-strong);
	color: var(--pb-text);
}

.dashboard-pill--active {
	background: var(--pb-accent);
	border-color: var(--pb-accent);
	color: #fff;
}

.dashboard-pill--active:hover {
	color: #fff;
	opacity: 0.9;
}

.dashboard-pill-count {
	font-family: var(--pb-font-mono);
	font-size: 11px;
	opacity: 0.8;
}

.dashboard-hero-shelf {
	flex: 1 1 320px;
	min-width: 0;
	display: flex;
}

.dashboard-shelf-scroll {
	display: flex;
	gap: 14px;
	overflow-x: auto;
	padding: 4px 4px 10px;
	width: 100%;
}

.dashboard-shelf-book {
	flex: 0 0 auto;
	width: 92px;
	text-decoration: none;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.dashboard-shelf-cover {
	width: 92px;
	height: 132px;
	object-fit: cover;
	border-radius: 6px;
	box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
	transition: transform 0.15s ease;
}

.dashboard-shelf-book:hover .dashboard-shelf-cover {
	transform: translateY(-3px);
}

.dashboard-shelf-title {
	font-size: 12px;
	font-weight: 500;
	color: var(--pb-text);
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
	line-height: 1.3;
}

.dashboard-section-title {
	margin: 0 0 12px;
	font-size: 18px;
	font-weight: 600;
	color: var(--pb-text);
}

.dashboard-shelf-row + .dashboard-shelf-row {
	margin-top: 18px;
}

.dashboard-shelf-row-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 8px;
	width: fit-content;
	text-decoration: none;
}

.dashboard-shelf-row-header:hover .dashboard-shelf-row-name {
	color: var(--pb-accent);
}

.dashboard-shelf-row-name {
	font-family: var(--pb-font-display);
	font-size: 15px;
	font-weight: 600;
	color: var(--pb-text);
}

.dashboard-shelf-row-count {
	font-family: var(--pb-font-mono);
	font-size: 11px;
	color: var(--pb-text-muted);
}

.dashboard-loans {
	display: flex;
	flex-direction: column;
}

.dashboard-loan-row {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px 4px;
	text-decoration: none;
	border-bottom: 1px solid var(--pb-border);
}

.dashboard-loan-row:last-child {
	border-bottom: none;
}

.dashboard-loan-cover {
	flex-shrink: 0;
	width: 34px;
	height: 48px;
	object-fit: cover;
	border-radius: 4px;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.dashboard-loan-text {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.dashboard-loan-book {
	font-size: 13px;
	font-weight: 500;
	color: var(--pb-text);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.dashboard-loan-customer {
	font-size: 12px;
	color: var(--pb-text-muted);
}

.dashboard-loans-note {
	margin: 0 0 8px;
	font-size: 12px;
	color: var(--pb-text-muted);
}

.dashboard-card-view-all {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	font-size: 12px;
	font-weight: 600;
	text-transform: none;
	letter-spacing: normal;
	font-family: var(--pb-font-body);
	color: var(--pb-secondary);
	text-decoration: none;
}

.dashboard-card-view-all:hover {
	color: var(--pb-accent);
}

.dashboard-reading-row {
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	align-items: stretch;
}

.dashboard-reading-row > * {
	flex: 1 1 280px;
	min-width: 0;
}

.dashboard-reading-stat {
	flex: 0 1 160px;
}

.dashboard-stat-number {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
	min-height: 64px;
	font-family: var(--pb-font-display);
	font-size: 36px;
	font-weight: 700;
	color: var(--pb-accent);
}
</style>
