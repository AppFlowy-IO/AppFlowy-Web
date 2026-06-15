import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { FieldType } from '@/application/database-yjs/database.type';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields';
import { YDatabaseRow, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { loadV069DatabaseFixture } from './test-helpers';

function getCellData(row: YDatabaseRow, fieldId: string) {
  return row.get(YjsDatabaseKey.cells)?.get(fieldId)?.get(YjsDatabaseKey.data);
}

describe('csv import fixture (v069)', () => {
  const fixture = loadV069DatabaseFixture();
  const nameFieldId = fixture.fieldIdByName.get('Name') ?? '';
  const createdFieldId = fixture.fieldIdByName.get('Created at') ?? '';
  const lastEditedFieldId = fixture.fieldIdByName.get('Last modified') ?? '';
  const attachmentsFieldId = fixture.fieldIdByName.get('Attachments') ?? '';
  const priorityFieldId = fixture.fieldIdByName.get('Priority') ?? '';

  it('loads field metadata from csv header', () => {
    const nameField = fixture.fields.get(nameFieldId);
    const priorityField = fixture.fields.get(priorityFieldId);

    expect(nameField?.get(YjsDatabaseKey.type)).toBe(FieldType.RichText);
    expect(priorityField?.get(YjsDatabaseKey.type)).toBe(FieldType.SingleSelect);
  });

  it('parses select option type options', () => {
    const priorityField = fixture.fields.get(priorityFieldId);
    const options = parseSelectOptionTypeOptions(priorityField);
    const ids = options.options.map((option) => option.id);

    expect(ids).toEqual(['cplL', 'GSf_', 'qnja']);
  });

  it('stores select option content in type options map', () => {
    const priorityField = fixture.fields.get(priorityFieldId);
    const typeOption = priorityField
      ?.get(YjsDatabaseKey.type_option)
      ?.get(String(FieldType.SingleSelect)) as Y.Map<unknown> | undefined;
    const content = typeOption?.get(YjsDatabaseKey.content);

    expect(typeof content).toBe('string');
    expect(String(content)).toContain('options');
  });

  it('maps row timestamps from Created/Last Edited fields', () => {
    const targetRow = fixture.rows.find((row) => {
      const rowDoc = fixture.rowMetas[row.id];
      const rowMap = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
      return getCellData(rowMap, nameFieldId) === 'Olaf';
    });

    expect(targetRow).toBeDefined();
    if (!targetRow) return;

    const rowDoc = fixture.rowMetas[targetRow.id];
    const rowMap = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const createdAt = getCellData(rowMap, createdFieldId);
    const lastEdited = getCellData(rowMap, lastEditedFieldId);

    expect(rowMap.get(YjsDatabaseKey.created_at)).toBe(String(createdAt));
    expect(rowMap.get(YjsDatabaseKey.last_modified)).toBe(String(lastEdited));
  });

  it('keeps single select cell data as ids', () => {
    const targetRow = fixture.rows.find((row) => {
      const rowDoc = fixture.rowMetas[row.id];
      const rowMap = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
      return getCellData(rowMap, nameFieldId) === 'Olaf';
    });

    expect(targetRow).toBeDefined();
    if (!targetRow) return;

    const rowDoc = fixture.rowMetas[targetRow.id];
    const rowMap = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const priorityData = getCellData(rowMap, priorityFieldId);

    expect(priorityData).toBe('cplL');
  });

  it('converts file media data to Y.Array', () => {
    const scottyRow = fixture.rows.find((row) => {
      const rowDoc = fixture.rowMetas[row.id];
      const rowMap = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
      return getCellData(rowMap, nameFieldId) === 'Scotty';
    });

    expect(scottyRow).toBeDefined();
    if (!scottyRow) return;

    const rowDoc = fixture.rowMetas[scottyRow.id];
    const rowMap = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const attachments = getCellData(rowMap, attachmentsFieldId);

    expect(attachments).toBeInstanceOf(Y.Array);
  });
});
