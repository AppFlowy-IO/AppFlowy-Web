import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { useDatabase } from '@/application/database-yjs/context';

import {
  DatabaseRowTemplateStore,
  getDatabaseRowTemplateSnapshot,
  readDatabaseRowTemplateState,
  subscribeDatabaseRowTemplates,
} from './store';

export function useDatabaseRowTemplates() {
  const database = useDatabase();
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeDatabaseRowTemplates(database, onStoreChange),
    [database]
  );
  const getSnapshot = useCallback(() => getDatabaseRowTemplateSnapshot(database), [database]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const state = useMemo(() => readDatabaseRowTemplateState(database, snapshot), [database, snapshot]);
  const store = useMemo(() => new DatabaseRowTemplateStore(database), [database]);

  return useMemo(() => ({ ...state, store }), [state, store]);
}
