import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { snapshotRowProperties } from '@/application/row-document/presentation-properties';
import { YDatabaseCells, YDatabaseField, YDatabaseRow, YjsDatabaseKey } from '@/application/types';

import { snapshotFromSlate } from '../snapshot-adapter';

beforeAll(() => {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
});

it('preserves numeric zero and false while leaving missing and unsupported values unknown', () => {
  const doc = new Y.Doc();
  const row = doc.getMap('row') as YDatabaseRow;
  const fields = doc.getMap<YDatabaseField>('fields');
  const cells = new Y.Map() as YDatabaseCells;

  row.set(YjsDatabaseKey.cells, cells);
  const definitions = [
    { id: 'zero', type: FieldType.Number, data: '0' },
    { id: 'amount', type: FieldType.Number, data: '12.5' },
    { id: 'missing', type: FieldType.Number, data: undefined },
    { id: 'unchecked', type: FieldType.Checkbox, data: 'No' },
    { id: 'unknownCheckbox', type: FieldType.Checkbox, data: undefined },
    { id: 'formula', type: FieldType.Formula, data: 'opaque-value' },
  ];

  for (const { id, type, data } of definitions) {
    const field = new Y.Map() as YDatabaseField;

    fields.set(id, field);
    field.set(YjsDatabaseKey.type, type);
    const cell = new Y.Map();

    cells.set(id, cell);
    cell.set(YjsDatabaseKey.field_type, type);
    if (data !== undefined) cell.set(YjsDatabaseKey.data, data);
  }

  const before = JSON.stringify(doc.toJSON());
  const properties = snapshotRowProperties(
    row,
    definitions.map((field) => ({ ...field, name: field.id })),
    (id) => fields.get(id)
  );

  expect(properties.map((property) => property.value)).toEqual([0, 12.5, null, false, null, null]);
  expect(JSON.stringify(doc.toJSON())).toBe(before);
  doc.destroy();
});

it('keeps row presentation properties independent from subsequent edits', () => {
  const properties = [{ id: 'property:budget', name: 'Budget', type: 'Number', value: null }];
  const snapshot = snapshotFromSlate('row-document', 'Project', undefined, true, properties);
  expect(snapshot.properties).toEqual(properties);
  properties[0].name = 'Later edit';
  expect(snapshot.properties[0].name).toBe('Budget');
});
