import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { useDatabase } from '@/application/database-yjs/context';

import {
  DatabaseRowTemplateStore,
  getDatabaseRowTemplateSnapshot,
  readDatabaseRowTemplateState,
  subscribeDatabaseRowTemplates,
} from './store';

const DISABLED_TEMPLATE_SNAPSHOT = '["","",[]]';

export function useDatabaseRowTemplates(enabled = true) {
  const database = useDatabase();
  const subscribe = useCallback(
    (onStoreChange: () => void) => (enabled ? subscribeDatabaseRowTemplates(database, onStoreChange) : () => undefined),
    [database, enabled]
  );
  const getSnapshot = useCallback(
    () => (enabled ? getDatabaseRowTemplateSnapshot(database) : DISABLED_TEMPLATE_SNAPSHOT),
    [database, enabled]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const state = useMemo(
    () => readDatabaseRowTemplateState(enabled ? database : undefined, snapshot),
    [database, enabled, snapshot]
  );
  const store = useMemo(() => new DatabaseRowTemplateStore(database), [database]);

  return useMemo(() => ({ ...state, store }), [state, store]);
}
