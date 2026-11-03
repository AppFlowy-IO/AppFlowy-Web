import { useCallback, useRef } from 'react';

import { YDoc } from '@/application/types';

interface RegistryEntry {
  count: number;
  doc: YDoc;
}

/**
 * Reference-count the source docs widgets expose to the dashboard. Several
 * widgets can show the same database; its doc is registered on the first
 * acquire and unregistered only when the last widget releases it. The host
 * database is registered by `DashboardProvider` itself and never touched.
 */
export function useSourceDocRegistry(
  registerSourceDoc: (databaseId: string, doc: YDoc | null) => void,
  hostDatabaseId: string
) {
  const entriesRef = useRef(new Map<string, RegistryEntry>());

  return useCallback(
    (databaseId: string, doc: YDoc) => {
      if (!databaseId || databaseId === hostDatabaseId) return () => undefined;
      const entries = entriesRef.current;
      const entry = entries.get(databaseId);

      if (entry) {
        entry.count += 1;

        if (entry.doc !== doc) {
          entry.doc = doc;
          registerSourceDoc(databaseId, doc);
        }
      } else {
        entries.set(databaseId, { count: 1, doc });
        registerSourceDoc(databaseId, doc);
      }

      let released = false;

      return () => {
        if (released) return;
        released = true;
        const current = entries.get(databaseId);

        if (!current) return;
        current.count -= 1;

        if (current.count <= 0) {
          entries.delete(databaseId);
          registerSourceDoc(databaseId, null);
        }
      };
    },
    [hostDatabaseId, registerSourceDoc]
  );
}
