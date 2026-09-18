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

import { GlobalFilterSourceField, usesOptionContent } from './global-filter.utils';

// Pure readers, kept apart from `useGlobalFilterSources` (the per-doc observer
// store): `DashboardProvider` needs only these, and every database view loads it.

export function getDatabase(doc: YDoc): YDatabase | undefined {
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;

  return sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
}

/**
 * The view whose column order the property lists follow: the database's
 * inline (original) view, else its oldest view. Chosen deterministically so
 * every collaborator gets the same default mapping.
 */
export function getReferenceView(database: YDatabase): YDatabaseView | undefined {
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
