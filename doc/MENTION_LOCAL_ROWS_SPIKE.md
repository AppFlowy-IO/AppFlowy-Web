# Mention local rows lane: spike report (MEN-WEB-15)

Status: measured 2026-11-11 on branch `wip/mention-web-w3`. Decision: ship the lane behind the @
picker's v2 switch; keep the server's rows request (leaving it out stays behind a switch of its own,
off by default).

## Question

Rows created seconds ago are not in typed @ results until Search indexes them, and in a Text cell
or a row page the picker sends a rows-only request, filtered to the database, on every typed
keystroke group. How much of the open database's primary-field text does the tab hold, can the
picker match it on each keystroke within budget, and is it enough to leave the server's rows
request out?

## What was built

- `src/application/database-yjs/mention-local-rows.ts`: a source per database document. Nothing is
  read until a picker subscribes. Rows are the database's membership (every view's live row
  orders). A row the tab has open (rendered, opened, just created) is read from its live document,
  which is observed; any other row from its committed seed (`peekDatabaseRowDocSeed`), decoded into
  a throwaway document in slices of about 8 ms. Only titles and creation times are kept, and a
  seed's title is kept with the seed object, so the next picker does not decode it again.
  `complete` holds when every row has a title and `holdsDatabaseSourceRows` holds; a row whose seed
  waits for a slice has no title yet, and a refresh that reads a titled row's seed again keeps it.
- `src/components/editor/components/panels/mention-panel/mentionLocalRows.ts`: per keystroke, a
  word filter (a title matches at some tier only if it contains every query word) and then the
  typeahead contract's tiers and in-tier keys, at most 60 rows, as lane items the contract's merge
  adds to Pages. A row created at most 15 minutes ago is flagged fresh.
- The panel, the Text cell context and the row page wire them; see "Mention local rows lane" in
  `doc/web-server-compatibility.md`.

## Method

- Jest, the shipped modules: `__tests__/mentionLocalRows.bench.test.ts` in the mention panel,
  skipped unless `MENTION_ROWS_BENCH=1`. The row walk is the real `prefetchDatabaseBlobDiff` over
  10,000 synthetic rows (a primary text cell and six more, about 726 bytes of row state each), served
  in pages of 256 as the server pages them; the network, IndexedDB and the outbox are in-memory fakes,
  so the walk's times are the client's own work only.

  ```
  MENTION_ROWS_BENCH=1 node --expose-gc node_modules/jest/bin/jest.js \
    src/components/editor/components/panels/mention-panel/__tests__/mentionLocalRows.bench.test.ts \
    --no-coverage --maxWorkers=1
  ```

- Plain Node, the same modules bundled with esbuild (no jsdom, no ts-jest), for V8 numbers close to
  a browser's: the index build from seeds, the keystroke cost and the merge.
- Machine: Apple M1 Max, macOS, Node 23.5.0. Three Jest runs and five Node runs; ranges below.
- Not measured here: a browser on a seeded 10,000-row grid against a live stack, and the coverage
  comparison with the live mention API (see "Remaining").

## Residency

From the code (`Database.tsx` `getActiveViewRowDataNeed`, `database-blob`):

- A database is resident (`isDatabaseSourceResident`) only after a walk that covered the full
  snapshot settled with its complete seed set: a first visit without a cached RID, or a full walk,
  which a grid, board or list with groups, a chart, a row search, filters or sorts start.
- A plain grid revisited after a reload walks only the rows that changed since its cached RID, so it
  is never resident; its rows come from IndexedDB as they render.
- A full row page walks a delta too: resident only when cold, or while the grid's walk left the
  database resident (a view of it mounted, or left less than 60 s ago).
- A Text cell and a row peek opened from the grid share the grid's database context and residency.
  Dashboard layouts and published pages walk nothing.
- `seedsReady` and `blobPrefetchComplete` are also set when a walk fails or is skipped, so they prove
  nothing; the lane reads `holdsDatabaseSourceRows` and checks that every row has a title.

Measured (Jest):

| Case                                                   | Result                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold walk, 10,000 rows, 40 pages, 7.26 MB of row state | Seeds committed (`seedsReady`) after 119-141 ms of client work, walk settled after 1.44-1.73 s (persisting into the fake store); `holdsDatabaseSourceRows` true from `seedsReady`, resident once settled, all 10,000 seeds readable |
| 10,001 rows                                            | Resident, but 10,000 seeds readable: the seed lookup holds 10,000 seeds across all databases (`MAX_ROW_DOC_SEEDS_LOOKUP`). The index lists 10,000 rows and is never complete                                                        |
| A 1,000-row database walked after those two            | The first database keeps none of its 10,000 seeds and the 10,001-row one 9,000, while both stay `isDatabaseSourceResident`                                                                                                          |
| Reload with a cached RID, 25 rows changed              | Not resident; the index lists the 40 rows the grid rendered (live) and is never complete                                                                                                                                            |

So residency is the exception: it needs a cold or full walk, no more than 10,000 rows in the seed
lookup across every database the tab walked, and the seeds not yet released. The lane therefore
lists what the tab holds (always the rows it has open, which includes every row it just created) and
treats the database as complete only when every row has a title.

## Index build

