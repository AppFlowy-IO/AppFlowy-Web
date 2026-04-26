import * as Y from 'yjs';

import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  RowId,
  YDatabase,
  YDatabaseRow,
  YDoc,
  YSharedRoot,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import type {
  PublishedDatabaseSnapshot,
  PublishedJsonObject,
  PublishedJsonValue,
} from './types';

export interface PublishedDatabaseRenderDocs {
  doc: YDoc;
  rowMap: Record<RowId, YDoc>;
}

const PUBLISHED_DATABASE_RENDER_ROW_MAP_KEY = '__appflowyPublishedDatabaseRenderRowMap';

type YDocWithPublishedDatabaseRowMap = YDoc & {
  [PUBLISHED_DATABASE_RENDER_ROW_MAP_KEY]?: Record<RowId, YDoc>;
};

function attachPublishedDatabaseRenderRowMap(doc: YDoc, rowMap: Record<RowId, YDoc>) {
  (doc as YDocWithPublishedDatabaseRowMap)[PUBLISHED_DATABASE_RENDER_ROW_MAP_KEY] = rowMap;
}

export function getPublishedDatabaseRenderRowMap(doc: YDoc | null | undefined): Record<RowId, YDoc> | undefined {
  return (doc as YDocWithPublishedDatabaseRowMap | null | undefined)?.[PUBLISHED_DATABASE_RENDER_ROW_MAP_KEY];
}

function isJsonObject(value: PublishedJsonValue | undefined): value is PublishedJsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toPlainJson(value: PublishedJsonValue): unknown {
  if (Array.isArray(value)) {
    return value.map(toPlainJson);
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toPlainJson(child)]));
  }

  return value;
}

function createYArray(
  values: PublishedJsonValue[],
  mapItem: (value: PublishedJsonValue) => unknown = toPlainJson
): Y.Array<unknown> {
  const array = new Y.Array<unknown>();

  if (values.length > 0) {
    array.push(values.map(mapItem));
  }

  return array;
}

function createYMap(
  value: PublishedJsonObject,
  mapValue: (key: string, value: PublishedJsonValue) => unknown = hydrateGenericValue
): Y.Map<unknown> {
  const map = new Y.Map<unknown>();

  Object.entries(value).forEach(([key, child]) => {
    map.set(key, mapValue(key, child));
  });

  return map;
}

function createYMapOfObjects(
  value: PublishedJsonObject,
  hydrateValue: (value: PublishedJsonObject) => Y.Map<unknown> = createYMap
): Y.Map<unknown> {
  const map = new Y.Map<unknown>();

  Object.entries(value).forEach(([key, child]) => {
    map.set(key, isJsonObject(child) ? hydrateValue(child) : toPlainJson(child));
  });

  return map;
}

function hydrateGenericValue(_key: string, value: PublishedJsonValue): unknown {
  if (Array.isArray(value)) {
    return createYArray(value);
  }

  if (isJsonObject(value)) {
    return createYMap(value);
  }

  return value;
}

function hydrateFilter(value: PublishedJsonObject): Y.Map<unknown> {
  return createYMap(value, (key, child) => {
    if (key === YjsDatabaseKey.children && Array.isArray(child)) {
      return createYArray(child, (item) => isJsonObject(item) ? hydrateFilter(item) : toPlainJson(item));
    }

    return hydrateGenericValue(key, child);
  });
}

function hydrateGroup(value: PublishedJsonObject): Y.Map<unknown> {
  return createYMap(value, (key, child) => {
    if (key === YjsDatabaseKey.groups && Array.isArray(child)) {
      return createYArray(child);
    }

    return hydrateGenericValue(key, child);
  });
}

