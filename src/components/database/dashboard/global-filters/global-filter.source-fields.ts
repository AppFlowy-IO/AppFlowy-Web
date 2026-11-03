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
  let oldest: { id: string; view: YDatabaseView; createdAt: number } | undefined;

  for (const [id, view] of views.entries() as IterableIterator<[string, YDatabaseView]>) {
    if (!view) continue;
    if (view.get(YjsDatabaseKey.is_inline)) return view;
    const createdAt = Number(view.get(YjsDatabaseKey.created_at)) || 0;

    if (!oldest || createdAt < oldest.createdAt || (createdAt === oldest.createdAt && id.localeCompare(oldest.id) < 0)) {
      oldest = { id, view, createdAt };
    }
  }

  return oldest?.view;
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
  const primary: GlobalFilterSourceField[] = [];
  const others: GlobalFilterSourceField[] = [];
  const push = (fieldId: string) => {
    if (!fieldId || seen.has(fieldId)) return;
    const field = fields.get(fieldId);

    if (!field) return;
    seen.add(fieldId);
    const sourceField = toSourceField(fieldId, field);

    (sourceField.isPrimary ? primary : others).push(sourceField);
  };

  order.forEach((item) => push(item?.id));
  Array.from(fields.keys()).forEach(push);

  return primary.concat(others);
}
