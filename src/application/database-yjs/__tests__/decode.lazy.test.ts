import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { decodeCellForSort } from '@/application/database-yjs/decode';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOption, SelectOptionFilterCondition } from '@/application/database-yjs/fields';
import { parseChecklistFlexible } from '@/application/database-yjs/fields/checklist/parse';
import { selectOptionFilterCheck } from '@/application/database-yjs/filter';
import { YDatabaseCell, YDatabaseField, YjsDatabaseKey } from '@/application/types';

function createField(type: FieldType, typeOptionContent?: unknown): YDatabaseField {
  const doc = new Y.Doc();
  const field = doc.getMap('field') as YDatabaseField;
  field.set(YjsDatabaseKey.type, String(type));
  if (typeOptionContent !== undefined) {
    const typeOptionMap = new Y.Map();
    const option = new Y.Map();
    option.set(YjsDatabaseKey.content, JSON.stringify(typeOptionContent));
    typeOptionMap.set(String(type), option);
    field.set(YjsDatabaseKey.type_option, typeOptionMap);
  }
  return field;
}

function createCell(data: unknown, currentType: FieldType, sourceType?: FieldType): YDatabaseCell {
  const doc = new Y.Doc();
  const cell = doc.getMap('cell') as YDatabaseCell;
  cell.set(YjsDatabaseKey.data, data);
  cell.set(YjsDatabaseKey.field_type, String(currentType));
  if (sourceType !== undefined) {
    cell.set(YjsDatabaseKey.source_field_type, String(sourceType));
  }
  return cell;
}

describe('lazy decode + filters parity', () => {
  it('computes checklist percentage from markdown/plain text for sorting', () => {
    const field = createField(FieldType.Checklist);
    const cell = createCell('[x] Done\n[ ] Todo', FieldType.Checklist, FieldType.RichText);

    expect(decodeCellForSort(cell, field)).toBeCloseTo(0.5);
  });

  it('maps checklist data to select option ids when filtering', () => {
    const options: SelectOption[] = [{ id: 'opt1', name: 'Alpha', color: 0 }];
    const field = createField(FieldType.SingleSelect, { options, disable_color: false });

    const checklistJson = JSON.stringify({
      options: [
        { id: 'c1', name: 'Alpha', color: 0 },
        { id: 'c2', name: 'Beta', color: 0 },
      ],
      selected_option_ids: ['c1'],
    });

    const matches = selectOptionFilterCheck(
      field,
      checklistJson,
      'opt1',
      SelectOptionFilterCondition.OptionIs
    );
    expect(matches).toBe(true);
  });

  it('parses checklist flexible helper from markdown for downstream consumers', () => {
    const parsed = parseChecklistFlexible('- [x] Alpha\n- [ ] Beta');
    expect(parsed?.options?.map((o) => o.name)).toEqual(['Alpha', 'Beta']);
    expect(parsed?.selectedOptionIds?.length).toBe(1);
  });
});
