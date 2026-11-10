# Mention local rows lane: spike report (MEN-WEB-15)

Status: measured 2026-11-11 on branch `wip/mention-web-w3`, and measured again after the review
fixes; the numbers below are the second measurement, plus one keystroke figure for the second
review's fixes (see "Keystroke cost"). Decision: ship the lane behind the @ picker's v2 switch; keep
the server's rows request (leaving it out stays behind a switch of its own, off by default).

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
  which is observed; when the row cache replaces that document (a version reset or a restore caches
  another under the row's id), the next refresh follows the new one. Any other row is read from its
  committed seed (`peekDatabaseRowDocSeed`), decoded into a throwaway document in slices of about
  8 ms. Only titles and creation times are kept, and a
  seed's title is kept with the seed object, so the next picker does not decode it again. Each row
  says whether its title came from a live document the tab syncs (`synced`, from
  `hasRowDocSyncBinding`) or from a copy that may lag behind Search (a seed, a cached document no
  longer synced). Titles are read again only when what the primary field's text depends on changes
  (which field, its type, its type options), not when it is renamed or its icon changes.
  `complete` holds when every row has a title and `holdsDatabaseSourceRows` holds; a row whose seed
  waits for a slice has no title yet, and a refresh that reads a titled row's seed again keeps it.
- `src/components/editor/components/panels/mention-panel/mentionLocalRows.ts`: per keystroke, a
  word filter (a title matches at some tier only if it contains every query word) and then the
  typeahead contract's tiers and in-tier keys, at most 60 rows, as lane items the contract's merge
  adds to Pages. A row created at most 15 minutes ago is flagged fresh. A row the server lists too
  keeps the server's payload, and its own title only when it is `synced`; any other is left to the
  server's item (`mentionLocalRowsForSections`), whose title is likely the newer one. The row the
  editor is in (the request's `context.row_id`) is never matched: a row page's title is saved as it
  is typed, so it holds the query being typed. Search's item for it still shows.
- The panel, the Text cell context and the row page wire them. Whether a typed query leaves the
  rows request out is decided once, when the query is typed; see "Mention local rows lane" in
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
  a browser's: the index build from seeds, the keystroke cost and the merge. A probe in raw Yjs
  gives what keeping every row as a decoded document costs.
- Machine: Apple M1 Max, 32 GB, macOS 27.0, Node 23.5.0 (the runs print it). Three Jest runs and
  five Node runs; each Node run builds the index from seeds three times, so its index-build figures
  cover 15 builds. The probe ran three times. Each range is the lowest and highest value the runs
  printed, the low end rounded down and the high end rounded up to the precision shown.
- The first measurement, before the review fixes, logged three Jest runs and two Node runs. One of
  those Jest runs was slow throughout, for no recorded cause: a 58.6 ms slice, 1.31 s of slices,
  17.9 ms to subscribe with kept titles, a 15.8 ms membership read, and a merge p95 of 23.1 ms
  without rows and 26.9 ms with them. No run of the second measurement was.
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
| Cold walk, 10,000 rows, 40 pages, 7.26 MB of row state | Seeds committed (`seedsReady`) after 111-131 ms of client work, walk settled after 1.35-1.50 s (persisting into the fake store); `holdsDatabaseSourceRows` true from `seedsReady`, resident once settled, all 10,000 seeds readable |
| 10,001 rows                                            | Resident, but 10,000 seeds readable: the seed lookup holds 10,000 seeds across all databases (`MAX_ROW_DOC_SEEDS_LOOKUP`). The index lists 10,000 rows and is never complete                                                        |
| A 1,000-row database walked after those two            | The first database keeps none of its 10,000 seeds and the 10,001-row one 9,000, while both stay `isDatabaseSourceResident`                                                                                                          |
| Reload with a cached RID, 25 rows changed              | Not resident; the index lists the 40 rows the grid rendered (live) and is never complete                                                                                                                                            |

So residency is the exception: it needs a cold or full walk, no more than 10,000 rows in the seed
lookup across every database the tab walked, and the seeds not yet released. The lane therefore
lists what the tab holds (always the rows it has open, which includes every row it just created) and
treats the database as complete only when every row has a title.

## Index build

|                                                    | Jest                                                                                                       | Node                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 10,000 rows from seeds: on subscribe (synchronous) | 9.4-11.6 ms                                                                                                | 6.8-8.2 ms                                                                              |
| then seed slices                                   | 86-91 slices, 698-742 ms in all, longest 9.2-10.4 ms                                                       | 20-22 slices, 158-174 ms in all, longest 8.5-8.9 ms                                     |
| Heap kept by the index                             | 3.0 MB                                                                                                     | 2.4-4.0 MB                                                                              |
| The next picker (titles kept with their seeds)     | 9.0-9.3 ms on subscribe, 3 slices, 21.9-22.2 ms                                                            | 6.6-8.1 ms on subscribe, 1 slice of 4.1-6.4 ms                                          |
| 10,000 live rows, all read on subscribe            | 49-53 ms                                                                                                   | not run                                                                                 |
| 500 live rows and the rest from kept titles        | not run                                                                                                    | 10.3-11.7 ms on subscribe                                                               |
| Every row kept as a decoded document instead       | 194 MB per 10,000 rows, through the shared seed documents (`peekRowDocFromSeed`'s path), measured on 2,000 | 198.2 MB, 19.4 KB a document: plain Yjs documents decoded from 10,000 seeds (the probe) |

The shared seed documents that filter and sort build would cost about 200 MB for 10,000 rows, so
the lane decodes each seed into a throwaway document and keeps only the title.

## Keystroke cost

Twenty queries (one letter to three words, CJK, digits, no match), warm caches:

|                                                    | Jest median  | Jest p95     | Node median  | Node p95     |
| -------------------------------------------------- | ------------ | ------------ | ------------ | ------------ |
| The rows lane over 10,000 titles                   | 1.35-1.54 ms | 3.45-3.67 ms | 0.77-0.84 ms | 1.81-1.97 ms |
| The same ranking without the word filter           | 2.24-2.43 ms | 3.36-3.79 ms | 1.06-1.09 ms | 1.51-1.56 ms |
| The picker's merge with 5,000 views, without rows  | 1.25-1.52 ms | 3.45-4.61 ms | 0.82-0.88 ms | 1.81-1.87 ms |
| The same with the rows lane (its ranking included) | 2.81-3.00 ms | 5.66-5.92 ms | 1.69-1.84 ms | 2.74-3.46 ms |

The picker leaves out the row the editor is in, one more pass over the titles that pass the word
filter, which the figures above do not include. Measured after the second review, in five plain-Node
runs over the same titles and queries, each query timed with and without it alternately: median
0.79-0.84 ms and p95 1.96-2.11 ms with it, 0.74-0.80 ms and 1.78-1.96 ms without. The merge's
figures were not measured again; the pass adds the same amount there.

The merge takes the rows as the picker passes them (`mentionLocalRowsForSections`). Normalizing the
10,000 titles once, when the picker opens: 5.8-6.1 ms (Jest), 4.4-4.8 ms (Node). The synthetic
titles share a twelve-word vocabulary, so a query like `road` keeps a sixth of them past the word
filter; with real, more varied titles the filter drops more. A one-letter query matches thousands of
titles either way; the ranking stops at the 60 best.

## Freshness

- Creating a row registers its live document (`registerRowSync`, the row cache) and adds it to
  `rowMap` once the server commits it, as its row order reaches the database document; the index
  reads it as a live row at once, also on a picker opened later.
- With the picker open, a row added to a 10,000-row database is listed after the transaction that
  adds its row order (one microtask): 5.3-6.1 ms in Jest and 3.7-4.6 ms in Node to read the
  membership again. Typing its title costs 0.23-0.26 ms; the row is then found by its prefix and
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
  suggested ship criterion it can be measured against holds: the index takes under 1 s of idle time
  after `seedsReady` (158-174 ms of slices in Node; Jest's 698-742 ms is a slow upper bound), keeps
  under 5 MB (2.4-4.0 MB), and a keystroke's match has a p95 under 4 ms (1.81-1.97 ms in Node,
  3.45-3.67 ms in Jest; 1.96-2.11 ms in Node with the editor's row left out).
- The server's rows request stays by default. Leaving it out
  (`localStorage.__mention_local_rows_skip_server = 'true'`) applies only while the database is
  complete, which is rare (above), is decided once per typed query, and would drop the non-title
  matches whose share is unmeasured.

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
