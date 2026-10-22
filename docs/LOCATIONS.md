# Locations

Where a physical book actually is - shelves, rooms, boxes, whatever unit of
storage makes sense for the collection. The smallest module in the app: one
route file, no sub-concepts.

## Contents

- [Mental model](#mental-model)
- [The "exactly one location" shortcut](#the-exactly-one-location-shortcut)
- [Moving books between locations](#moving-books-between-locations)
- [Where this lives in code](#where-this-lives-in-code)

## Mental model

A `locations` row is just a name + description (`user_id`-scoped, like
everything else). Every [`book_stocks`](BOOKS.md#the-stock-lifecycle) row
points at exactly one location via `location_id` - a location doesn't "hold"
books directly, it's the other side of that foreign key.

`GET /location` returns each location with a `total_books` count, computed
live (`SELECT COUNT(*) FROM book_stocks WHERE location_id = locations.id`),
not a stored counter - always exact, at the cost of a subquery per row.

## The "exactly one location" shortcut

Covered in more detail in [BOOKS.md](BOOKS.md#creating-a-book):
`__automaticallyAddBookToLocation()` in `BooksRoute.ts` auto-assigns a new
book's first stock to the user's location *only if they have exactly one*.
This module doesn't do anything special to support that - it's entirely a
convenience in the book-creation path, worth knowing about here because it's
the reason a brand-new single-shelf collection never has to touch the
Locations page at all until a second shelf is added.

## Moving books between locations

`POST /location/:id/add/books` takes a batch of scanned/typed stock codes
and reassigns each one's `location_id` to the destination - the same
scan-a-batch UX as the customer lending flow (see
[CUSTOMERS.md](CUSTOMERS.md#lending-and-returning-books)), just moving
shelf instead of moving borrower. It only touches `location_id`; a stock's
`status`/`customer_id` are untouched, so moving a loaned copy to a different
shelf (e.g. reorganizing while some books are checked out) doesn't
accidentally return it.

`GET /location/:id/books` lists what's currently there (joined with `books`
for name/cover/ISBN) - this is what that add-books flow refreshes into after
a successful move.

## Where this lives in code

| Concern | File |
|---|---|
| Location CRUD, move-books endpoint | `server/src/routes/LocationRoute.ts` |
| `locations` schema | `assets/db/databaseSchema.sql` |
| Client: `/location` HTTP client | `packages/api-client/src/LocationsService.ts` |
| Client: page controller | `client/src/controller/locations/LocationsController.ts` |
| Client: locations page UI | `client/src/views/locations/LocationsView.vue`, `LocationDialog.vue`, `LocationBooksTable.vue`, `LocationAddBooksDialog.vue` |
