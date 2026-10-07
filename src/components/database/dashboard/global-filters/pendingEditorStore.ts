import { useSyncExternalStore } from 'react';

/**
 * A request to open one global filter's pill editor on the next frame (WP08
 * §1.3): a pick in the toolbar menu closes that menu, and the new (or
 * existing) filter's pill opens its own editor with the value focused. The
 * pill whose id matches consumes the request.
 */
let pendingFilterId: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function requestGlobalFilterEditor(filterId: string) {
  pendingFilterId = filterId;
  notify();
}

/** Drop the request (the pill opened, or it went away). */
export function clearGlobalFilterEditorRequest(filterId?: string) {
  if (pendingFilterId === null || (filterId !== undefined && pendingFilterId !== filterId)) return;
  pendingFilterId = null;
  notify();
}

export function getPendingGlobalFilterEditor(): string | null {
  return pendingFilterId;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The filter id whose editor should open, or `null`. */
export function usePendingGlobalFilterEditor(): string | null {
  return useSyncExternalStore(subscribe, getPendingGlobalFilterEditor, getPendingGlobalFilterEditor);
}
