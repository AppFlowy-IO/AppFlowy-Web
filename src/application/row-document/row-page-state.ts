/**
 * Bridge between the row-page surface (rendered inside the database context)
 * and app-level chrome like the header favorite button (rendered outside it).
 *
 * The full-page row header publishes the active row page's identity here;
 * the app header consumes it to target favorite actions at the row document
 * instead of the containing database.
 */

import { useSyncExternalStore } from 'react';

import { RowDocumentSourcePayload } from '@/application/types';

export interface ActiveRowPageInfo {
  rowId: string;
  documentId: string;
  title: string;
  source: RowDocumentSourcePayload | null;
  /** True when the row's document has content (meta is_document_empty === false). */
  hasDocument: boolean;
}

let activeRowPage: ActiveRowPageInfo | null = null;
const listeners = new Set<() => void>();

export function setActiveRowPage(info: ActiveRowPageInfo | null) {
  activeRowPage = info;
  listeners.forEach((listener) => listener());
}

export function getActiveRowPage(): ActiveRowPageInfo | null {
  return activeRowPage;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActiveRowPage(): ActiveRowPageInfo | null {
  return useSyncExternalStore(subscribe, getActiveRowPage);
}
