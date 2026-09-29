/**
 * View Loader Abstraction Layer
 *
 * This module separates "opening a document" from "binding sync":
 * 1. openView() - Loads document from cache or fetches from server (NO sync)
 * 2. Component renders with stable data
 * 3. bindSync() is called separately after render (in useViewOperations)
 *
 * This eliminates race conditions where WebSocket sync messages arrive
 * before the component finishes rendering.
 */

import * as Y from 'yjs';

import {
  captureDatabaseStorageFence,
  deleteCollabDB,
  getCachedProviderDoc,
  openCollabDB,
  openCollabDBWithProvider,
} from '@/application/db';
import { isDatabaseStorageFenceCurrent, withDatabaseStorageFence } from '@/application/db/database-storage-fence';
import { getOrCreateRowSubDoc, hasCollabCache } from '@/application/services/js-services/cache';
import { invalidateViewCache } from '@/application/services/js-services/cached-api';
import { fetchDatabaseCollab, fetchPageCollab, fetchRowDocumentCollab } from '@/application/services/js-services/fetch';
import { enqueueOutboxUpdate } from '@/application/sync-outbox';
import {
  LoadRowDocumentOptions,
  Types,
  ViewLayout,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { determineErrorType, ErrorType, isPermissionDeniedError } from '@/application/utils/error-utils';
import { isDatabaseLayout } from '@/application/view-utils';
import { applyYDoc } from '@/application/ydoc/apply';
import { Log } from '@/utils/log';

// ============================================================================
// Types
// ============================================================================

export interface ViewLoaderResult {
  doc: YDoc;
  fromCache: boolean;
  collabType: Types;
}

export interface OpenViewOptions {
  databaseId?: string | null;
  databaseMetadataOnly?: boolean;
  forceFetch?: boolean;
}

const DEFAULT_ROW_DOCUMENT_MAX_ATTEMPTS = 6;

/**
 * Server loads in flight per canonical database. Views of one database opened
 * together (dashboard widgets, linked-database blocks) share one Y.Doc, and
 * each download carries the whole database: later views wait for the running
 * request instead of fetching the same collab again.
 */
const inflightDatabaseFetches = new Map<string, Promise<void>>();

// ============================================================================
// Layout to CollabType Mapping
// ============================================================================

const LAYOUT_COLLAB_TYPE_MAP: Partial<Record<ViewLayout, Types>> = {
  [ViewLayout.Document]: Types.Document,
  [ViewLayout.Grid]: Types.Database,
  [ViewLayout.Board]: Types.Database,
  [ViewLayout.Calendar]: Types.Database,
  [ViewLayout.Chart]: Types.Database,
  [ViewLayout.List]: Types.Database,
  [ViewLayout.Gallery]: Types.Database,
  [ViewLayout.Feed]: Types.Database,
  [ViewLayout.Form]: Types.Database,
  [ViewLayout.Timeline]: Types.Database,
  [ViewLayout.Dashboard]: Types.Database,
};

const DOC_KEY_COLLAB_TYPE_MAP: Record<string, Types> = {
  [YjsEditorKey.database]: Types.Database,
  [YjsEditorKey.document]: Types.Document,
};

// ============================================================================
// Type Detection
// ============================================================================

/**
 * Detect collab type from view layout using map lookup
 */
function detectFromLayout(layout?: ViewLayout): Types | null {
  if (layout === undefined) return null;
  return LAYOUT_COLLAB_TYPE_MAP[layout] ?? null;
}

/**
 * Detect collab type from Y.js document structure using map lookup
 */
function detectFromDocStructure(doc: YDoc): Types | null {
  try {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined;

    if (!sharedRoot) return null;

    for (const [key, type] of Object.entries(DOC_KEY_COLLAB_TYPE_MAP)) {
      if (sharedRoot.has(key)) {
        return type;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect collab type using chained strategies with fallback
 */
function detectCollabType(doc: YDoc, layout?: ViewLayout): Types {
  return detectFromLayout(layout) ?? detectFromDocStructure(doc) ?? Types.Document;
}

function databaseDocContainsView(doc: YDoc, viewId: string): boolean | null {
  try {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined;
    const database = sharedRoot?.get(YjsEditorKey.database);
    const views = database?.get(YjsDatabaseKey.views);

    if (!views) return null;

    return views.has(viewId);
  } catch {
    return null;
  }
}

function databaseDocHasCompleteMetadata(doc: YDoc, viewId: string): boolean {
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined;
  const database = sharedRoot?.get(YjsEditorKey.database);

  if (!(database instanceof Y.Map)) return false;

  const fields = database.get(YjsDatabaseKey.fields);
  const views = database.get(YjsDatabaseKey.views);

  if (!(fields instanceof Y.Map) || !(views instanceof Y.Map) || !views.has(viewId)) return false;

  return Array.from(fields.values()).some(
    (field) => field instanceof Y.Map && Boolean(field.get(YjsDatabaseKey.is_primary))
  );
}

async function mergeLegacyDatabaseViewCache(viewId: string, databaseId: string, targetDoc: YDoc): Promise<boolean> {
  if (viewId === databaseId) {
    return false;
  }

  const storageFence = await captureDatabaseStorageFence(databaseId);

  // View-keyed caches predate restore generations, just like legacy row caches.
  // They must never contribute bytes to an authoritative restored root.
  if (storageFence.epoch !== null || typeof storageFence.cacheEpoch === 'string' ||
      !isDatabaseStorageFenceCurrent(storageFence) ||
      (targetDoc.databaseRestoreId && targetDoc.databaseRestoreId !== '00000000-0000-0000-0000-000000000000')) return false;
  const { doc: legacyDoc, provider } = await openCollabDBWithProvider(viewId, { skipCache: true });

  try {
    if (!isDatabaseStorageFenceCurrent(storageFence)) return false;
    if (!hasCollabCache(legacyDoc)) {
      return false;
    }

    const legacyDatabaseId = getDatabaseIdFromDoc(legacyDoc);

    if (legacyDatabaseId && legacyDatabaseId !== databaseId) {
      Log.warn('[ViewLoader] skipped legacy database cache merge due to databaseId mismatch', {
        viewId,
        databaseId,
        legacyDatabaseId,
      });
      return false;
    }

    const missingUpdate = Y.encodeStateAsUpdate(legacyDoc, Y.encodeStateVector(targetDoc));

    // Yjs encodes an empty v1 update as two bytes. Nothing to merge.
    if (missingUpdate.byteLength <= 2) {
      return false;
    }

    withDatabaseStorageFence(targetDoc, storageFence, () => applyYDoc(targetDoc, missingUpdate));
    void enqueueOutboxUpdate({
      objectId: databaseId,
      collabType: Types.Database,
      version: targetDoc.version ?? null,
      payload: missingUpdate,
    });

    Log.debug('[ViewLoader] merged legacy database view cache into canonical database cache', {
      viewId,
      databaseId,
      updateBytes: missingUpdate.byteLength,
    });

    return true;
  } finally {
    await provider.destroy();
    legacyDoc.destroy();
  }
}

/** The database whose canonical Y.Doc holds this view, if it is a database view. */
function getCanonicalDatabaseId(layout: ViewLayout | undefined, options: OpenViewOptions): string | undefined {
  return layout === undefined || isDatabaseLayout(layout) ? options.databaseId ?? undefined : undefined;
}

async function openCollabDocForView(viewId: string, layout?: ViewLayout, options: OpenViewOptions = {}): Promise<YDoc> {
  const databaseId = getCanonicalDatabaseId(layout, options);

  if (!databaseId) {
    return openCollabDB(viewId);
  }

  const { doc } = await openCollabDBWithProvider(databaseId, { awaitSync: true });

  try {
    await mergeLegacyDatabaseViewCache(viewId, databaseId, doc);
  } catch (error) {
    Log.warn('[ViewLoader] failed to merge legacy database view cache', {
      viewId,
      databaseId,
      error,
    });
  }

  return doc;
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Check if a view has cached data in IndexedDB
 */
export async function hasCache(viewId: string): Promise<boolean> {
  try {
    const doc = await openCollabDB(viewId);

    return hasCollabCache(doc);
  } catch {
    return false;
  }
}

// ============================================================================
// Load Operations
// ============================================================================

/**
 * Fetch and apply document data from server
 */
async function fetchAndApply(
  workspaceId: string,
  viewId: string,
  doc: YDoc,
  options: OpenViewOptions = {}
): Promise<void> {
  Log.debug('[ViewLoader] fetching from server', { viewId });

  const fetchStartedAt = Date.now();
  let data: Uint8Array;
  let rowCount = 0;

  if (options.databaseMetadataOnly && options.databaseId) {
    ({ data } = await fetchDatabaseCollab(workspaceId, options.databaseId));
  } else {
    const pageCollab = await fetchPageCollab(workspaceId, viewId);

    data = pageCollab.data;
    rowCount = pageCollab.rows ? Object.keys(pageCollab.rows).length : 0;
  }

  Log.debug('[ViewLoader] fetch complete', {
    viewId,
    dataBytes: data.length,
    rowCount,
    databaseMetadataOnly: options.databaseMetadataOnly ?? false,
    fetchDurationMs: Date.now() - fetchStartedAt,
  });

  applyYDoc(doc, data);
}

async function fetchRowDocumentAndApply(
  workspaceId: string,
  documentId: string,
  doc: YDoc,
  options: LoadRowDocumentOptions
): Promise<void> {
  Log.debug('[ViewLoader] fetching row document from server', { documentId });

  const fetchStartedAt = Date.now();
  // Row documents inherit access from their parent database. Pass that
  // context so authorization does not depend on a direct document ACL.
  const { data } = await fetchRowDocumentCollab(workspaceId, documentId, options.rowDocumentSource);

  Log.debug('[ViewLoader] row document fetch complete', {
    documentId,
    dataBytes: data.length,
    fetchDurationMs: Date.now() - fetchStartedAt,
  });

  applyYDoc(doc, data);
}

/**
 * Whether the local doc already serves this view without a server fetch.
 */
function canUseLocalDoc(doc: YDoc, viewId: string, options: OpenViewOptions): boolean {
  if (options.forceFetch || !hasCollabCache(doc)) return false;

  // Detect empty-shell documents that were cached during a previous load when
  // the server hadn't finished duplication yet.
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined;
  const document = sharedRoot?.get(YjsEditorKey.document) as Y.Map<unknown> | undefined;
  const blocks = document?.get(YjsEditorKey.blocks) as Y.Map<unknown> | undefined;
  const blockCount = blocks?.size ?? 0;

  // If the cached document is an empty shell (≤2 blocks = page + empty paragraph),
  // treat it as uncached so we re-fetch from the server.
  if (document && blockCount <= 2) {
    const meta = document.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;
    const textMap = meta?.get(YjsEditorKey.text_map) as Y.Map<Y.Text> | undefined;
    const hasTextContent = textMap
      ? Array.from(textMap.values()).some((v) => {
          if (v instanceof Y.Text) return v.toJSON().length > 0;
          if (typeof v === 'string') return v.length > 0;
          return false;
        })
      : false;

    if (!hasTextContent) {
      Log.debug('[ViewLoader] cached document is empty shell, re-fetching', { viewId, blockCount });
      return false;
    }
  }

  // A database root alone is enough for the generic cache detector, but not
  // enough to render relation labels or populate the relation picker. These
  // metadata-only consumers do not bind database realtime, so force the raw
  // canonical fetch when fields/views have only been partially cached.
  if (options.databaseMetadataOnly && !databaseDocHasCompleteMetadata(doc, viewId)) {
    Log.debug('[ViewLoader] cached database metadata is incomplete, re-fetching', {
      viewId,
      databaseId: options.databaseId,
    });
    return false;
  }

  if (options.databaseId && viewId !== options.databaseId && databaseDocContainsView(doc, viewId) === false) {
    Log.debug('[ViewLoader] cached database is missing linked view, re-fetching', {
      viewId,
      databaseId: options.databaseId,
    });
    return false;
  }

  return true;
}

/**
 * One server fetch. A permission denial is permanent for this load: every
 * local copy keyed to it is evicted before the error propagates, since a cached
 * collab (or the positive view-meta cache) would otherwise pin the failure and
 * suppress the refetch after the server grants access.
 */
async function fetchAndApplyOrEvict(
  workspaceId: string,
  viewId: string,
  doc: YDoc,
  options: OpenViewOptions
): Promise<void> {
  try {
    await fetchAndApply(workspaceId, viewId, doc, options);
  } catch (e) {
    if (determineErrorType(e).type === ErrorType.Forbidden) {
      const docKey = options.databaseId ?? viewId;

      Log.debug('[ViewLoader] permission denial — evicting local caches', {
        viewId,
        docKey,
      });
      invalidateViewCache(workspaceId, viewId);
      await deleteCollabDB(docKey, { destroyDoc: true }).catch(() => undefined);
    }

    throw e;
  }
}

/**
 * Fetch and apply with backoff — after page duplication the server worker may
 * need a moment to persist all row documents. `firstAttempt` is a request for
 * this view already running, awaited in place of the loop's own first one.
 */
async function fetchAndApplyWithRetry(
  workspaceId: string,
  viewId: string,
  doc: YDoc,
  options: OpenViewOptions,
  firstAttempt?: Promise<void>
): Promise<void> {
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await (attempt === 1 && firstAttempt ? firstAttempt : fetchAndApplyOrEvict(workspaceId, viewId, doc, options));
      return;
    } catch (e) {
      // Retrying cannot repair a permission denial. (404s must keep retrying:
      // they cover the post-duplication race.)
      if (determineErrorType(e).type === ErrorType.Forbidden || attempt === MAX_RETRIES) throw e;
      Log.debug('[ViewLoader] openView fetch retry', {
        viewId,
        attempt,
        maxRetries: MAX_RETRIES,
        error: e instanceof Error ? e.message : String(e),
      });
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/**
 * Fetch a view the local doc cannot serve, and resolve to the doc it loaded
 * into. A database view first waits for a request for its database already in
 * flight, and fetches its own only if that snapshot still lacks it (a newer
 * view, or a failed request).
 *
 * Access is per database on this client, not per view: the server hands the
 * whole database collab, every view included, to whoever may open one of its
 * views, and a cached database serves its other views without asking again.
 * So a view that a sibling's download holds opens even when its own request
 * would have been refused; only a view that fetches for itself can come back
 * as no access.
 */
async function fetchViewFromServer(
  workspaceId: string,
  viewId: string,
  doc: YDoc,
  layout: ViewLayout | undefined,
  options: OpenViewOptions
): Promise<YDoc> {
  const databaseId = getCanonicalDatabaseId(layout, options);
  // A forced load must reflect the server as of its own call: it neither waits
  // for an earlier download nor stands in for later ones.
  const key =
    databaseId && !options.forceFetch
      ? `${workspaceId}:${databaseId}:${options.databaseMetadataOnly ? 'metadata' : 'page'}`
      : null;
  const inflight = key ? inflightDatabaseFetches.get(key) : undefined;
  let target = doc;

  if (inflight && databaseId) {
    // Its own caller reports a failure; this view then fetches for itself.
    await inflight.catch(() => undefined);
    // A refused request evicted the doc it loaded into: continue in a fresh one.
    if (getCachedProviderDoc(databaseId) !== target) target = await openCollabDocForView(viewId, layout, options);

    if (canUseLocalDoc(target, viewId, options)) {
      Log.debug('[ViewLoader] view served by an in-flight database fetch', { viewId, databaseId });
      return target;
    }
  }

  if (!key) {
    await fetchAndApplyWithRetry(workspaceId, viewId, target, options);
    return target;
  }

  // Only the request is shared: a view waiting on it never sits out this
  // view's retries (a deleted view's 404, a 5xx), it fetches for itself.
  const firstAttempt = fetchAndApplyOrEvict(workspaceId, viewId, target, options);

  inflightDatabaseFetches.set(key, firstAttempt);
  void firstAttempt
    .catch(() => undefined)
    .finally(() => {
      if (inflightDatabaseFetches.get(key) === firstAttempt) inflightDatabaseFetches.delete(key);
    });
  await fetchAndApplyWithRetry(workspaceId, viewId, target, options, firstAttempt);
  return target;
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Open a view document. Does NOT start sync.
 *
 * Flow:
 * 1. Open Y.Doc from IndexedDB (instant)
 * 2. Check cache - if available, use it
 * 3. If no cache, fetch from server
 * 4. Detect collab type
 * 5. Return doc ready for rendering
 *
 * @param workspaceId - The workspace ID
 * @param viewId - The view ID to load
 * @param layout - Optional view layout for type detection
 */
export async function openView(
  workspaceId: string,
  viewId: string,
  layout?: ViewLayout,
  options: OpenViewOptions = {}
): Promise<ViewLoaderResult> {
  const startedAt = Date.now();

  Log.debug('[ViewLoader] openView start', { workspaceId, viewId, layout, databaseId: options.databaseId });

  // Step 1: Open from IndexedDB
  let doc = await openCollabDocForView(viewId, layout, options);

  // Step 2: Check cache
  const fromCache = canUseLocalDoc(doc, viewId, options);

  Log.debug('[ViewLoader] cache check', {
    viewId,
    fromCache,
    forceFetch: options.forceFetch ?? false,
    durationMs: Date.now() - startedAt,
  });

  // Step 3: Fetch from server if not cached (or cache was an empty shell).
  if (!fromCache) {
    doc = await fetchViewFromServer(workspaceId, viewId, doc, layout, options);
  }

  // Step 4: Detect collab type
  const collabType = detectCollabType(doc, layout);

  Log.debug('[ViewLoader] openView complete', {
    viewId,
    fromCache,
    collabType,
    totalDurationMs: Date.now() - startedAt,
  });

  return { doc, fromCache, collabType };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get database ID from a Y.Doc
 */
export function getDatabaseIdFromDoc(doc: YDoc): string | null {
  try {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined;
    const database = sharedRoot?.get(YjsEditorKey.database);

    return database?.get(YjsDatabaseKey.id) ?? null;
  } catch {
    return null;
  }
}

// ============================================================================
// Row Sub-Document (cached)
// ============================================================================

/**
 * Open a row sub-document (the document content inside a database row).
 *
 * This uses a cache to ensure the same Y.Doc instance is reused when
 * reopening the same card. This is critical for:
 * 1. Preserving sync state between opens
 * 2. Preventing content loss when server updates are applied
 * 3. Following the same pattern as the desktop application
 *
 * @param workspaceId - The workspace ID
 * @param documentId - The row sub-document ID
 * @param options - Controls the bounded server fetch attempts
 */
export async function openRowSubDocument(
  workspaceId: string,
  documentId: string,
  options: LoadRowDocumentOptions = {}
): Promise<ViewLoaderResult> {
  const startedAt = Date.now();

  Log.debug('[ViewLoader] openRowSubDocument start', { workspaceId, documentId });

  // Use cached doc to preserve sync state across reopens
  const doc = await getOrCreateRowSubDoc(documentId);

  // Check cache — but also verify the cached doc has real content.
  // During row duplication the local doc may be created as an empty shell
  // (by openLocalDocument → initializeDocumentStructure). In that case
  // we must fetch from the server to get the worker-created content.
  let fromCache = hasCollabCache(doc);

  if (fromCache) {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined;
    const document = sharedRoot?.get(YjsEditorKey.document) as Y.Map<unknown> | undefined;
    const blocks = document?.get(YjsEditorKey.blocks) as Y.Map<unknown> | undefined;
    const blockCount = blocks?.size ?? 0;

    // initializeDocumentStructure creates exactly 2 blocks (page + empty paragraph).
    // Treat the cache as an empty shell only when block count is minimal AND
    // there is no real text content — this avoids re-fetching valid docs that
    // happen to have just one paragraph of text.
    if (blockCount <= 2) {
      const meta = document?.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;
      const textMap = meta?.get(YjsEditorKey.text_map) as Y.Map<Y.Text> | undefined;
      const hasTextContent = textMap
        ? Array.from(textMap.values()).some((v) => {
            if (v instanceof Y.Text) return v.toJSON().length > 0;
            if (typeof v === 'string') return v.length > 0;
            return false;
          })
        : false;

      if (!hasTextContent) {
        Log.debug('[ViewLoader] rowSubDoc cache is empty shell, will fetch from server', {
          documentId,
          blockCount,
        });
        fromCache = false;
      }
    }
  }

  Log.debug('[ViewLoader] rowSubDoc cache check', {
    documentId,
    fromCache,
    durationMs: Date.now() - startedAt,
  });

  // Fetch from server if not cached or cache is empty.
  // Retry with backoff — the server-side worker may need a moment to create
  // the document after a row duplication.
  if (!fromCache) {
    const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_ROW_DOCUMENT_MAX_ATTEMPTS));
    let fetched = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await fetchRowDocumentAndApply(workspaceId, documentId, doc, options);
        fetched = true;
        break;
      } catch (e) {
        // A permission denial cannot be repaired by retrying or by creating the
        // row document. Remove the authoritative local copy before propagating
        // the original error so the UI can render a terminal no-access state.
        if (isPermissionDeniedError(e)) {
          Log.debug('[ViewLoader] rowSubDoc permission denial — evicting local cache', {
            documentId,
          });
          await deleteCollabDB(documentId, { destroyDoc: true }).catch(() => undefined);
          throw e;
        }

        Log.debug('[ViewLoader] rowSubDoc fetch failed', {
          documentId,
          attempt,
          maxAttempts,
          error: e instanceof Error ? e.message : String(e),
        });

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    if (!fetched) {
      Log.warn('[ViewLoader] rowSubDoc fetch exhausted retries, using local doc', { documentId });
    }
  }

  Log.debug('[ViewLoader] openRowSubDocument complete', {
    documentId,
    fromCache,
    totalDurationMs: Date.now() - startedAt,
  });

  return { doc, fromCache, collabType: Types.Document };
}