function hydrateView(value: PublishedJsonObject): Y.Map<unknown> {
  return createYMap(value, (key, child) => {
    if ((key === YjsDatabaseKey.field_orders || key === YjsDatabaseKey.row_orders) && Array.isArray(child)) {
      return createYArray(child);
    }

    if (key === YjsDatabaseKey.groups && Array.isArray(child)) {
      return createYArray(child, (item) => isJsonObject(item) ? hydrateGroup(item) : toPlainJson(item));
    }

    if (key === YjsDatabaseKey.filters && Array.isArray(child)) {
      return createYArray(child, (item) => isJsonObject(item) ? hydrateFilter(item) : toPlainJson(item));
    }

    if ((key === YjsDatabaseKey.sorts || key === YjsDatabaseKey.calculations) && Array.isArray(child)) {
      return createYArray(child, (item) => isJsonObject(item) ? createYMap(item) : toPlainJson(item));
    }

    if ((key === YjsDatabaseKey.field_settings || key === YjsDatabaseKey.layout_settings) && isJsonObject(child)) {
      return createYMapOfObjects(child);
    }

    return hydrateGenericValue(key, child);
  });
}

function hydrateField(value: PublishedJsonObject): Y.Map<unknown> {
  return createYMap(value, (key, child) => {
    if (key === YjsDatabaseKey.type_option && isJsonObject(child)) {
      return createYMapOfObjects(child);
    }

    return hydrateGenericValue(key, child);
  });
}

function hydrateDatabase(value: PublishedJsonObject): YDatabase {
  return createYMap(value, (key, child) => {
    if (key === YjsDatabaseKey.views && isJsonObject(child)) {
      return createYMapOfObjects(child, hydrateView);
    }

    if (key === YjsDatabaseKey.fields && isJsonObject(child)) {
      return createYMapOfObjects(child, hydrateField);
    }

    if (key === YjsDatabaseKey.metas && isJsonObject(child)) {
      return createYMap(child);
    }

    return hydrateGenericValue(key, child);
  }) as YDatabase;
}

function hydrateCell(value: PublishedJsonObject): Y.Map<unknown> {
  return createYMap(value, (key, child) => {
    if (key === YjsDatabaseKey.data && Array.isArray(child)) {
      return createYArray(child);
    }

    return hydrateGenericValue(key, child);
  });
}

function hydrateDatabaseRow(value: PublishedJsonObject): YDatabaseRow {
  return createYMap(value, (key, child) => {
    if (key === YjsDatabaseKey.cells && isJsonObject(child)) {
      return createYMapOfObjects(child, hydrateCell);
    }

    return hydrateGenericValue(key, child);
  }) as YDatabaseRow;
}

function hydrateSharedRootValue(key: string, value: PublishedJsonValue): unknown {
  if (key === YjsEditorKey.database && isJsonObject(value)) {
    return hydrateDatabase(value);
  }

  if (key === YjsEditorKey.database_row && isJsonObject(value)) {
    return hydrateDatabaseRow(value);
  }

  return hydrateGenericValue(key, value);
}

function populateSharedRoot(root: YSharedRoot, value: PublishedJsonObject) {
  Object.entries(value).forEach(([key, child]) => {
    root.set(key, hydrateSharedRootValue(key, child));
  });
}

function createDatabaseDoc(snapshot: PublishedDatabaseSnapshot): YDoc {
  const doc = new Y.Doc({
    guid: snapshot.database.databaseId,
  }) as YDoc;
  const root = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = hydrateDatabase(snapshot.database.raw.database);

  doc.object_id = snapshot.database.databaseId;
  doc.view_id = snapshot.view.viewId;
  root.set(YjsEditorKey.database, database);
  return doc;
}

function createRowDoc({
  databaseId,
  rowId,
  raw,
}: {
  databaseId: string;
  rowId: RowId;
  raw: PublishedJsonObject;
}): YDoc {
  const rowKey = getRowKey(databaseId, rowId);
  const doc = new Y.Doc({
    guid: rowKey,
  }) as YDoc;
  const root = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;

  doc.object_id = rowKey;
  doc.view_id = rowId;
  populateSharedRoot(root, raw);

  return doc;
}

export function createDatabaseYjsRenderDocsFromSnapshot(snapshot: PublishedDatabaseSnapshot): PublishedDatabaseRenderDocs {
  const databaseId = snapshot.database.databaseId;
  const doc = createDatabaseDoc(snapshot);
  const rowMap = Object.fromEntries(
    Object.entries(snapshot.database.raw.rows).map(([rowId, raw]) => [
      rowId,
      createRowDoc({
        databaseId,
        rowId,
        raw,
      }),
    ])
  );

  attachPublishedDatabaseRenderRowMap(doc, rowMap);

  return {
    doc,
    rowMap,
  };
}
