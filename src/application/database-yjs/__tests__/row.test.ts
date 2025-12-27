import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { initialDatabaseRow, getOptionsFromRow } from '@/application/database-yjs/row';
import { generateRowMeta, getMetaIdMap } from '@/application/database-yjs/row_meta';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { YDatabaseCell, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

function createCell(data: string) {
  const cell = new Y.Map() as YDatabaseCell;
  cell.set(YjsDatabaseKey.data, data);
  return cell;
}

describe('row operation tests', () => {
  it('creates a new row', () => {
    const rowDoc = new Y.Doc() as YDoc;
    initialDatabaseRow('row-1', 'db-1', rowDoc);

    const sharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    const row = sharedRoot.get(YjsEditorKey.database_row) as Y.Map<unknown>;

    expect(row.get(YjsDatabaseKey.id)).toBe('row-1');
    expect(row.get(YjsDatabaseKey.database_id)).toBe('db-1');
    expect(row.get(YjsDatabaseKey.visibility)).toBe(true);
    expect(row.get(YjsDatabaseKey.height)).toBe(36);
  });

  it('sets created_at and last_modified when row is created', () => {
    const rowDoc = new Y.Doc() as YDoc;
    initialDatabaseRow('row-2', 'db-1', rowDoc);

    const sharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    const row = sharedRoot.get(YjsEditorKey.database_row) as Y.Map<unknown>;
    const createdAt = Number(row.get(YjsDatabaseKey.created_at));
    const lastModified = Number(row.get(YjsDatabaseKey.last_modified));

    expect(Number.isNaN(createdAt)).toBe(false);
    expect(Number.isNaN(lastModified)).toBe(false);
    expect(lastModified).toBeGreaterThanOrEqual(createdAt);
  });

  it('creates row with initial cell values', () => {
    const rowDoc = new Y.Doc() as YDoc;
    initialDatabaseRow('row-3', 'db-1', rowDoc);

    const sharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    const row = sharedRoot.get(YjsEditorKey.database_row) as Y.Map<unknown>;
    const cells = row.get(YjsDatabaseKey.cells) as Y.Map<unknown>;

    cells.set('field-1', createCell('opt-a,opt-b'));
    expect(getOptionsFromRow(rowDoc, 'field-1')).toEqual(['opt-a', 'opt-b']);
  });
});

describe('row metadata tests', () => {
  it('generates row meta keys for icon and cover', () => {
    const rowId = 'row-meta-1';
    const meta = generateRowMeta(rowId, {
      [RowMetaKey.IconId]: 'emoji',
      [RowMetaKey.CoverId]: JSON.stringify({ data: 'cover', cover_type: 1 }),
      [RowMetaKey.IsDocumentEmpty]: true,
    });

    const map = getMetaIdMap(rowId);
    expect(meta[map.get(RowMetaKey.IconId) ?? '']).toBe('emoji');
    expect(meta[map.get(RowMetaKey.CoverId) ?? '']).toBe(JSON.stringify({ data: 'cover', cover_type: 1 }));
    expect(meta[map.get(RowMetaKey.IsDocumentEmpty) ?? '']).toBe(true);
  });

  it('skips empty meta values', () => {
    const rowId = 'row-meta-2';
    const meta = generateRowMeta(rowId, {
      [RowMetaKey.IconId]: '',
      [RowMetaKey.CoverId]: '',
      [RowMetaKey.IsDocumentEmpty]: false,
    });

    expect(Object.keys(meta)).toHaveLength(0);
  });
});
