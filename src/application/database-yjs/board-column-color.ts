import { DASHBOARD_BOARD_COLUMN_TINT_BLOCK_INDEX } from '@/application/database-yjs/dashboard-geometry';
import { FieldType } from '@/application/database-yjs/database.type';
import { SelectOptionColor } from '@/application/database-yjs/fields/select-option/select_option.type';

/** How a tinted board column paints (WP09 §1.5): the block colour tokens of its option colour. */
export interface BoardColumnTint {
  /** The `--block-*-color-B` index (`tokens.json` `boardColumnTintBlockIndex`). */
  index: number;
  /** The column background, header to footer. */
  background: string;
  /** The header tag background. */
  label: string;
  /** The tag text and the header aggregate. */
  text: string;
}

/** Option colours in `SelectOptionColor` order (OptionColor1..20), which the tint table follows. */
const OPTION_COLOR_ORDER: readonly SelectOptionColor[] = Object.values(SelectOptionColor);

/**
 * The tint of an option colour, or `undefined` for an unknown colour. Option
 * colour N (1..20, desktop `SelectOptionColorPB` order) paints with block
 * colour `boardColumnTintBlockIndex[N - 1]` (desktop `_selectOptionColorToAFColorMap`).
 */
export function boardColumnTint(color: SelectOptionColor | string | undefined): BoardColumnTint | undefined {
  if (!color) return undefined;
  const position = OPTION_COLOR_ORDER.indexOf(color as SelectOptionColor);
  const index = position < 0 ? undefined : DASHBOARD_BOARD_COLUMN_TINT_BLOCK_INDEX[position];

  if (index === undefined) return undefined;
  return {
    index,
    background: `var(--block-bg-color-${index})`,
    label: `var(--block-border-color-${index})`,
    text: `var(--block-text-color-${index})`,
  };
}

/**
 * The tint a column shows: only with "Color columns" on, only for a select
 * grouping, and never for the "No {field}" column (whose id is the field id).
 * Checkbox and other groupings are never tinted.
 */
export function resolveBoardColumnTint({
  showColorColumns,
  fieldType,
  fieldId,
  columnId,
  optionColor,
}: {
  showColorColumns: boolean;
  fieldType: FieldType | undefined;
  fieldId: string;
  columnId: string;
  optionColor: SelectOptionColor | string | undefined;
}): BoardColumnTint | undefined {
  if (!showColorColumns) return undefined;
  if (fieldType !== FieldType.SingleSelect && fieldType !== FieldType.MultiSelect) return undefined;
  if (columnId === fieldId) return undefined;
  return boardColumnTint(optionColor);
}

/** The ten base colours the column menu offers (desktop `BoardColumnColorOption.baseColors`). */
export const BOARD_COLUMN_BASE_COLORS: readonly SelectOptionColor[] = OPTION_COLOR_ORDER.slice(0, 10);
