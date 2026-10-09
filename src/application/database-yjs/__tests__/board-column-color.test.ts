import {
  BOARD_COLUMN_BASE_COLORS,
  boardColumnTint,
  resolveBoardColumnTint,
} from '@/application/database-yjs/board-column-color';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOptionColor } from '@/application/database-yjs/fields/select-option/select_option.type';

import { loadParityFixture } from './dashboard-parity-helpers';

const tokens = loadParityFixture<{ boardColumnTintBlockIndex: number[] }>('tokens.json');

describe('board column tint (WP09 §1.5)', () => {
  it('paints option colour N with the block colour of tokens.json boardColumnTintBlockIndex[N - 1]', () => {
    const colors = Object.values(SelectOptionColor);

    expect(colors).toHaveLength(tokens.boardColumnTintBlockIndex.length);
    colors.forEach((color, position) => {
      const index = tokens.boardColumnTintBlockIndex[position];

      expect(boardColumnTint(color)).toEqual({
        index,
        background: `var(--block-bg-color-${index})`,
        label: `var(--block-border-color-${index})`,
        text: `var(--block-text-color-${index})`,
      });
    });
  });

  it('has no tint for a missing or unknown colour', () => {
    expect(boardColumnTint(undefined)).toBeUndefined();
    expect(boardColumnTint('Neon')).toBeUndefined();
  });

  it('tints only the option columns of a select grouping while Color columns is on', () => {
    const base = {
      showColorColumns: true,
      fieldType: FieldType.SingleSelect,
      fieldId: 'status',
      columnId: 'opt-doing',
      optionColor: SelectOptionColor.OptionColor9,
    };

    expect(resolveBoardColumnTint(base)?.index).toBe(12);
    expect(resolveBoardColumnTint({ ...base, fieldType: FieldType.MultiSelect })?.index).toBe(12);
    // Off, the default "No Status" column, and checkbox groupings are never tinted.
    expect(resolveBoardColumnTint({ ...base, showColorColumns: false })).toBeUndefined();
    expect(resolveBoardColumnTint({ ...base, columnId: 'status' })).toBeUndefined();
    expect(resolveBoardColumnTint({ ...base, fieldType: FieldType.Checkbox, columnId: 'Yes' })).toBeUndefined();
  });

  it('offers the ten base colours in the column menu (desktop baseColors)', () => {
    expect(BOARD_COLUMN_BASE_COLORS).toEqual(Object.values(SelectOptionColor).slice(0, 10));
  });
});
