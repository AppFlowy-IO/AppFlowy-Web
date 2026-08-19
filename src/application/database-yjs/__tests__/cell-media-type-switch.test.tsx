import { act, render, renderHook } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  useCellSelector,
  useFieldSelector,
} from '@/application/database-yjs';
import { parseYDatabaseFileMediaCellToCell } from '@/application/database-yjs/cell.parse';
import { FileMediaCellDataItem, FileMediaType, FileMediaUploadType } from '@/application/database-yjs/cell.type';
import { countFileMediaItems, toFileMediaCellData } from '@/application/database-yjs/fields/media/parse';
import {
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDatabaseRowOrders,
  YDatabaseSorts,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const databaseId = 'database-id';
const viewId = 'view-id';
const rowId = 'row-id';
const fieldId = 'field-id';

/** The value the recording shows: a Text property holding a bare filename. */
const TEXT_CELL_VALUE = 'Invoice-114489.pdf';

function createTextFieldFixture() {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Files & media');
  field.set(YjsDatabaseKey.type, FieldType.RichText);

  rowOrders.push([{ id: rowId, height: 44 }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array() as YDatabaseSorts);
  fields.set(fieldId, field);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  const rowDoc = createRowDoc(rowId, databaseId, {
    [fieldId]: { fieldType: FieldType.RichText, data: TEXT_CELL_VALUE },
  });
  const contextValue = {
    readOnly: false,
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap: { [rowId]: rowDoc },
    workspaceId: 'workspace-id',
  } as DatabaseContextState;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );

  return { field, wrapper };
}

function createMediaCell(entries: string[]): YDatabaseCell {
  const doc = new Y.Doc();
  const cell = doc.getMap('cell') as YDatabaseCell;
  const data = new Y.Array<string>();

  cell.set(YjsDatabaseKey.field_type, FieldType.Media);
  cell.set(YjsDatabaseKey.data, data);
  if (entries.length > 0) {
    data.push(entries);
  }

  return cell;
}

const mediaItem: FileMediaCellDataItem = {
  id: 'file-1',
  name: 'Invoice-114489.pdf',
  url: 'https://example.com/Invoice-114489.pdf',
  file_type: FileMediaType.Document,
  upload_type: FileMediaUploadType.CloudMedia,
};

describe('switching a Text property to Files & media', () => {
  it('never hands a renderer a cell that still describes the previous type', () => {
    const { field, wrapper } = createTextFieldFixture();
    const renders: Array<{ fieldType: FieldType; data: unknown }> = [];

    // Mirrors RowPropertyCell: the component to render is chosen from the
    // field's live type, while the cell comes from useCellSelector.
    function Probe() {
      const cell = useCellSelector({ rowId, fieldId });
      const { field: liveField } = useFieldSelector(fieldId);

      renders.push({
        fieldType: Number(liveField?.get(YjsDatabaseKey.type)) as FieldType,
        data: cell?.data,
      });

      return null;
    }

    render(<Probe />, { wrapper });
    expect(renders.at(-1)?.data).toBe(TEXT_CELL_VALUE);

    act(() => {
      field.set(YjsDatabaseKey.type, FieldType.Media);
    });

    const mediaRenders = renders.filter((entry) => entry.fieldType === FieldType.Media);

    expect(mediaRenders.length).toBeGreaterThan(0);
    mediaRenders.forEach((entry) => {
      expect(Array.isArray(entry.data)).toBe(true);
    });
  });

  it('leaves the stored text untouched when the field is switched back', () => {
    const { field, wrapper } = createTextFieldFixture();
    const { result } = renderHook(() => useCellSelector({ rowId, fieldId }), { wrapper });

    act(() => {
      field.set(YjsDatabaseKey.type, FieldType.Media);
    });
    expect(result.current?.data).toEqual([]);

    act(() => {
      field.set(YjsDatabaseKey.type, FieldType.RichText);
    });
    expect(result.current?.data).toBe(TEXT_CELL_VALUE);
  });
});

describe('toFileMediaCellData', () => {
  it('turns a payload left over from another field type into an empty list', () => {
    expect(toFileMediaCellData(TEXT_CELL_VALUE)).toEqual([]);
    expect(toFileMediaCellData(undefined)).toEqual([]);
    expect(toFileMediaCellData(null)).toEqual([]);
    expect(toFileMediaCellData(42)).toEqual([]);
  });

  it('drops entries that are not media items', () => {
    expect(toFileMediaCellData([mediaItem, null, undefined, 'row-id'])).toEqual([mediaItem]);
  });
});

describe('countFileMediaItems', () => {
  it('counts the same entries toFileMediaCellData keeps', () => {
    const payloads: unknown[] = [
      TEXT_CELL_VALUE,
      undefined,
      null,
      42,
      [],
      [mediaItem],
      [mediaItem, null, undefined, 'row-id', mediaItem],
    ];

    payloads.forEach((payload) => {
      expect(countFileMediaItems(payload)).toBe(toFileMediaCellData(payload).length);
    });
  });
});

describe('parseYDatabaseFileMediaCellToCell', () => {
  it('reads well-formed entries', () => {
    const cell = createMediaCell([JSON.stringify(mediaItem)]);

    expect(parseYDatabaseFileMediaCellToCell(cell).data).toEqual([mediaItem]);
  });

  it('skips entries a different field type wrote instead of throwing', () => {
    const cell = createMediaCell(['a4d0b3f2-not-json', JSON.stringify(mediaItem), '"just a string"']);

    expect(parseYDatabaseFileMediaCellToCell(cell).data).toEqual([mediaItem]);
  });
});

describe('media cell rows', () => {
  it('keeps a row readable when the cell payload is not a list', () => {
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.Media, data: TEXT_CELL_VALUE },
    });
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells).get(fieldId);

    expect(parseYDatabaseFileMediaCellToCell(cell).data).toEqual([]);
  });
});
