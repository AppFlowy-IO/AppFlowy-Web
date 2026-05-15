jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import * as Y from 'yjs';

import { applyRelationCellChangeset } from '@/application/database-yjs/dispatch/relation';
import { FieldType } from '@/application/database-yjs/database.type';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { YDatabase, YDatabaseField, YDatabaseFields, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

function createAttachedRelationField(fieldId = 'relation-field') {
  const doc = new Y.Doc();
  const root = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;

  database.set(YjsDatabaseKey.fields, fields);
  root.set(YjsEditorKey.database, database);
  fields.set(fieldId, createRelationField(fieldId));

  return fields.get(fieldId) as YDatabaseField;
}

describe('relation desktop parity helpers', () => {
  it('creates relation fields with desktop-compatible type option defaults', () => {
    const field = createAttachedRelationField();
    const option = parseRelationTypeOption(field);

    expect(field.get(YjsDatabaseKey.type)).toBe(FieldType.Relation);
    expect(option).toEqual({
      database_id: '',
      is_two_way: false,
      reciprocal_field_id: undefined,
      reciprocal_field_name: undefined,
      source_limit: RelationLimit.NoLimit,
      target_limit: RelationLimit.NoLimit,
    });
  });

  it('parses legacy relation fields that only contain database_id', () => {
    const field = createAttachedRelationField();
    const typeOption = field
      .get(YjsDatabaseKey.type_option)
      .get(String(FieldType.Relation));

    typeOption.set(YjsDatabaseKey.database_id, 'related-db');
    typeOption.delete(YjsDatabaseKey.is_two_way);
    typeOption.delete(YjsDatabaseKey.source_limit);
    typeOption.delete(YjsDatabaseKey.target_limit);

    expect(parseRelationTypeOption(field)).toEqual({
      database_id: 'related-db',
      is_two_way: false,
      reciprocal_field_id: undefined,
      reciprocal_field_name: undefined,
      source_limit: RelationLimit.NoLimit,
      target_limit: RelationLimit.NoLimit,
    });
  });

  it('applies no-limit changes without duplicates and preserves order', () => {
    expect(
      applyRelationCellChangeset(
        ['row-a', 'row-b'],
        {
          insertedRowIds: ['row-b', 'row-c'],
          removedRowIds: ['row-a'],
        },
        RelationLimit.NoLimit
      )
    ).toEqual({
      nextRowIds: ['row-b', 'row-c'],
      effectiveChanges: {
        insertedRowIds: ['row-c'],
        removedRowIds: ['row-a'],
      },
    });
  });

  it('enforces one-only by replacing existing linked rows with the last inserted row', () => {
    expect(
      applyRelationCellChangeset(
        ['row-a', 'row-b'],
        {
          insertedRowIds: ['row-c', 'row-d'],
        },
        RelationLimit.OneOnly
      )
    ).toEqual({
      nextRowIds: ['row-d'],
      effectiveChanges: {
        insertedRowIds: ['row-d'],
        removedRowIds: ['row-a', 'row-b'],
      },
    });
  });

  it('keeps one-only unchanged when selecting the already linked row', () => {
    expect(
      applyRelationCellChangeset(
        ['row-a'],
        {
          insertedRowIds: ['row-a'],
        },
        RelationLimit.OneOnly
      )
    ).toEqual({
      nextRowIds: ['row-a'],
      effectiveChanges: {
        insertedRowIds: [],
        removedRowIds: [],
      },
    });
  });
});
