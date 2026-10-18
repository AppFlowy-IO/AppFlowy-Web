import { SelectOptionColor } from '@/application/database-yjs';
import { CHECKBOX_CHECKED_COLOR, CHECKBOX_UNCHECKED_COLOR } from '@/application/database-yjs/chart.type';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';

/**
 * Fill color of a select-option category: the option's tag fill token, like
 * desktop's `selectOptionColorToBgAFColor` (an unknown color falls back to the
 * first tag color there too).
 */
export function getSelectOptionChartColor(color: SelectOptionColor): string {
  const token: string | undefined = SelectOptionColorMap[color];

  return `var(${token ?? SelectOptionColorMap[SelectOptionColor.OptionColor1]})`;
}

/**
 * Color of labels drawn in a select-option category's color (donut leader
 * labels): the option's tag text token, like desktop's
 * `selectOptionColorToTextAFColor`.
 */
export function getSelectOptionChartTextColor(color: SelectOptionColor): string {
  const token: string | undefined = SelectOptionFgColorMap[color];

  return `var(${token ?? SelectOptionFgColorMap[SelectOptionColor.OptionColor1]})`;
}

/** Desktop's `ChartColorUtils.checkboxCheckedColor` / `checkboxUncheckedColor`. */
export function getCheckboxChartColor(checked: boolean): string {
  return checked ? CHECKBOX_CHECKED_COLOR : CHECKBOX_UNCHECKED_COLOR;
}
