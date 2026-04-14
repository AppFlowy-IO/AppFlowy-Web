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

import { openCollabDB } from '@/application/db';
import { getOrCreateRowSubDoc, hasCollabCache } from '@/application/services/js-services/cache';
import { fetchPageCollab } from '@/application/services/js-services/fetch';
import { Types, ViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';
import { Log } from '@/utils/log';
import * as Y from 'yjs';

// ============================================================================
// Types
// ============================================================================

export interface ViewLoaderResult {
  doc: YDoc;
  fromCache: boolean;
  collabType: Types;
}

// ============================================================================
// Layout to CollabType Mapping
// ============================================================================

const LAYOUT_COLLAB_TYPE_MAP: Partial<Record<ViewLayout, Types>> = {
  [ViewLayout.Document]: Types.Document,
  [ViewLayout.Grid]: Types.Database,
  [ViewLayout.Board]: Types.Database,
  [ViewLayout.Calendar]: Types.Database,
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
async function fetchAndApply(workspaceId: string, viewId: string, doc: YDoc): Promise<void> {
  Log.debug('[ViewLoader] fetching from server', { viewId });

  const fetchStartedAt = Date.now();
  const { data, rows } = await fetchPageCollab(workspaceId, viewId);

  Log.debug('[ViewLoader] fetch complete', {
    viewId,
    dataBytes: data.length,
    rowCount: rows ? Object.keys(rows).length : 0,
    fetchDurationMs: Date.now() - fetchStartedAt,
  });

  applyYDoc(doc, data);
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
  layout?: ViewLayout
): Promise<ViewLoaderResult> {
  const startedAt = Date.now();

  Log.debug('[ViewLoader] openView start', { workspaceId, viewId, layout });

  // Step 1: Open from IndexedDB
  const doc = await openCollabDB(viewId);

  // Step 2: Check cache — also detect empty-shell documents that were cached
  // during a previous load when the server hadn't finished duplication yet.
  let fromCache = hasCollabCache(doc);

  if (fromCache) {
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
        fromCache = false;
      }
    }
  }

  Log.debug('[ViewLoader] cache check', {
    viewId,
    fromCache,
    durationMs: Date.now() - startedAt,
  });

  // Step 3: Fetch from server if not cached (or cache was an empty shell).
  // Retry with backoff — after page duplication the server worker may need
  // a moment to persist all row documents.
  if (!fromCache) {
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await fetchAndApply(workspaceId, viewId, doc);
        break;
      } catch (e) {
        if (attempt === MAX_RETRIES) throw e;
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
 */
export async function openRowSubDocument(
  workspaceId: string,
  documentId: string
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
    const MAX_RETRIES = 6;
    let fetched = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await fetchAndApply(workspaceId, documentId, doc);
        fetched = true;
        break;
      } catch (e) {
        Log.debug('[ViewLoader] rowSubDoc fetch failed', {
          documentId,
          attempt,
          maxRetries: MAX_RETRIES,
          error: e instanceof Error ? e.message : String(e),
        });

        if (attempt < MAX_RETRIES) {
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
