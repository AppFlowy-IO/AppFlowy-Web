# Database Row Loading and Storage (Web)

## Overview
- Database content is modeled as Yjs documents: a view document (per viewId) plus row documents (per rowId).
- View docs store row ordering and view config; row docs store the actual row cells.
- Yjs docs are persisted locally with `y-indexeddb`, while a Dexie cache stores small metadata and row versions.

## Row loading flow
1. A database view is opened via `useViewOperations.loadView` in `src/components/app/hooks/useViewOperations.ts`.
   - It calls `service.getPageDoc(...)`, which opens a Yjs doc from IndexedDB via `openCollabDB(viewId)`.
   - For database layouts, `loadView` resolves the databaseId and sets `doc.guid = databaseId` before sync.
2. `Database` in `src/components/database/Database.tsx` keeps a row doc map but does **not** open every row up front.
   - `row_orders` is still read from the view doc when rendering.
3. Row docs are opened lazily per row:
   - `useRowData(rowId)` / `useRowDataSelector(rowId)` call `ensureRowDoc(rowId)` from `DatabaseContext`.
   - `ensureRowDoc` waits for the blob diff prefetch to finish (success or failure) before binding row sync.
   - `ensureRowDoc` uses `getRowKey(doc.guid, rowId)` and `createRowDoc(rowKey)` to open the row doc and register sync as `Types.DatabaseRow`.
4. `rowDocMap` in `DatabaseContext` is incremental (only loaded rows):
   - Grid/Board/Calendar rows read `YjsDatabaseKey.cells` from row docs when available.
5. Sorting/filtering is computed in `useRowOrdersSelector` in `src/application/database-yjs/selector.ts`:
   - When row docs are incomplete, the selector returns the base `row_orders`.
   - If sorts/filters exist, it loads missing row docs from IndexedDB (no sync binding) in the background and
     re-applies conditions once all rows are available.

## Where row data comes from
- WebSocket sync: `registerSyncContext` in `src/components/ws/useSync.ts` calls `initSync` in
  `src/application/services/js-services/sync-protocol.ts`, which sends a sync request and applies updates to docs.
- Database blob diff prefetch (new):
  - `prefetchDatabaseBlobDiff` in `src/application/database-blob/index.ts` is called from
    `useViewOperations.loadView` for database layouts.
  - It calls `databaseBlobDiff` in `src/application/services/js-services/http/http_api.ts` and applies
    `CollabDocState` (`doc_state` + `encoder_version`) into IndexedDB row docs with
    `openCollabDBWithProvider` + `applyYDoc` (V1 or V2 based on encoder version).
  - Errors are logged and the UI falls back to the existing per-row sync path.
- Fetch + revalidate (mainly for publish or cache refresh):
  - `getPageCollab` in `src/application/services/js-services/http/http_api.ts` returns `encoded_collab` plus `row_data`.
  - `revalidateView` in `src/application/services/js-services/cache/index.ts` applies `row_data` via `updateRows`.
  - `getPublishView` returns `database_collab` and `database_row_collabs`, which follow the same `updateRows` path.

## Storage layers
### Yjs + IndexedDB (y-indexeddb)
- `openCollabDB` in `src/application/db/index.ts` uses `IndexeddbPersistence(name, doc)` and waits for the
  provider `synced` event before returning.
- Each collab doc is stored in its own IndexedDB database named by `name`:
  - View docs: `name = viewId`.
  - Row docs: `name = getRowKey(databaseId, rowId)` => `${databaseId}_rows_${rowId}`.
  - Workspace database doc: `name = databaseStorageId`.
- `closeCollabDB` destroys the provider, and `clearData` deletes all IndexedDB databases.

### Dexie cache
- Dexie database name: `${databasePrefix}_cache` => `af_database_cache` in `src/application/db/index.ts`.
- Tables (schemas in `src/application/db/tables/*.ts`):
  - `view_metas` (publish metadata and view relations).
  - `users` (cached user profiles).
  - `workspace_member_profiles`.
  - `rows` (row_id, row_key, version).
- `updateRows` in `src/application/services/js-services/cache/index.ts` applies row updates and
  increments the `rows.version` entry for each row.

### In-memory caches
- `rowDocs` Map in `src/application/services/js-services/cache/index.ts` avoids reopening row docs.
- `openedSet` in `src/application/db/index.ts` tracks which collab databases are open.
- LocalStorage RID cache: `af_database_blob_rid:{databaseId}` stores the last RID seen from blob diff.

