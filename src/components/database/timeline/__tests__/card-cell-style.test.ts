import { FieldType } from '@/application/database-yjs/database.type';

import { timelineCardCellClassName } from '../card-cell-style';

const CAPTION = ['text-xs', 'font-normal', 'leading-[18px]'];
const PERSON_NAME_HOOK = '[&_.person-cell-name]:sr-only';

// Every field type plus a column whose field is gone.
const everyType: (FieldType | undefined)[] = [
  ...Object.values(FieldType).filter((value): value is FieldType => typeof value === 'number'),
  undefined,
];

describe('desktop_list_card_cell_style.dart: timeline table cells and bar chips', () => {
  it('renders every property as caption 12/18 regular', () => {
    for (const fieldType of everyType) {
      const className = timelineCardCellClassName(fieldType);

      for (const token of CAPTION) expect(className).toContain(token);
    }
  });

  it('uses the primary text color except for Media (MediaCardCell keeps secondaryTextColor)', () => {
    for (const fieldType of everyType) {
      const className = timelineCardCellClassName(fieldType);

      if (fieldType === FieldType.Media) {
        expect(className).toContain('text-text-secondary');
        expect(className).not.toContain('text-text-primary');
      } else {
        expect(className).toContain('text-text-primary');
        expect(className).not.toContain('text-text-secondary');
      }
    }
  });

  it('hides Person names only (hideName: true); CreatedBy and LastEditedBy keep theirs', () => {
    for (const fieldType of everyType) {
      expect(timelineCardCellClassName(fieldType).includes(PERSON_NAME_HOOK)).toBe(fieldType === FieldType.Person);
    }
  });

  it('sets the kept names and the checklist percentage in the map text style', () => {
    for (const fieldType of everyType) {
      const className = timelineCardCellClassName(fieldType);
      const attribution = fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy;

      expect(className.includes('[&_.attribution-name]:text-xs')).toBe(attribution);
      expect(className.includes('[&_.rollup-person-name]:text-xs')).toBe(fieldType === FieldType.Rollup);
      expect(className.includes('[&_.checklist-progress-label]:text-text-primary')).toBe(fieldType === FieldType.Checklist);
    }
  });
});
