import { YDatabaseCells, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import dayjs from 'dayjs';
import * as Y from 'yjs';

export function initialDatabaseRow (rowId: string, databaseId: string, rowDoc: YDoc) {
  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const row = new Y.Map() as YDatabaseRow;
  const meta = new Y.Map();

  const cells = new Y.Map() as YDatabaseCells;

  row.set(YjsDatabaseKey.id, rowId);
  row.set(YjsDatabaseKey.database_id, databaseId);
  row.set(YjsDatabaseKey.visibility, true);
  row.set(YjsDatabaseKey.height, 36);
  row.set(YjsDatabaseKey.created_at, String(dayjs().unix()));
  row.set(YjsDatabaseKey.last_modified, String(dayjs().unix()));
  row.set(YjsDatabaseKey.cells, cells);

  rowSharedRoot.set(YjsEditorKey.meta, meta);
  rowSharedRoot.set(YjsEditorKey.database_row, row);
}