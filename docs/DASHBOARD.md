# Dashboard

The landing page after login: a single aggregate endpoint feeding every KPI
tile and chart on the page. Deliberately the simplest kind of module in this
app - one route, no mutations, no sub-concepts - documented here mainly to
explain the shape of its response and why it's built as one big query
instead of several small ones.

## Contents

- [One endpoint, twelve queries](#one-endpoint-twelve-queries)
- [Category shelves](#category-shelves)
- [Where this lives in code](#where-this-lives-in-code)

## One endpoint, twelve queries

`GET /dashboard` ([`DashboardRoute.ts`](../server/src/routes/DashboardRoute.ts))
runs everything the dashboard needs concurrently via a single `Promise.all`,
then assembles it into one JSON response:

| Field | Source |
|---|---|
| `lastBooks` | Up to 10 books added in the last 30 days, newest first. |
| `totalBooks` / `totalThisMonth` / `totalLastMonth` | Counts, this/previous calendar month via `date_trunc('month', ...)`. |
| `totalCategories` / `totalCustomers` / `totalLocations` / `totalAuthors` | Simple `COUNT(*)` per table. |
| `booksInTime` | Books added, grouped by month - powers the trend chart (`BooksInTimeChart.vue`). |
| `stockStatus` | `book_stocks` grouped by `status` - available/not-available/booked/damaged breakdown. |
| `totalBookedBooks` | Count of stocks with `status = 2` (i.e. currently loaned, to a customer or a vault member). |
| `categoryShelves` | Top 6 categories by book count, each with up to 10 of its most recent books - see [below](#category-shelves). |
| `currentlyOnLoan` | The 5 most recent loans (by stock id), with borrower name - turns the "booked books" count into an actual browsable list. |

One round trip, one loading spinner on the client - there's no per-widget
fetching or skeleton staggering, which is the tradeoff of returning
everything from a single endpoint. If a query is slow, the whole dashboard
waits on it.

`COUNT(*)` in Postgres returns a `bigint`, which `node-postgres` serializes
as a *string* to avoid precision loss on values above
`Number.MAX_SAFE_INTEGER`. Every count in this response is explicitly cast
back to `Number(...)` before being sent - a user's library is nowhere near
that range, and the client's TypeScript types (plus Vuetify's prop
validation) expect real numbers, not numeric strings.

## Category shelves

The one non-trivial query in this file. Goal: show the top 6 categories by
book count, each as a horizontally-scrolling "shelf" of up to 10 of its most
recent books (browsable straight from the dashboard). Built as a single CTE
query rather than 6+1 round trips:

1. `top_categories` - the 6 categories with the most books.
2. `ranked_books` - every book in those categories, numbered by recency
   within its own category (`ROW_NUMBER() OVER (PARTITION BY category_id
   ORDER BY date_created DESC)`).
3. Join and keep only `rn <= 10` per category.

The result comes back **denormalized** (one row per book, category fields
repeated) and is folded into one entry per category server-side, before
being sent to the client:

```
{ id, name, count, books: [{ id, name, image_url }, ...] }
```

## Where this lives in code

| Concern | File |
|---|---|
| The aggregate endpoint | `server/src/routes/DashboardRoute.ts` |
| Client: `/dashboard` HTTP client | `client/src/service/dashboard/DashboardService.ts` |
| Client: page controller | `client/src/controller/dashboard/DashboardController.ts` |
| Client: dashboard page UI | `client/src/views/dashboard/DashboardView.vue`, `DashboardCard.vue`, `BooksInTimeChart.vue` |
