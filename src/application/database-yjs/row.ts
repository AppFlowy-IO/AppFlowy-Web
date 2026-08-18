import dayjs from 'dayjs';
import * as Y from 'yjs';

import { YDatabaseCells, YDatabaseRow, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import { AttributionUid, initializeRowAttribution } from '@/application/database-yjs/attribution';

export function initialDatabaseRow (rowId: string, databaseId: string, rowDoc: YDoc, actorUid?: AttributionUid) {
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
  initializeRowAttribution(row, actorUid);
  row.set(YjsDatabaseKey.cells, cells);

  rowSharedRoot.set(YjsEditorKey.meta, meta);
  rowSharedRoot.set(YjsEditorKey.database_row, row);
}

export function getOptionsFromRow (rowDoc: YDoc, fieldId: string) {
  const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const row = rowSharedRoot.get(YjsEditorKey.database_row);
  const options: string[] = [];

  if (!row) return options;

  const cells = row.get(YjsDatabaseKey.cells);
  const cell = cells.get(fieldId);

  if (!cell) return options;

  const data = cell.get(YjsDatabaseKey.data);

  if (data && typeof data === 'string') {
    const dataArray = data.split(',');

    dataArray.forEach(item => {
      const option = item.trim();

      if (option) {
        options.push(option);
      }
    });
  }

  return options;
}
