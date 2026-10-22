# Catalog reference data

Categories, authors, languages, and formats - the small lookup tables every
book references. Individually trivial (each is close to the simplest CRUD
possible); documented together because they share one pattern and one
delivery mechanism: the app-policy bootstrap.

## Contents

- [Two kinds of reference data](#two-kinds-of-reference-data)
- [Categories](#categories)
- [Authors](#authors)
- [Languages & formats](#languages--formats)
- [The policy bootstrap](#the-policy-bootstrap)
- [Where this lives in code](#where-this-lives-in-code)

## Two kinds of reference data

- **Per-user** (`categories`, `authors`): each user has their own list,
  scoped by `user_id`, full CRUD. Two users can both have a "Fantasy"
  category with different ids and no relationship to each other.
- **Global** (`languages`, `formats`): one shared table for the whole
  deployment, read-only from the client's perspective - there's no
  `POST`/`PUT`/`DELETE` for either in the REST API today. New language rows
  are created implicitly by the [ISBN lookup](BOOKS.md#isbn-auto-lookup)
  (`ensureLanguage()`) when a book's detected language isn't already present.

## Categories

Straight CRUD at `/category` ([`CategoriesRoute.ts`](../server/src/routes/CategoriesRoute.ts)):
`GET`/`POST`/`PUT /:id`/`DELETE /:id`, each row just `{id, name}`. Used to
group books by genre/shelving section (`books.category_id`) and referenced
throughout search (`GET /book/search?category_id=`) and the
[dashboard's category shelves](DASHBOARD.md).

Deleting a category doesn't cascade to books - `books.category_id` is
nullable, so a book left without its category just becomes uncategorized
rather than being deleted itself (verify against the schema before relying
on this if you're changing the FK).

## Authors

Same CRUD shape at `/author`
([`AuthorRoute.ts`](../server/src/routes/AuthorRoute.ts)), plus one extra:

- **`POST /author/search`** - case-insensitive substring match on `name`,
  used by the author picker/autocomplete when editing a book
  (`{ "query": "tolk" }` → any author whose name contains "tolk").

The book-to-author relationship is many-to-many via `book_authors`, resolved
on `PUT /book/:id` by diffing the submitted author id list against the
existing associations (see [BOOKS.md](BOOKS.md)) - this route never touches
`book_authors` itself, only the `authors` table's own rows.

## Languages & formats

Both are flat `{code/id, name}` tables with no per-user data, fetched as
part of the [policy bootstrap](#the-policy-bootstrap) rather than through
their own dedicated list endpoints. `languages.code` is a `CHAR(2)` (ISO
639-1); `formats` is an arbitrary short id/name pair (e.g. "Paperback",
"Hardcover", "Electronic" - see `ELECTRONIC_FORMAT_NAME` in
[`Constants.ts`](../client/src/Constants.ts), which the client uses to
detect an ebook edition for `Book.isElectronic()`).

## The policy bootstrap

All four of these lists - plus the current user's profile and UI label
translations - are delivered together in one payload, fetched once right
after login:

**`GET /app/policy`** ([`AppRoute.ts`](../server/src/routes/AppRoute.ts))
returns `{ user, categories, languages, formats, locations, customers, labels }`.
Each section is fetched independently and defaults to `[]`/`{}` on its own
failure (a try/catch per section) - one failing sub-query (say, a locations
table hiccup) degrades that one dropdown instead of blocking login entirely.

On the client, [`ApplicationService.fetchPolicy()`](../client/src/service/ApplicationService.ts)
is the single call site: it turns the raw payload into typed model
instances (`Category[]`, `Language[]`, `Format[]`, `Location[]`,
`Customer[]`, `User`), sets the active i18n locale from `user.language`, and
registers `labels` as that locale's translation messages. Every page that
needs "the list of categories to pick from" reads it from this shared
in-memory service rather than re-fetching - see
[CLIENT-ARCHITECTURE.md](CLIENT-ARCHITECTURE.md#the-policy-bootstrap-applicationservice)
for how that fits into app startup.

## Where this lives in code

| Concern | File |
|---|---|
| Category CRUD | `server/src/routes/CategoriesRoute.ts` |
| Author CRUD + search | `server/src/routes/AuthorRoute.ts` |
| Policy bootstrap (languages, formats, locations, customers, labels, user) | `server/src/routes/AppRoute.ts` |
| `categories`/`authors`/`book_authors`/`languages`/`formats` schema | `assets/db/databaseSchema.sql` |
| Client: `/category`, `/author` HTTP clients | `packages/api-client/src/CategoriesService.ts`, `packages/api-client/src/AuthorsService.ts` |
| Client: page controllers | `client/src/controller/categories/CategoriesController.ts`, `client/src/controller/authors/AuthorsController.ts` |
| Client: shared app-wide state | `client/src/service/ApplicationService.ts` |
| Client: categories/authors page UI | `client/src/views/categories/`, `client/src/views/authors/` |
