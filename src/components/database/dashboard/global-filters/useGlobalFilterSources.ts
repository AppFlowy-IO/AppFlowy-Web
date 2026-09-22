import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { YMapEvent } from 'yjs';

import { SelectOption } from '@/application/database-yjs/fields/select-option/select_option.type';
import { YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

import { getDatabase, getReferenceView, readGlobalFilterSourceFields } from './global-filter.source-fields';
import { GlobalFilterSource, GlobalFilterSourceField } from './global-filter.utils';

export { readGlobalFilterSourceFields };

/** View keys that decide which view is the reference and which array holds its column order. */
const REFERENCE_VIEW_KEYS: readonly string[] = [
  YjsDatabaseKey.field_orders,
  YjsDatabaseKey.is_inline,
  YjsDatabaseKey.created_at,
];

/**
 * Observe what `readGlobalFilterSourceFields` reads: the fields (deep), the
 * reference view's column order, and the containers that may be replaced
 * (the database map once the doc syncs, the views map when views change,
 * a view's own keys when its column-order array is swapped or another view
 * becomes the reference).
 */
function observeSourceDoc(doc: YDoc, onChange: () => void) {
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  let detach: (() => void) | null = null;

  const attach = () => {
    detach?.();
    detach = null;
    const database = getDatabase(doc);

    if (!database) return;
    const fields = database.get(YjsDatabaseKey.fields);
    const views = database.get(YjsDatabaseKey.views);
    const viewMaps = views ? (Array.from(views.values()) as YDatabaseView[]).filter(Boolean) : [];
    const orders = getReferenceView(database)?.get(YjsDatabaseKey.field_orders);

    fields?.observeDeep(onChange);
    views?.observe(onContainerChange);
    viewMaps.forEach((view) => view.observe(onViewChange));
    orders?.observe(onChange);
    detach = () => {
      fields?.unobserveDeep(onChange);
      views?.unobserve(onContainerChange);
      viewMaps.forEach((view) => view.unobserve(onViewChange));
      orders?.unobserve(onChange);
    };
  };

  function onContainerChange() {
    attach();
    onChange();
  }

  function onViewChange(event: YMapEvent<unknown>) {
    if (REFERENCE_VIEW_KEYS.some((key) => event.keysChanged.has(key))) onContainerChange();
  }

  sharedRoot.observe(onContainerChange);
  attach();

  return () => {
    sharedRoot.unobserve(onContainerChange);
    detach?.();
    detach = null;
  };
}

function sameOptions(a: SelectOption[], b: SelectOption[]) {
  return (
    a.length === b.length &&
    a.every((option, index) => {
      const other = b[index];

      return option.id === other.id && option.name === other.name && option.color === other.color;
    })
  );
}

function sameSourceFields(a: GlobalFilterSourceField[], b: GlobalFilterSourceField[]) {
  return (
    a.length === b.length &&
    a.every((field, index) => {
      const other = b[index];

      return (
        field.id === other.id &&
        field.name === other.name &&
        field.type === other.type &&
        field.isPrimary === other.isPrimary &&
        sameOptions(field.options, other.options)
      );
    })
  );
}

interface SourceDocStore {
  /** Last property list read; replaced only by a list that differs. */
  fields: GlobalFilterSourceField[] | null;
  /** Whether the doc may have changed since `fields` was read. */
  stale: boolean;
  listeners: Set<() => void>;
  /** Removes the Yjs observers; `null` while nobody listens. */
  detach: (() => void) | null;
  detachScheduled: boolean;
}

/**
 * One store per source doc, shared by every component that lists its
 * properties (the filter bar, an open filter menu, ...): a single set of Yjs
 * observers per doc, and a property list that keeps its identity until the
 * doc's properties really change.
 */
const sourceDocStores = new WeakMap<YDoc, SourceDocStore>();

function getSourceDocStore(doc: YDoc): SourceDocStore {
  let store = sourceDocStores.get(doc);

  if (!store) {
    store = { fields: null, stale: true, listeners: new Set(), detach: null, detachScheduled: false };
    sourceDocStores.set(doc, store);
  }

  return store;
}

function subscribeSourceDoc(doc: YDoc, listener: () => void) {
  const store = getSourceDocStore(doc);

  store.listeners.add(listener);
  if (!store.detach) {
    // Changes made while nobody observed the doc were missed: re-read (and
    // compare) on the next snapshot.
    store.stale = true;
    store.detach = observeSourceDoc(doc, () => {
      store.stale = true;
      Array.from(store.listeners).forEach((notify) => notify());
    });
  }

  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size > 0 || store.detachScheduled) return;
    // React re-subscribes in the same commit when the listed docs change, so
    // detaching waits a microtask and is skipped if someone listens again.
    store.detachScheduled = true;
    void Promise.resolve().then(() => {
      store.detachScheduled = false;
      if (store.listeners.size > 0 || !store.detach) return;
      store.detach();
      store.detach = null;
      store.stale = true;
    });
  };
}