## Key data structures
- View doc root: `YjsEditorKey.database` with `YjsDatabaseKey.row_orders`.
- Row doc root: `YjsEditorKey.database_row` with `YjsDatabaseKey.cells`.
- Yjs key/type definitions live in `src/application/types.ts`.

## Notes
- `getPageDoc` in `src/application/services/js-services/index.ts` uses `StrategyType.CACHE_ONLY` for app
  views, so initial data is expected to come from IndexedDB or the sync protocol rather than an immediate fetch.
- Database row docs are keyed by `databaseId`, so multiple view tabs that share the same database reuse
  the same row documents.

## Desktop blob/diff row loading (reference)
This section summarizes how the desktop client (Rust) avoids per-row sync by using the
database blob diff API. Source of truth: `AppFlowy-Premium/frontend/rust-lib/flowy-database2`.

### Diff-based row loader
- Row loader is selected in `database_row_loader.rs`; `DatabaseBlobRowLoader` is currently enabled.
- `DatabaseBlobRowLoader` requests `database_blob_diff(database_id, max_known_rid)` via
  `DatabaseCollabServiceImpl::database_blob_diff` in `collab_service.rs`.
- `max_known_rid` is stored per database in sqlite table `db_database_blob_rid_cache`
  (`database_blob_rid_cache.rs`).
- A shared in-memory `BlobDiffCache` stores empty diffs for 30s to avoid repeated
  "no changes" calls per RID.

### Applying the diff
- The diff contains row updates with `encoded_collab_v1` plus optional row document updates.
- `DatabaseBlobRowLoader::prepare_diff` decodes rows and tracks missing/decode failures.
- `collab_service.merge_blob_rows(...)` merges the diff into local collab storage:
  - It loads any local collab first, applies the server snapshot update on top
    (preserving offline edits), and writes back to the KV store.
  - Row document updates are persisted; delete markers from blob diffs are ignored
    to avoid dropping offline edits.
- After merge, the loader builds row snapshots by opening `DatabaseRow` from the
  merged `EncodedCollab`.

### Missing rows and fallbacks
- If the diff is empty and a RID is known, the loader reads missing rows from
  local cache first; missing rows can fall back to collab loading.
- If the diff is partial, it still reads local cache for remaining rows before
  falling back to collab.
- If the diff request fails or returns non-ready status, the loader falls back
  immediately to the collab row loader.
- When `auto_fetch=false`, the loader only reads local cache and skips remote
  fallback.

### Background prefetch (desktop)
- `DatabaseEditor::maybe_spawn_prefetch_missing_row_collabs` chooses:
  - Blob loader prefetch (auto-fetch diff + merge) when blob backend is active.
  - Missing-only collab prefetch otherwise (`prefetch_missing_row_collabs` in
    `collab_service.rs`) which fetches and persists missing encoded collabs
    without binding rows.

### Desktop storage model
- Row collabs are persisted in the local KV store (`CollabKVDB`).
- The blob diff RID watermark persists in sqlite `db_database_blob_rid_cache`.
- Derived view caches and calculations are stored in sqlite (see
  `database_rows_init.md` for the cache tables and backfill behavior).

### Key desktop files
- `AppFlowy-Premium/frontend/rust-lib/flowy-database2/src/services/database/database_blob_row_loader.rs`
- `AppFlowy-Premium/frontend/rust-lib/flowy-database2/src/services/database/database_row_loader.rs`
- `AppFlowy-Premium/frontend/rust-lib/flowy-database2/src/services/database/database_blob_rid_cache.rs`
- `AppFlowy-Premium/frontend/rust-lib/flowy-database2/src/collab_service.rs`
- `AppFlowy-Premium/frontend/rust-lib/flowy-database2/database_rows_init.md`

## Related files
- `src/components/app/hooks/useViewOperations.ts`
- `src/components/database/Database.tsx`
- `src/application/database-blob/index.ts`
- `src/application/database-yjs/row_meta.ts`
- `src/application/database-yjs/context.ts`
- `src/application/database-yjs/selector.ts`
- `src/application/db/index.ts`
- `src/application/db/tables/rows.ts`
- `src/application/services/js-services/cache/index.ts`
- `src/application/services/js-services/http/http_api.ts`
- `src/application/services/js-services/sync-protocol.ts`
