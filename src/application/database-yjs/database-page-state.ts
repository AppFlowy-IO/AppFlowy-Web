import { useSyncExternalStore } from 'react';

interface DatabasePageSelection {
  workspaceId: string;
  databasePageId: string;
  tabViewId: string | null;
  activeViewId: string;
}

let activeSelection: DatabasePageSelection | null = null;
const listeners = new Set<() => void>();

/** Share the routed database's resolved selection with chrome outside its context. */
export function publishDatabasePageSelection(selection: DatabasePageSelection): () => void {
  activeSelection = selection;
  listeners.forEach((listener) => listener());
  return () => {
    // A departing page must not clear a newer page's selection.
    if (activeSelection !== selection) return;
    activeSelection = null;
    listeners.forEach((listener) => listener());
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot() {
  return activeSelection;
}

export function useDatabasePageSelection(
  workspaceId: string | undefined,
  databasePageId: string | undefined,
  tabViewId: string | null
): string | undefined {
  const selection = useSyncExternalStore(subscribe, getSnapshot);

  // Ignore the previous page/workspace or a selection awaiting a query update.
  return selection?.workspaceId === workspaceId && selection?.databasePageId === databasePageId &&
    selection?.tabViewId === tabViewId ? selection.activeViewId : undefined;
}