/** The doc's properties; the same array until they change. */
function getSourceDocFields(doc: YDoc): GlobalFilterSourceField[] {
  const store = getSourceDocStore(doc);

  if (store.fields && !store.stale) return store.fields;
  const next = readGlobalFilterSourceFields(doc);

  if (!store.fields || !sameSourceFields(store.fields, next)) store.fields = next;
  // Only an observed doc can trust its cached list.
  store.stale = store.detach === null;
  return store.fields;
}

export interface UseGlobalFilterSourcesOptions {
  /** Listed first when `databaseIds` is not given. */
  hostDatabaseId?: string;
  /** Restrict and order the sources (for example the dashboard's widget databases). */
  databaseIds?: string[];
}

const NO_FIELD_LISTS: GlobalFilterSourceField[][] = [];

interface SourceEntry {
  databaseId: string;
  doc: YDoc;
}

const NO_ENTRIES: SourceEntry[] = [];
const NO_SOURCES: GlobalFilterSource[] = [];

function sameEntries(a: SourceEntry[], b: SourceEntry[]) {
  return (
    a.length === b.length &&
    a.every((entry, index) => entry.databaseId === b[index].databaseId && entry.doc === b[index].doc)
  );
}

function sameSources(a: GlobalFilterSource[], b: GlobalFilterSource[]) {
  return (
    a.length === b.length &&
    a.every(
      (source, index) =>
        source.databaseId === b[index].databaseId && source.name === b[index].name && source.fields === b[index].fields
    )
  );
}

/**
 * Live property lists of the source databases a dashboard's widgets expose.
 * Sources that are not mounted yet are skipped until their doc registers.
 * Only the listed docs are observed, and a change in one doc re-reads only
 * that doc.
 */
export function useGlobalFilterSources(
  sourceDocs: Record<string, YDoc>,
  sourceNames: Record<string, string>,
  { hostDatabaseId, databaseIds }: UseGlobalFilterSourcesOptions = {}
): GlobalFilterSource[] {
  const { t } = useTranslation();
  const orderKey = databaseIds?.join('\n');

  // The listed, mounted sources in display order. Registering a source that is
  // not listed (or re-registering the same doc) keeps the previous list, so
  // the subscription and every consumer stay put.
  const entriesRef = useRef(NO_ENTRIES);
  const entries = useMemo(() => {
    const ids = orderKey !== undefined ? orderKey.split('\n').filter(Boolean) : Object.keys(sourceDocs);
    const ordered =
      orderKey === undefined && hostDatabaseId && ids.includes(hostDatabaseId)
        ? [hostDatabaseId, ...ids.filter((id) => id !== hostDatabaseId)]
        : ids;
    const next = ordered.flatMap((databaseId) => {
      const doc = sourceDocs[databaseId];

      return doc ? [{ databaseId, doc }] : [];
    });

    return sameEntries(next, entriesRef.current) ? entriesRef.current : next;
  }, [sourceDocs, hostDatabaseId, orderKey]);

  entriesRef.current = entries;

  const subscribe = useCallback(
    (notify: () => void) => {
      const unsubscribes = entries.map(({ doc }) => subscribeSourceDoc(doc, notify));

      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
    [entries]
  );

  // The per-doc lists, as one snapshot that keeps its identity while every list does.
  const fieldListsRef = useRef(NO_FIELD_LISTS);
  const getSnapshot = useCallback(() => {
    const lists = entries.map(({ doc }) => getSourceDocFields(doc));
    const previous = fieldListsRef.current;

    if (lists.length === previous.length && lists.every((list, index) => list === previous[index])) return previous;
    fieldListsRef.current = lists;
    return lists;
  }, [entries]);

  const fieldLists = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Kept while every source keeps its name and property list (a name
  // registered for another database changes nothing here).
  const sourcesRef = useRef(NO_SOURCES);
  const sources = useMemo(() => {
    const next = entries.map(({ databaseId }, index) => {
      const fallbackName =
        databaseId === hostDatabaseId
          ? t('dashboard.picker.thisDatabase', { defaultValue: 'This database' })
          : t('untitled', { defaultValue: 'Untitled' });

      return {
        databaseId,
        name: sourceNames[databaseId] || fallbackName,
        fields: fieldLists[index],
      };
    });

    return sameSources(next, sourcesRef.current) ? sourcesRef.current : next;
  }, [entries, fieldLists, hostDatabaseId, sourceNames, t]);

  sourcesRef.current = sources;
  return sources;
}
