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
import { hasCollabCache } from '@/application/services/js-services/cache';
import { fetchPageCollab } from '@/application/services/js-services/fetch';
import { Types, ViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
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

  // Step 2: Check cache
  const fromCache = hasCollabCache(doc);

  Log.debug('[ViewLoader] cache check', {
    viewId,
    fromCache,
    durationMs: Date.now() - startedAt,
  });

  // Step 3: Fetch from server if not cached
  if (!fromCache) {
    await fetchAndApply(workspaceId, viewId, doc);
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
