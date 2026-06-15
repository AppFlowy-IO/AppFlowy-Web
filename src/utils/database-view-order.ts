const DATABASE_VIEW_ORDER_STORAGE_KEY_PREFIX = 'database_view_order:';

function getDatabaseViewOrderStorageKey(databaseId: string) {
  return `${DATABASE_VIEW_ORDER_STORAGE_KEY_PREFIX}${databaseId}`;
}

export function reconcileOrderedViewIds(previousViewIds: string[], incomingViewIds: string[]): string[] {
  if (previousViewIds.length === 0) {
    return incomingViewIds;
  }

  const incomingViewIdSet = new Set(incomingViewIds);
  const previousViewIdSet = new Set(previousViewIds);

  const retainedViewIds = previousViewIds.filter((viewId) => incomingViewIdSet.has(viewId));
  const appendedViewIds = incomingViewIds.filter((viewId) => !previousViewIdSet.has(viewId));

  return [...retainedViewIds, ...appendedViewIds];
}

export function selectHydratingViewOrder(params: {
  incomingViewIds: string[];
  previousViewIds: string[];
  storedViewIds?: string[];
  isNewDatabase: boolean;
}): string[] | undefined {
  const { incomingViewIds, previousViewIds, storedViewIds, isNewDatabase } = params;

  if (incomingViewIds.length > 0) {
    return undefined;
  }

  if (storedViewIds && storedViewIds.length > 0) {
    return storedViewIds;
  }

  if (!isNewDatabase && previousViewIds.length > 0) {
    return previousViewIds;
  }

  return undefined;
}

export function insertViewIdAfter(viewIds: string[], anchorViewId: string, newViewId: string): string[] {
  const dedupedViewIds = viewIds.filter((viewId) => viewId !== newViewId);
  const anchorIndex = dedupedViewIds.indexOf(anchorViewId);

  if (anchorIndex === -1) {
    return [...dedupedViewIds, newViewId];
  }

  return [
    ...dedupedViewIds.slice(0, anchorIndex + 1),
    newViewId,
    ...dedupedViewIds.slice(anchorIndex + 1),
  ];
}

export function appendViewId(viewIds: string[], newViewId: string): string[] {
  const dedupedViewIds = viewIds.filter((viewId) => viewId !== newViewId);

  return [...dedupedViewIds, newViewId];
}

export function selectStableViewOrder(params: {
  previousViewIds: string[];
  storedViewIds?: string[];
  fallbackViewIds: string[];
  pendingViewId: string;
}): string[] {
  const { previousViewIds, storedViewIds, fallbackViewIds, pendingViewId } = params;

  const isCollapsedOrder = (viewIds?: string[]) =>
    Boolean(viewIds && viewIds.length === 1 && viewIds[0] === pendingViewId && fallbackViewIds.length > 1);

  if (previousViewIds.length > 0 && !isCollapsedOrder(previousViewIds)) {
    return previousViewIds;
  }

  if (storedViewIds && storedViewIds.length > 0 && !isCollapsedOrder(storedViewIds)) {
    return storedViewIds;
  }

  return fallbackViewIds;
}

export function readStoredViewOrder(databaseId?: string): string[] | undefined {
  if (!databaseId || typeof window === 'undefined') {
    return undefined;
  }

  try {
    const rawValue = window.localStorage.getItem(getDatabaseViewOrderStorageKey(databaseId));

    if (!rawValue) {
      return undefined;
    }

    const parsedValue = JSON.parse(rawValue);

    if (!Array.isArray(parsedValue) || parsedValue.some((value) => typeof value !== 'string')) {
      return undefined;
    }

    return parsedValue;
  } catch {
    return undefined;
  }
}

export function writeStoredViewOrder(databaseId: string | undefined, viewIds: string[]) {
  if (!databaseId || typeof window === 'undefined') {
    return;
  }

  try {
    const dedupedViewIds = Array.from(new Set(viewIds));

    window.localStorage.setItem(getDatabaseViewOrderStorageKey(databaseId), JSON.stringify(dedupedViewIds));
  } catch {
    // Ignore storage failures (private mode/quota).
  }
}
