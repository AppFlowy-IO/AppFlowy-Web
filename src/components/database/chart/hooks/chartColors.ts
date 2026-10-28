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
 * Light-theme values of the tag fill tokens (`semantic.light.css`). The donut
 * snaps an option's fill onto its palette by hue, which needs a concrete
 * color while the fills themselves stay theme tokens.
 */
export const TAG_FILL_LIGHT_HEX: Readonly<Record<string, string>> = {
  '--tag-fill-01-light': '#E6E6FA',
  '--tag-fill-01-thick': '#4545A6',
  '--tag-fill-02-light': '#F0E1F7',
  '--tag-fill-02-thick': '#772F96',
  '--tag-fill-03-light': '#F7E1EB',
  '--tag-fill-03-thick': '#6E2343',
  '--tag-fill-04-light': '#FAE8DE',
  '--tag-fill-04-thick': '#A54B24',
  '--tag-fill-05-light': '#FCF1D7',
  '--tag-fill-05-thick': '#906000',
  '--tag-fill-06-light': '#F6F7D0',
  '--tag-fill-06-thick': '#627300',
  '--tag-fill-07-light': '#E9F5D7',
  '--tag-fill-07-thick': '#456514',
  '--tag-fill-08-light': '#DFF5EB',
  '--tag-fill-08-thick': '#127B47',
  '--tag-fill-09-light': '#E1EEF7',
  '--tag-fill-09-thick': '#0C5B9E',
  '--tag-fill-10-light': '#E6E9F0',
  '--tag-fill-10-thick': '#4C5966',
};

/**
 * The light-theme color behind a fill from {@link getSelectOptionChartColor},
 * or undefined when `fill` is not an option fill (a checkbox or palette color).
 */
export function getSelectOptionChartFillHex(fill: string): string | undefined {
  const token = /^var\((--[\w-]+)\)$/.exec(fill)?.[1];

  return token ? TAG_FILL_LIGHT_HEX[token] : undefined;
}

/**
 * Text color of a select-option category: the option's tag text token, like
 * desktop's `selectOptionColorToTextAFColor`.
 */
export function getSelectOptionChartTextColor(color: SelectOptionColor): string {
  const token: string | undefined = SelectOptionFgColorMap[color];

  return `var(${token ?? SelectOptionFgColorMap[SelectOptionColor.OptionColor1]})`;
}

/** Desktop's `ChartColorUtils.checkboxCheckedColor` / `checkboxUncheckedColor`. */
export function getCheckboxChartColor(checked: boolean): string {
  return checked ? CHECKBOX_CHECKED_COLOR : CHECKBOX_UNCHECKED_COLOR;
}
