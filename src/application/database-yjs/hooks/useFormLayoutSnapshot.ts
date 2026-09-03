import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { useDatabaseView } from '@/application/database-yjs/context';
import { decodeSnapshot, readFormLayoutSnapshot } from '@/application/database-yjs/form-questions';
import type { FormLayoutSnapshot, FormQuestionEntry } from '@/application/database-yjs/form-questions';
import type { YDatabaseView } from '@/application/types';

const EMPTY: FormLayoutSnapshot = Object.freeze({
  decided: false,
  fieldOrderIds: null,
  explicitlyExcludedFieldIds: [],
  description: '',
  respondentTitle: '',
  questions: [],
});

type FormLayoutStore = {
  getSnapshot: () => FormLayoutSnapshot;
  subscribe: (onStoreChange: () => void) => () => void;
};

function questionsEqual(a: FormQuestionEntry, b: FormQuestionEntry): boolean {
  return (
    a.fieldId === b.fieldId &&
    a.included === b.included &&
    a.required === b.required &&
    a.descriptionVisible === b.descriptionVisible &&
    a.description === b.description &&
    a.longAnswer === b.longAnswer &&
    a.order === b.order
  );
}

function snapshotsEqual(a: FormLayoutSnapshot, b: FormLayoutSnapshot): boolean {
  if (a === b) return true;
  if (a.decided !== b.decided) return false;
  if (a.fieldOrderIds === null || b.fieldOrderIds === null) {
    if (a.fieldOrderIds !== b.fieldOrderIds) return false;
  } else {
    if (a.fieldOrderIds.length !== b.fieldOrderIds.length) return false;
    for (let i = 0; i < a.fieldOrderIds.length; i += 1) {
      if (a.fieldOrderIds[i] !== b.fieldOrderIds[i]) return false;
    }
  }

  if (a.explicitlyExcludedFieldIds.length !== b.explicitlyExcludedFieldIds.length) return false;
  for (let i = 0; i < a.explicitlyExcludedFieldIds.length; i += 1) {
    if (a.explicitlyExcludedFieldIds[i] !== b.explicitlyExcludedFieldIds[i]) return false;
  }

  if (a.description !== b.description) return false;
  if (a.respondentTitle !== b.respondentTitle) return false;
  if (a.questions.length !== b.questions.length) return false;
  for (let i = 0; i < a.questions.length; i += 1) {
    if (!questionsEqual(a.questions[i], b.questions[i])) return false;
  }

  return true;
}

const EMPTY_STORE: FormLayoutStore = {
  getSnapshot: () => EMPTY,
  subscribe: () => () => undefined,
};

// One store per Yjs view means every hook consumer shares one deep observer and
// one decoded snapshot. The WeakMap does not retain views after their database
// document is released.
const stores = new WeakMap<YDatabaseView, FormLayoutStore>();

function createFormLayoutStore(view: YDatabaseView): FormLayoutStore {
  const subscribers = new Set<() => void>();
  let snapshot = readFormLayoutSnapshot(view);
  let observing = false;

  const refresh = (): boolean => {
    const next = readFormLayoutSnapshot(view);

    if (snapshotsEqual(snapshot, next)) return false;
    snapshot = next;
    return true;
  };

  const publish = () => {
    if (!refresh()) return;
    subscribers.forEach((subscriber) => subscriber());
  };

  const attach = () => {
    if (observing) return;
    observing = true;
    view.observeDeep(publish);

    // Close the render-to-subscribe gap. If the view changed after React read
    // getSnapshot but before the subscription was installed, publish the fresh
    // snapshot immediately.
    if (refresh()) {
      subscribers.forEach((subscriber) => subscriber());
    }
  };

  const detach = () => {
    if (!observing) return;
    observing = false;
    view.unobserveDeep(publish);
  };

  return {
    getSnapshot: () => {
      // React can abandon a render before subscribe() runs. Refresh every
      // unobserved read so a cached store from that render cannot go stale.
      if (!observing) {
        refresh();
      }

      return snapshot;
    },
    subscribe: (onStoreChange) => {
      subscribers.add(onStoreChange);
      if (subscribers.size === 1) attach();

      return () => {
        subscribers.delete(onStoreChange);
        if (subscribers.size === 0) detach();
      };
    },
  };
}

function getFormLayoutStore(view: YDatabaseView | undefined): FormLayoutStore {
  if (!view) return EMPTY_STORE;
  let store = stores.get(view);

  if (!store) {
    store = createFormLayoutStore(view);
    stores.set(view, store);
  }

  return store;
}

/**
 * Subscribe to the current database view's `form_field_settings` map and
 * surface a typed snapshot. Re-emits on any deep mutation (entry add /
 * remove / value patch) so the form-builder UI re-renders without
 * polling.
 *
 * Returns the frozen empty snapshot when:
 *   - no view is in context (caller mounted outside the database scope)
 *   - the view exists but isn't a Form layout (no `form_field_settings` key)
 *
 * The hook re-subscribes when the underlying view reference changes —
 * e.g. user switches database tabs — so a stale observer can't fire
 * against a different view's data.
 */
export function useFormLayoutSnapshot(): FormLayoutSnapshot {
  const view = useDatabaseView();
  const store = getFormLayoutStore(view);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/// Variant that takes an explicit view rather than reading the current
/// one from context — used by the preview overlay, which renders against
/// a draft `FormLayoutSnapshot` that's *already* in memory and doesn't
/// need a fresh subscription. Kept here so the import surface for form
/// authoring lives in one module.
export function asSnapshot(map: Y.Map<unknown> | undefined): FormLayoutSnapshot {
  if (!map) return EMPTY;
  return decodeSnapshot(map as never);
}
