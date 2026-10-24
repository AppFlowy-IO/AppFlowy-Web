/**
 * The "Open pages in" view preference (WP13 §3.8): how a database view opens
 * its records. Stored as `views[view_id].open_pages_in` in the database
 * collab; absent or unknown reads as absent and is never rewritten. Desktop
 * has the same rules in `open_pages_in.dart`, both pinned by
 * `dashboard-parity/drill-queries.json#open_pages_in`.
 */
import { YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

export const OPEN_PAGES_IN_KEY = YjsDatabaseKey.open_pages_in;

export type OpenPagesIn = 'side_peek' | 'center_peek' | 'full_page';

export const OPEN_PAGES_IN_VALUES: readonly OpenPagesIn[] = ['side_peek', 'center_peek', 'full_page'];

/** Where a record is opened from: a dashboard widget, a chart drill-down, or a view of its own. */
export type OpenRecordSource = 'dashboard_widget' | 'drilldown' | 'view';

/** A known stored value, or `null` (absent, empty, unknown or not a string). */
export function parseOpenPagesIn(raw: unknown): OpenPagesIn | null {
  return typeof raw === 'string' && (OPEN_PAGES_IN_VALUES as readonly string[]).includes(raw)
    ? (raw as OpenPagesIn)
    : null;
}

/**
 * A known stored value wins; otherwise records opened from a dashboard widget
 * or a drill-down open in a side peek, and records of a view in a center peek.
 * A mobile context opens records full screen before this resolver runs.
 */
export function resolveOpenPagesIn(raw: unknown, source: OpenRecordSource): OpenPagesIn {
  return parseOpenPagesIn(raw) ?? (source === 'view' ? 'center_peek' : 'side_peek');
}

/** The stored value of a view, read at call time (`undefined` when absent). */
export function readViewOpenPagesIn(doc: YDoc | null | undefined, viewId: string | null | undefined): unknown {
  if (!doc || !viewId) return undefined;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;

  return database?.get(YjsDatabaseKey.views)?.get(viewId)?.get(OPEN_PAGES_IN_KEY);
}

/**
 * How a record opens, before any UI: the read-only row page of a published
 * (or read-only standalone) database, a local peek for a locked document's
 * embed, full screen in a mobile context, else the resolved "Open pages in"
 * value. `readonly_page` and `mobile_page` leave the current page like
 * `full_page` does.
 */
export type RecordOpening = 'readonly_page' | 'mobile_page' | OpenPagesIn;

export function resolveRecordOpening({
  readOnly,
  isDocumentBlock,
  publish,
  mobile,
  raw,
  source,
}: {
  readOnly: boolean;
  isDocumentBlock: boolean;
  publish: boolean;
  mobile: boolean;
  raw: unknown;
  source: OpenRecordSource;
}): RecordOpening {
  // A locked document's embedded database keeps its records in place, so the
  // row editor inherits the document's read-only permission; published
  // databases use the route-based row page.
  if (readOnly && (!isDocumentBlock || publish)) return 'readonly_page';
  if (readOnly && isDocumentBlock) {
    const opening = resolveOpenPagesIn(raw, source);

    return opening === 'full_page' ? 'center_peek' : opening;
  }

  if (mobile) return 'mobile_page';
  return resolveOpenPagesIn(raw, source);
}

/** Whether a record opening leaves the current page (the drill-down closes first). */
export function leavesPage(opening: RecordOpening): boolean {
  return opening === 'readonly_page' || opening === 'mobile_page' || opening === 'full_page';
}