|                                                                                    | Jest                                                                                | Node                                                |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| 10,000 rows from seeds: on subscribe (synchronous)                                 | 10.3-12.7 ms                                                                        | 7.2-9.4 ms                                          |
| then seed slices                                                                   | 89-134 slices, 727-1,313 ms in all, longest 9.4 ms (58.6 ms in one run, a GC pause) | 21-22 slices, 169-179 ms in all, longest 8.6-9.4 ms |
| Heap kept by the index                                                             | 2.9 MB                                                                              | 2.3-3.9 MB                                          |
| The next picker (titles kept with their seeds)                                     | 9.4-17.9 ms on subscribe, 3-4 slices, 23-26 ms                                      | 7.8-8.5 ms, 1 slice of 4.7-5.9 ms                   |
| 10,000 live rows, all read on subscribe                                            | 51-57 ms                                                                            | not run                                             |
| 500 live rows and the rest from kept titles                                        | not run                                                                             | 10.4-12.2 ms on subscribe                           |
| Reading every row through the shared seed documents (`peekRowDocFromSeed`) instead | 194 MB kept per 10,000 rows                                                         | 198 MB (19.4 KB a row)                              |

The shared seed documents that filter and sort build would cost about 200 MB for 10,000 rows, so
the lane decodes each seed into a throwaway document and keeps only the title.

## Keystroke cost

Twenty queries (one letter to three words, CJK, digits, no match), warm caches:

|                                                    | Jest median  | Jest p95     | Node median  | Node p95     |
| -------------------------------------------------- | ------------ | ------------ | ------------ | ------------ |
| The rows lane over 10,000 titles                   | 1.39-1.54 ms | 3.41-3.93 ms | 0.79-0.87 ms | 1.86-1.89 ms |
| The same ranking without the word filter           | 2.25-2.78 ms | 3.31-4.19 ms | 1.07-1.16 ms | 1.52-1.76 ms |
| The picker's merge with 5,000 views, without rows  | 1.36-2.09 ms | 3.65-5.04 ms | 0.86-1.04 ms | 2.32-3.01 ms |
| The same with the rows lane (its ranking included) | 2.99-3.57 ms | 5.54-7.72 ms | 1.89-2.03 ms | 3.59-3.81 ms |

Normalizing the 10,000 titles once, when the picker opens: 5.9-7.2 ms (Jest), 4.7-4.9 ms (Node). The
synthetic titles share a twelve-word vocabulary, so a query like `road` keeps a sixth of them past
the word filter; with real, more varied titles the filter drops more. A one-letter query matches
thousands of titles either way; the ranking stops at the 60 best.

## Freshness

- Creating a row registers its live document (`registerRowSync`, the row cache) and adds it to
  `rowMap` once the server commits it, as its row order reaches the database document; the index
  reads it as a live row at once, also on a picker opened later.
- With the picker open, a row added to a 10,000-row database is listed after the transaction that
  adds its row order (one microtask): 5.6-15.8 ms in Jest and 4.1-5.7 ms in Node to read the
  membership again. Typing its title costs 0.26-0.36 ms; the row is then found by its prefix and
  flagged fresh.
- The panel test lists a row created a second earlier in the render of the keystroke that matches
  it, before any answer, with `data-fresh="true"`.

## Coverage

Not measured: it needs the live mention API on a seeded grid. Search's rows request matches a row by
keyword over the row's indexed text (its title and content, MQ-13), while the lane matches the
primary field's text only, with the contract's tiers (T3 or better). For a row it holds, the lane
finds what a title-tier server hit finds, by the same rules; it cannot find a row by its body or
other cells, nor by Search's typo tolerance (which the client ranks at T4 anyway).

## Decision

- The lane ships behind the picker's v2 switch, on with its local lane
  (`localStorage.__mention_local_rows = 'false'` turns it off): it adds only what the tab already
  holds, within the measured cost, and makes a row created seconds ago findable at once. Every
  suggested ship criterion it can be measured against holds: index under 1 s of idle time after
  `seedsReady` (0.17-0.18 s in Node; Jest's 0.73-1.31 s is a slow upper bound), under 5 MB, and a
  keystroke p95 under 4 ms.
- The server's rows request stays by default. Leaving it out
  (`localStorage.__mention_local_rows_skip_server = 'true'`) applies only while the database is
  complete, which is rare (above), and would drop the non-title matches whose share is unmeasured.

## Remaining

1. A browser measurement on a seeded 10,000-row grid against a local stack (the large-database
   Playwright fixture, `@large-database`): time to `seedsReady` and to a complete index, residency on
   a reopen and on a row page, and a Text cell finding a just-created row before any response.
2. The coverage comparison: for about 20 queries on the seeded grid, the server rows lane's top 8
   against the local matches, and how many server hits match by something other than the title.
   Only that can justify turning `__mention_local_rows_skip_server` on.
3. Residency per row: the seed lookup's 10,000-seed cap is shared by every database, and
   `isDatabaseSourceResident` stays true after another database's walk evicted the seeds. The lane
   checks each row, but a database-blob signal for "every seed of this database is readable" would
   let it skip the check and say why a database is not complete.
4. Desktop can build the same lane from its RowCache (MEN-DESK side).
