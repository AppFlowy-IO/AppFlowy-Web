jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import * as Y from 'yjs';

import { applyRelationCellChangeset, getRelationRowIdsFromCell } from '@/application/database-yjs/dispatch/relation';
import { FieldType } from '@/application/database-yjs/database.type';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import {
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

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

function createAttachedCell() {
  return new Y.Doc().getMap('cell') as YDatabaseCell;
}

describe('relation desktop parity helpers', () => {
  it('reads only native relation payloads as row IDs', () => {
    const convertedText = createAttachedCell();

    convertedText.set(YjsDatabaseKey.field_type, FieldType.RichText);
    convertedText.set(YjsDatabaseKey.data, 'row-a,row-b');
    expect(getRelationRowIdsFromCell(convertedText)).toEqual([]);

    const convertedMedia = createAttachedCell();
    const mediaData = new Y.Array<string>();

    mediaData.push(['{"id":"file-a"}']);
    convertedMedia.set(YjsDatabaseKey.field_type, FieldType.Media);
    convertedMedia.set(YjsDatabaseKey.data, mediaData);
    expect(getRelationRowIdsFromCell(convertedMedia)).toEqual([]);

    const legacyWebCell = createAttachedCell();

    legacyWebCell.set(YjsDatabaseKey.field_type, FieldType.Relation);
    legacyWebCell.set(YjsDatabaseKey.source_field_type, String(FieldType.RichText));
    legacyWebCell.set(YjsDatabaseKey.data, 'row-a,row-b');
    expect(getRelationRowIdsFromCell(legacyWebCell)).toEqual([]);

    const nativeRelation = createAttachedCell();
    const relationData = new Y.Array<string>();

    relationData.push(['row-a', 'row-b']);
    nativeRelation.set(YjsDatabaseKey.field_type, FieldType.Relation);
    nativeRelation.set(YjsDatabaseKey.data, relationData);
    expect(getRelationRowIdsFromCell(nativeRelation)).toEqual(['row-a', 'row-b']);

    const legacyRelationWithoutType = createAttachedCell();
    const legacyRelationData = new Y.Array<string>();

    legacyRelationData.push(['row-c']);
    legacyRelationWithoutType.set(YjsDatabaseKey.data, legacyRelationData);
    expect(getRelationRowIdsFromCell(legacyRelationWithoutType)).toEqual(['row-c']);
  });

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
