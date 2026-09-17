import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs/database.type';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';

import { GlobalFilterSource, GlobalFilterSourceField, usesOptionContent } from './global-filter.utils';

function getDatabase(doc: YDoc): YDatabase | undefined {
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;

  return sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
}

/**
 * The view whose column order the property lists follow: the database's
 * inline (original) view, else its oldest view. Chosen deterministically so
 * every collaborator gets the same default mapping.
 */
function getReferenceView(database: YDatabase): YDatabaseView | undefined {
  const views = database.get(YjsDatabaseKey.views);

  if (!views) return undefined;
  const entries = Array.from(views.entries()) as [string, YDatabaseView][];
  const inline = entries.find(([, view]) => Boolean(view?.get(YjsDatabaseKey.is_inline)));

  if (inline) return inline[1];
  entries.sort(([idA, viewA], [idB, viewB]) => {
    const createdA = Number(viewA?.get(YjsDatabaseKey.created_at)) || 0;
    const createdB = Number(viewB?.get(YjsDatabaseKey.created_at)) || 0;

    return createdA - createdB || idA.localeCompare(idB);
  });
  return entries[0]?.[1];
}

function toSourceField(fieldId: string, field: YDatabaseField): GlobalFilterSourceField {
  const type = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  return {
    id: fieldId,
    name: field.get(YjsDatabaseKey.name) ?? '',
    type,
    isPrimary: Boolean(field.get(YjsDatabaseKey.is_primary)),
    options: usesOptionContent(type)
      ? (parseSelectOptionTypeOptions(field)?.options ?? []).filter((option) => Boolean(option?.id))
      : [],
  };
}

/** A source database's properties: primary first, then in column order. */
export function readGlobalFilterSourceFields(doc: YDoc): GlobalFilterSourceField[] {
  const database = getDatabase(doc);
  const fields = database?.get(YjsDatabaseKey.fields);

  if (!database || !fields) return [];
  const order = getReferenceView(database)?.get(YjsDatabaseKey.field_orders)?.toArray() ?? [];
  const seen = new Set<string>();
  const result: GlobalFilterSourceField[] = [];
  const push = (fieldId: string) => {
    if (!fieldId || seen.has(fieldId)) return;
    const field = fields.get(fieldId);

    if (!field) return;
    seen.add(fieldId);
    result.push(toSourceField(fieldId, field));
  };

  order.forEach((item) => push(item?.id));
  Array.from(fields.keys()).forEach(push);

  return [...result.filter((field) => field.isPrimary), ...result.filter((field) => !field.isPrimary)];
}

/**
 * Observe what `readGlobalFilterSourceFields` reads: the fields (deep), the
 * reference view's column order, and the containers that may be replaced
 * (the database map once the doc syncs, the views map when views change).
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
    const orders = getReferenceView(database)?.get(YjsDatabaseKey.field_orders);

    fields?.observeDeep(onChange);
    views?.observe(onContainerChange);
    orders?.observe(onChange);
    detach = () => {
      fields?.unobserveDeep(onChange);
      views?.unobserve(onContainerChange);
      orders?.unobserve(onChange);
    };
  };

  function onContainerChange() {
    attach();
    onChange();
  }

  sharedRoot.observe(onContainerChange);
  attach();

  return () => {
    sharedRoot.unobserve(onContainerChange);
    detach?.();
    detach = null;
  };
}

export interface UseGlobalFilterSourcesOptions {
  /** Listed first when `databaseIds` is not given. */
  hostDatabaseId?: string;
  /** Restrict and order the sources (for example the dashboard's widget databases). */
  databaseIds?: string[];
}

/**
 * Live property lists of the source databases a dashboard's widgets expose.
 * Sources that are not mounted yet are skipped until their doc registers.
 */
export function useGlobalFilterSources(
  sourceDocs: Record<string, YDoc>,
  sourceNames: Record<string, string>,
  { hostDatabaseId, databaseIds }: UseGlobalFilterSourcesOptions = {}
): GlobalFilterSource[] {
  const { t } = useTranslation();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    const cleanups = Object.values(sourceDocs).map((doc) => observeSourceDoc(doc, bump));

    // Catch changes made between the render and this subscription.
    bump();
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [sourceDocs]);

  const orderKey = databaseIds?.join('\n');

  return useMemo(() => {
    const ids = orderKey !== undefined ? orderKey.split('\n').filter(Boolean) : Object.keys(sourceDocs);
    const ordered =
      orderKey === undefined && hostDatabaseId && ids.includes(hostDatabaseId)
        ? [hostDatabaseId, ...ids.filter((id) => id !== hostDatabaseId)]
        : ids;

    return ordered.flatMap((databaseId) => {
      const doc = sourceDocs[databaseId];

      if (!doc) return [];
      const fallbackName =
        databaseId === hostDatabaseId
          ? t('dashboard.picker.thisDatabase', { defaultValue: 'This database' })
          : t('untitled', { defaultValue: 'Untitled' });

      return [
        {
          databaseId,
          name: sourceNames[databaseId] || fallbackName,
          fields: readGlobalFilterSourceFields(doc),
        },
      ];
    });
    // `version` is the change clock of the observed docs: it re-reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceDocs, sourceNames, hostDatabaseId, orderKey, t, version]);
}
