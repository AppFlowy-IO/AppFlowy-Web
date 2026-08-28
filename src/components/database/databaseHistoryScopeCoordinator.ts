import { useCallback, useId, useSyncExternalStore } from 'react';

import { useDatabaseRowHistoryHotkeys } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';

type HistoryScopeListener = () => void;

export const DATABASE_HISTORY_SCOPE_ATTRIBUTE = 'data-database-history-scope';

const HISTORY_SCOPE_SELECTOR = `[${DATABASE_HISTORY_SCOPE_ATTRIBUTE}]`;
const listenersByScope = new Map<string, Set<HistoryScopeListener>>();
const getInactiveServerSnapshot = () => false;

let activeHistoryScopeId: string | undefined;
let listeningDocument: Document | null = null;
let subscriberCount = 0;

function notifyScope(scopeId: string | undefined) {
  if (!scopeId) return;

  listenersByScope.get(scopeId)?.forEach((listener) => listener());
}

function setActiveHistoryScope(scopeId: string | undefined) {
  if (activeHistoryScopeId === scopeId) return;

  const previousScopeId = activeHistoryScopeId;

  activeHistoryScopeId = scopeId;
  notifyScope(previousScopeId);
  notifyScope(scopeId);
}

function getEventHistoryScopeId(target: EventTarget | null): string | undefined {
  const targetElement = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;

  return targetElement?.closest(HISTORY_SCOPE_SELECTOR)?.getAttribute(DATABASE_HISTORY_SCOPE_ATTRIBUTE) || undefined;
}

function handleDocumentPointerDown(event: PointerEvent) {
  setActiveHistoryScope(getEventHistoryScopeId(event.target));
}

function startListening() {
  if (typeof document === 'undefined' || listeningDocument === document) return;

  listeningDocument = document;
  listeningDocument.addEventListener('pointerdown', handleDocumentPointerDown, true);
}

function stopListening() {
  if (!listeningDocument) return;

  listeningDocument.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  listeningDocument = null;
}

function subscribeToHistoryScope(scopeId: string, listener: HistoryScopeListener) {
  const scopeListeners = listenersByScope.get(scopeId) ?? new Set<HistoryScopeListener>();

  if (!listenersByScope.has(scopeId)) listenersByScope.set(scopeId, scopeListeners);
  scopeListeners.add(listener);
  subscriberCount += 1;

  if (subscriberCount === 1) startListening();

  return () => {
    if (!scopeListeners.delete(listener)) return;

    subscriberCount -= 1;

    if (scopeListeners.size === 0) {
      listenersByScope.delete(scopeId);

      if (activeHistoryScopeId === scopeId) setActiveHistoryScope(undefined);
    }

    if (subscriberCount === 0) {
      stopListening();
      activeHistoryScopeId = undefined;
    }
  };
}

export function useIsDatabaseHistoryScopeActive(scopeId: string) {
  const subscribe = useCallback(
    (listener: HistoryScopeListener) => subscribeToHistoryScope(scopeId, listener),
    [scopeId]
  );
  const getSnapshot = useCallback(() => activeHistoryScopeId === scopeId, [scopeId]);

  return useSyncExternalStore(subscribe, getSnapshot, getInactiveServerSnapshot);
}

/**
 * Registers one database layout with the shared undo/redo ownership coordinator.
 * Attach `data-database-history-scope={historyScopeId}` to the layout root and
 * to any portaled editor owned by that layout.
 */
export function useDatabaseHistoryScope({ enabled = true }: { enabled?: boolean } = {}) {
  const historyScopeId = useId();
  const isHistoryScopeActive = useIsDatabaseHistoryScopeActive(historyScopeId);
  const activateHistoryScope = useCallback(() => {
    setActiveHistoryScope(historyScopeId);
  }, [historyScopeId]);
  const clearHistoryScope = useCallback(() => {
    if (activeHistoryScopeId === historyScopeId) setActiveHistoryScope(undefined);
  }, [historyScopeId]);

  useDatabaseRowHistoryHotkeys(undefined, {
    enabled: enabled && isHistoryScopeActive,
    ignoreInput: true,
    useLatest: true,
  });

  return {
    activateHistoryScope,
    clearHistoryScope,
    historyScopeId,
    isHistoryScopeActive,
  };
}
