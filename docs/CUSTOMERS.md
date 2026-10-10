# Customers & lending

Who a book is currently lent to, and how customers are organized into
groups. This - along with [LOCATIONS.md](LOCATIONS.md) and
[LOANS.md](LOANS.md) - is part of the opt-in "leasing" feature set (see
[below](#leasing-is-opt-in)); most solo collectors never turn it on.

## Contents

- [Mental model](#mental-model)
- [Vault members as borrowers](#vault-members-as-borrowers)
- [Customer groups](#customer-groups)
- [Lending and returning books](#lending-and-returning-books)
- [Leasing is opt-in](#leasing-is-opt-in)
- [Where this lives in code](#where-this-lives-in-code)

## Mental model

A `customers` row is a borrower - a person (or, loosely, any named
borrower) a book can be lent to. There's no login, email, or account behind
a customer; it's just a name the *library owner* tracks, scoped to
`customers.user_id`.

"Currently has a book on loan" isn't a column on `customers` - it's derived
from `book_stocks`: a stock is on loan to a customer exactly when its
`status = 2` (`BOOKED`, see [BOOKS.md](BOOKS.md#the-stock-lifecycle)) and
`customer_id` points at them. There's no separate "loan" table for the
*current* state - `loan_history` (see [LOANS.md](LOANS.md)) is a parallel,
append-only log of the same events, kept for reporting, not the source of
truth for "who has what right now."

## Vault members as borrowers

A book can also be lent to a **vault member** instead of a customer: the
borrower picker on a stock lists customers *and* accepted vault members whose
role can borrow (`GET /app/policy` returns them as `borrowingMembers`, only to
roles that can edit the catalog). Members are not copied into `customers`; a
loan to one sets `book_stocks.member_user_id` (and
`loan_history.member_user_id`) instead of `customer_id`. Members have no
group. Lending to a member goes through the stock dialog on the book page; the
Customers page only lends to customers.

| Role | Borrow | Edit catalog | Manage members | Manage settings |
|---|---|---|---|---|
| `readonly` | no | no | no | no |
| `borrower` | yes | no | no | no |
| `normal` | yes | yes | no | no |
| `admin` | yes | yes | yes | yes |

What each role sees in the app:

- **`borrower`** - browse-only. The library (books, locations, categories,
  authors), their own reading status, **My loans** (`GET /loans/mine`, the
  copies currently lent to them) and their loan history
  (`GET /loans/mine/history`). No add/import/edit/delete buttons, no
  Customers or Loans management pages, no print queue; the server rejects
  those requests too (`403`), including lending/returning through the
  Customers page and listing customers or everyone's loans.
- **`readonly`** - the same browsing, without borrowing or "My loans".
- **`normal` / `admin`** - everything above; both can also be lent books and
  have a "My loans" page of their own.

**Reading status** (want to read / currently reading / read) is personal: it
lives in `book_reading_status (book_id, user_id, status)`, so every member of a
shared vault has their own shelves, and any role - including `borrower` - can
set it (`PUT /book/:id/reading-status`). The library filters, counters and the
dashboard shelves only reflect the caller's own statuses.

Removing a member from the vault only removes them from the picker; copies
they already hold stay booked to them until returned. Deleting their account
returns those copies to available and deletes their loan history.

## Customer groups

`customer_groups` is a simple, optional way to organize customers - e.g. a
school library might group borrowers by class ("Class 4B"). CRUD lives at
`/customer/group` (`GET`/`POST`/`PUT`/`DELETE`), plus two endpoints to move
a customer in and out of a group:

- **`PUT /customer/:id/group/:groupId`** - assign.
- **`DELETE /customer/:id/group`** - unassign (sets `group_id` to `NULL`).

Deleting a group (`DELETE /customer/group/:id`) does **not** delete its
members - their `customers.group_id` just goes back to `NULL` (an `ON DELETE
SET NULL` foreign key), so removing a group is safe to do even with active
members in it.

Group names are unique per user - `POST`/`PUT` surface a Postgres unique
violation (`error.code === '23505'`) as a 409 rather than a generic 500.

`GET /customer/group` returns each group with a `total_customers` count
(a `LEFT JOIN` + `COUNT`, not a stored counter), used for the group picker
UI in [`CustomerGroupsTree.vue`](../client/src/views/customers/components/CustomerGroupsTree.vue).

## Lending and returning books

Three ways a book ends up on loan or comes back, all in
[`CustomerRoute.ts`](../server/src/routes/CustomerRoute.ts) or
[`BooksRoute.ts`](../server/src/routes/BooksRoute.ts):

| Action | Endpoint | What it does |
|---|---|---|
| Lend a batch to a customer | `POST /customer/:id/add/books` | For each scanned/typed stock code: `book_stocks.status = 2`, `customer_id = <id>`, `loaned_at = NOW()`. Also writes a `loan_history` row per book (`recordLoan`). |
| List what a customer currently holds | `GET /customer/:id/books` | Joins `book_stocks`/`books` on `customer_id`. |
| Return one book | `DELETE /customer/:id/book/:bookStockCode` | Clears `customer_id`, `status → 0`, `loaned_at → NULL`. Closes the matching `loan_history` row (`recordReturn`). |
| Bulk-return several books | `POST /book/return` (BooksRoute.ts) | Same as above, by stock code, not scoped to one customer - used when a customer brings back several books from different loans at once. |

The lending flow is barcode-driven end to end: the UI scans/types a stock
`code` (see [`BarcodeScanner.vue`](BOOKS.md#barcodestock-code-scanning)),
looks it up with `GET /book/:bookCode/add/md` to show what's about to be
added, then submits the batch. Nothing here requires knowing a book's
catalog id - the stock code is the only identifier the physical workflow
needs.

Every lend/return here writes to `loan_history` via the shared
[`recordLoan`/`recordReturn`](../server/src/utils/LoanHistory.ts) helpers -
see [LOANS.md](LOANS.md) for why that table exists separately from
`book_stocks` and what reads it.

## Leasing is opt-in

The Customers and Loans pages (and their nav items) are hidden by default -
most accounts just track a personal collection and never lend anything out.
A user turns this on in **Settings > Features** (`users.leasing_enabled`,
see [SETTINGS.md](SETTINGS.md)), which:

- adds "Customers" and "Loans" to the left nav (`AppMenu.vue`), and
- lifts a client-side route guard in [`Router.ts`](../client/src/router/Router.ts)
  that otherwise redirects those paths back to the dashboard even if
  bookmarked/typed directly - defense in depth, not the actual authorization
  boundary (every request is still scoped by `user_id` server-side
  regardless of this flag).

## Where this lives in code

| Concern | File |
|---|---|
| Customer/group CRUD, lend/return endpoints | `server/src/routes/CustomerRoute.ts` |
| `loan_history` bookkeeping | `server/src/utils/LoanHistory.ts` |
| `customers`/`customer_groups` schema | `assets/db/databaseSchema.sql` |
| Client: `/customer` HTTP client | `client/src/service/customers/CustomersService.ts`, `CustomerGroupService.ts` |
| Client: page controllers | `client/src/controller/customers/CustomersController.ts`, `CustomerGroupsController.ts` |
| Client: customers page UI | `client/src/views/customers/CustomersView.vue`, `client/src/views/customers/components/` |
| Client: leasing feature toggle | `client/src/views/settings/SettingsView.vue`, `client/src/router/Router.ts` |
