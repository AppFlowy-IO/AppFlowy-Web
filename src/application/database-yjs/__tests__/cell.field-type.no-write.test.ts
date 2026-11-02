import * as Y from 'yjs';

import {
  installLegacyCellFieldTypeNormalizer,
  normalizeLegacyCellFieldType,
} from '@/application/database-yjs/cell.field-type';
import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseCell, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

/**
 * Opening a dashboard sent one `update` frame for every row created through
 * the REST API. The normalizer below runs on every row doc that is opened, so
 * it was the suspect: these tests pin that it only writes to cells in the
 * retired Web representation, never to a row that needs no repair.
 */
describe('legacy cell field-type normalizer leaves canonical rows untouched', () => {
  function createRow(fieldType: unknown) {
    const doc = new Y.Doc() as YDoc;
    const row = new Y.Map<unknown>();
    const cells = new Y.Map<Y.Map<unknown>>();
    const cell = new Y.Map<unknown>();

    cell.set(YjsDatabaseKey.field_type, fieldType);
    cell.set(YjsDatabaseKey.data, '42');
    cells.set('field-id', cell);
    row.set(YjsDatabaseKey.id, 'row-id');
    row.set(YjsDatabaseKey.cells, cells);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
    return { doc, row, cell };
  }

  it('writes nothing when a row written by the current Web client is opened', () => {
    const { doc, cell } = createRow(FieldType.Number);
    const onUpdate = jest.fn();
    const stateBefore = Y.encodeStateAsUpdate(doc);

    doc.on('update', onUpdate);
    installLegacyCellFieldTypeNormalizer(doc);

    expect(onUpdate).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(stateBefore);
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.Number);
    doc.destroy();
  });

  it('writes nothing when cell data of an opened row changes', () => {
    const { doc, cell } = createRow(FieldType.Number);
    const onUpdate = jest.fn();

    installLegacyCellFieldTypeNormalizer(doc);
    doc.on('update', onUpdate);
    // A remote edit of the cell value: one update, and no second one from the normalizer.
    cell.set(YjsDatabaseKey.data, '43');

    expect(onUpdate).toHaveBeenCalledTimes(1);
    doc.destroy();
  });

  it('does not rewrite the i64 field type that the server and desktop store', () => {
    // Rust writes `field_type` as an i64, which Yjs decodes to a bigint. A
    // Y.Map cannot be given a bigint from JS, so the cell is stubbed.
    const set = jest.fn();
    const remove = jest.fn();
    const cell = {
      get: (key: string) => (key === YjsDatabaseKey.field_type ? BigInt(FieldType.SingleSelect) : undefined),
      set,
      delete: remove,
    } as unknown as YDatabaseCell;

    expect(normalizeLegacyCellFieldType(cell)).toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('still repairs a cell in the retired Web representation, once', () => {
    const { doc, cell } = createRow(String(FieldType.Number));
    const onUpdate = jest.fn();

    doc.on('update', onUpdate);
    installLegacyCellFieldTypeNormalizer(doc);

    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.Number);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // Its own write does not make it write again.
    cell.set(YjsDatabaseKey.data, '43');
    expect(onUpdate).toHaveBeenCalledTimes(2);
    doc.destroy();
  });
});
