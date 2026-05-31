import dayjs from 'dayjs';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOption } from '@/application/database-yjs/fields';
import { YDatabaseCell, YDatabaseField, YjsDatabaseKey } from '@/application/types';
import { ChecklistCell, SelectOptionCell, TextCell } from '@/application/database-yjs/cell.type';

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

describe('Lazy Cell Transformation (Object Structure)', () => {
  
  describe('RichText <-> Checklist', () => {
    it('RichText -> Checklist: parses markdown text into checklist structure', () => {
      const field = createField(FieldType.Checklist);
      // Source is RichText, Target is Checklist
      const cell = createCell(`[x] Done
[ ] Todo`, FieldType.Checklist, FieldType.RichText);
      
      const parsed = parseYDatabaseCellToCell(cell, field) as unknown as ChecklistCell;
      const parsedData = JSON.parse(parsed.data);

      expect(parsed.fieldType).toBe(FieldType.Checklist);
      expect(parsedData.options).toHaveLength(2);
      expect(parsedData.options[0].name).toBe('Done');
      expect(parsedData.options[1].name).toBe('Todo');
      expect(parsedData.selected_option_ids).toHaveLength(1);
      expect(parsedData.selected_option_ids[0]).toBe(parsedData.options[0].id);
    });

    it('Checklist -> RichText: stringifies checklist structure to markdown', () => {
      const field = createField(FieldType.RichText);
      const checklistData = JSON.stringify({
        options: [
          { id: '1', name: 'Task A', color: 0 },
          { id: '2', name: 'Task B', color: 0 }
        ],
        selected_option_ids: ['1']
      });
      // Source is Checklist, Target is RichText
      const cell = createCell(checklistData, FieldType.RichText, FieldType.Checklist);

      const parsed = parseYDatabaseCellToCell(cell, field) as unknown as TextCell;
      
      expect(parsed.fieldType).toBe(FieldType.RichText);
      expect(parsed.data).toBe(`[x] Task A
[ ] Task B`);
    });

    it('RichText -> Checklist: handles plain text list', () => {
      const field = createField(FieldType.Checklist);
      const cell = createCell(`Item 1
Item 2`, FieldType.Checklist, FieldType.RichText);
      
      const parsed = parseYDatabaseCellToCell(cell, field) as unknown as ChecklistCell;
      const parsedData = JSON.parse(parsed.data);

      expect(parsedData.options).toHaveLength(2);
      expect(parsedData.options[0].name).toBe('Item 1');
      expect(parsedData.options[1].name).toBe('Item 2');
      expect(parsedData.selected_option_ids).toHaveLength(0); // All unchecked
    });
  });

  describe('Checklist <-> Select', () => {
    it('Checklist -> MultiSelect: matches options by name', () => {
      // Field definition for MultiSelect
      const options: SelectOption[] = [
        { id: 'opt1', name: 'Apple', color: 0 },
        { id: 'opt2', name: 'Banana', color: 0 },
        { id: 'opt3', name: 'Cherry', color: 0 }
      ];
      const field = createField(FieldType.MultiSelect, { options });

      // Source data (Checklist)
      const checklistData = JSON.stringify({
        options: [
          { id: 'c1', name: 'Apple', color: 0 }, // Should match opt1
          { id: 'c2', name: 'Cherry', color: 0 }, // Should match opt3
          { id: 'c3', name: 'Durian', color: 0 }  // No match
        ],
        selected_option_ids: ['c1', 'c2'] // Both checked
      });

      const cell = createCell(checklistData, FieldType.MultiSelect, FieldType.Checklist);
      const parsed = parseYDatabaseCellToCell(cell, field) as unknown as SelectOptionCell;

      expect(parsed.fieldType).toBe(FieldType.MultiSelect);
      // Should contain IDs of Apple and Cherry
      expect(parsed.data).toContain('opt1');
      expect(parsed.data).toContain('opt3');
      expect(parsed.data).not.toContain('opt2');
    });

    it('MultiSelect -> Checklist: converts options to checklist items', () => {
        const options: SelectOption[] = [
          { id: 'opt1', name: 'Red', color: 0 },
          { id: 'opt2', name: 'Blue', color: 0 }
        ];
        // After converting MultiSelect -> Checklist, the select options remain
        // under the source (MultiSelect) type-option key (the switch adds the
        // new type-option without deleting the old one). The read path resolves
        // them by the cell's source type, not the field's current type.
        const field = createField(FieldType.Checklist);
        const typeOptionMap = new Y.Map();
        const option = new Y.Map();

        option.set(YjsDatabaseKey.content, JSON.stringify({ options }));
        typeOptionMap.set(String(FieldType.MultiSelect), option);
        field.set(YjsDatabaseKey.type_option, typeOptionMap);

        const cell = createCell('opt1,opt2', FieldType.Checklist, FieldType.MultiSelect);
        
        const parsed = parseYDatabaseCellToCell(cell, field) as unknown as ChecklistCell;
        const parsedData = JSON.parse(parsed.data);
  
        expect(parsedData.options).toHaveLength(2);
        // IDs are regenerated in the implementation
        expect(parsedData.options[0].name).toBe('Red'); 
        expect(parsedData.options[1].name).toBe('Blue');
        expect(parsedData.selected_option_ids).toHaveLength(2);
      });
  });

  describe('SingleSelect <-> MultiSelect (desktop parity: keep option IDs)', () => {
    const options: SelectOption[] = [
      { id: 'opt1', name: 'Red', color: 0 },
      { id: 'opt2', name: 'Blue', color: 0 },
    ];

    it('SingleSelect -> MultiSelect: preserves the selected option ID', () => {
      // Options are copied 1:1 on switch, so the field's current (MultiSelect)
      // type-option holds them.
      const field = createField(FieldType.MultiSelect, { options });
      const cell = createCell('opt1', FieldType.MultiSelect, FieldType.SingleSelect);

      const parsed = parseYDatabaseCellToCell(cell, field) as unknown as SelectOptionCell;

      expect(parsed.data).toBe('opt1');
    });

    it('MultiSelect -> SingleSelect: preserves all stored option IDs', () => {
      const field = createField(FieldType.SingleSelect, { options });
      const cell = createCell('opt1,opt2', FieldType.SingleSelect, FieldType.MultiSelect);

      const parsed = parseYDatabaseCellToCell(cell, field) as unknown as SelectOptionCell;

      expect(parsed.data).toBe('opt1,opt2');
    });
  });

  describe('RichText -> DateTime (desktop parity: parse text to timestamp)', () => {
    it('parses a date string into a unix-seconds timestamp', () => {
      const field = createField(FieldType.DateTime);
      const cell = createCell('2026-05-14', FieldType.DateTime, FieldType.RichText);

      const parsed = parseYDatabaseCellToCell(cell, field);

      // data is a unix-seconds string that round-trips back to the same date
      expect(typeof parsed.data).toBe('string');
      expect(dayjs.unix(Number(parsed.data)).format('YYYY-MM-DD')).toBe('2026-05-14');
    });

    it('returns empty for unparseable text', () => {
      const field = createField(FieldType.DateTime);
      const cell = createCell('not a date', FieldType.DateTime, FieldType.RichText);

      const parsed = parseYDatabaseCellToCell(cell, field);

      expect(parsed.data).toBe('');
    });
  });

  describe('Other Transformations', () => {
    it('RichText -> Checkbox: parses "yes" variants', () => {
        const field = createField(FieldType.Checkbox);
        const cell = createCell('yes', FieldType.Checkbox, FieldType.RichText);
        
        const parsed = parseYDatabaseCellToCell(cell, field);
        expect(parsed.data).toBe('Yes');
    });

    it('RichText -> Checkbox: parses "[x]" as Yes', () => {
        const field = createField(FieldType.Checkbox);
        const cell = createCell('[x]', FieldType.Checkbox, FieldType.RichText);
        
        const parsed = parseYDatabaseCellToCell(cell, field);
        expect(parsed.data).toBe('Yes');
    });
  });
});
