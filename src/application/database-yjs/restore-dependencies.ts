import { useSyncExternalStore } from 'react';

import { invalidateRelationCacheAfterRestore } from './relation/cache';
import { invalidateRollupCacheAfterRestore } from './rollup/cache';

const listeners = new Set<() => void>();
let revision = 0;

/** A restored related database replaces documents instead of mutating their Yjs maps. */
export function invalidateDatabaseDependenciesAfterRestore() {
  invalidateRelationCacheAfterRestore();
  invalidateRollupCacheAfterRestore();
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function getDatabaseDependencyRestoreRevision() {
  return revision;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const subscribeNone = () => () => undefined;
const initialRevision = () => 0;

/** Rebind live related-document observers after the restored documents are ready. */
export function useDatabaseDependencyRestoreRevision(enabled = true) {
  return useSyncExternalStore(
    enabled ? subscribe : subscribeNone,
    enabled ? getDatabaseDependencyRestoreRevision : initialRevision,
    initialRevision
  );
}
