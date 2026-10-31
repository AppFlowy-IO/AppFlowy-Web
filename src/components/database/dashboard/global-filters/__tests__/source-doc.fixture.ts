import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOption, SelectOptionColor } from '@/application/database-yjs/fields/select-option/select_option.type';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { GlobalFilterSource, GlobalFilterSourceField } from '../global-filter.utils';

export interface FixtureField {
  id: string;
  name: string;
  type: FieldType;
  isPrimary?: boolean;
  options?: SelectOption[];
}

export function option(id: string, name: string): SelectOption {
  return { id, name, color: SelectOptionColor.OptionColor1 };
}

export function sourceField(field: FixtureField): GlobalFilterSourceField {
  return {
    id: field.id,
    name: field.name,
    type: field.type,
    isPrimary: Boolean(field.isPrimary),
    options: field.options ?? [],
  };
}

export function source(databaseId: string, name: string, fields: FixtureField[]): GlobalFilterSource {
  return { databaseId, name, fields: fields.map(sourceField) };
}

function createField(field: FixtureField) {
  const map = new Y.Map<unknown>();
  const typeOptions = new Y.Map<unknown>();

  map.set(YjsDatabaseKey.id, field.id);
  map.set(YjsDatabaseKey.name, field.name);
  map.set(YjsDatabaseKey.type, field.type);
  map.set(YjsDatabaseKey.is_primary, Boolean(field.isPrimary));
  if (field.options) {
    const typeOption = new Y.Map<unknown>();

    typeOption.set(YjsDatabaseKey.content, JSON.stringify({ disable_color: false, options: field.options }));
    typeOptions.set(String(field.type), typeOption);
  }

  map.set(YjsDatabaseKey.type_option, typeOptions);
  return map;
}

/**
 * A database doc with `fields` and one inline view whose column order is
 * `order` (defaults to the field list order).
 */
export function createSourceDoc(databaseId: string, fields: FixtureField[], order?: string[]): YDoc {
  const doc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map<unknown>();
  const fieldMap = new Y.Map<unknown>();
  const views = new Y.Map<unknown>();
  const view = new Y.Map<unknown>();
  const fieldOrders = new Y.Array<{ id: string }>();

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fieldMap);
  database.set(YjsDatabaseKey.views, views);
  fields.forEach((field) => fieldMap.set(field.id, createField(field)));
  views.set(`${databaseId}-view`, view);
  view.set(YjsDatabaseKey.is_inline, true);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  fieldOrders.push((order ?? fields.map((field) => field.id)).map((id) => ({ id })));

  return doc;
}

export function addField(doc: YDoc, field: FixtureField) {
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
  const fields = database.get(YjsDatabaseKey.fields) as Y.Map<unknown>;
  const views = database.get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;

  doc.transact(() => {
    fields.set(field.id, createField(field));
    views.forEach((view) => (view.get(YjsDatabaseKey.field_orders) as Y.Array<{ id: string }>).push([{ id: field.id }]));
  });
}

export function setFieldOptions(doc: YDoc, fieldId: string, type: FieldType, options: SelectOption[]) {
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
  const field = (database.get(YjsDatabaseKey.fields) as Y.Map<Y.Map<unknown>>).get(fieldId);
  const typeOption = (field?.get(YjsDatabaseKey.type_option) as Y.Map<Y.Map<unknown>> | undefined)?.get(String(type));

  typeOption?.set(YjsDatabaseKey.content, JSON.stringify({ disable_color: false, options }));
}
