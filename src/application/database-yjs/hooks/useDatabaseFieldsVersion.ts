import { useSyncExternalStore } from 'react';

import { useDatabaseFields } from '@/application/database-yjs/context';
import type { YDatabaseFields } from '@/application/types';

type FieldsVersionStore = {
  getSnapshot: () => number;
  subscribe: (onStoreChange: () => void) => () => void;
};

const EMPTY_STORE: FieldsVersionStore = {
  getSnapshot: () => 0,
  subscribe: () => () => undefined,
};

const stores = new WeakMap<YDatabaseFields, FieldsVersionStore>();

function createFieldsVersionStore(fields: YDatabaseFields): FieldsVersionStore {
  const subscribers = new Set<() => void>();
  let version = 0;
  let observing = false;

  const publish = () => {
    version += 1;
    subscribers.forEach((subscriber) => subscriber());
  };

  return {
    getSnapshot: () => version,
    subscribe: (onStoreChange) => {
      subscribers.add(onStoreChange);
      if (!observing) {
        observing = true;
        fields.observeDeep(publish);
        // Close the render-to-subscribe gap and force the first subscriber to
        // reread the identity-stable Y.Map after the observer is attached.
        version += 1;
      }

      return () => {
        subscribers.delete(onStoreChange);
        if (subscribers.size === 0 && observing) {
          observing = false;
          fields.unobserveDeep(publish);
        }
      };
    },
  };
}

function getFieldsVersionStore(fields: YDatabaseFields | undefined): FieldsVersionStore {
  if (!fields) return EMPTY_STORE;
  let store = stores.get(fields);

  if (!store) {
    store = createFieldsVersionStore(fields);
    stores.set(fields, store);
  }

  return store;
}

/**
 * Returns a monotonically increasing version number that bumps every time
 * the database's `fields` map mutates (add, remove, rename, type change).
 *
 * The Y.Map returned by `useDatabaseFields` is identity-stable across
 * mutations, so memos keyed on `fields` alone never re-run. Include the
 * value of this hook in the dep array to opt in to invalidation.
 */
export function useDatabaseFieldsVersion(): number {
  const fields = useDatabaseFields();
  const store = getFieldsVersionStore(fields);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
