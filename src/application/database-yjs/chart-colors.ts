import {
  CHART_CHECKBOX_COLORS,
  CHART_COLORLESS_BASE,
  CHART_OPACITY_STEPS,
  CHART_OPTION_COLORS,
  CHART_SERIES_PALETTE,
  CHART_SINGLE_HUE,
  ChartColorTheme,
  ChartDataItem,
} from './chart.type';

/**
 * Chart colors (`color_theme`, WP10 §1.4). The palettes are `tokens.json`
 * `chart` (in `chart.type.ts`); this module assigns them to categories and
 * series at render time from the item metadata, so a theme change never
 * recomputes chart data. Desktop's `chart_palette.dart` follows the same
 * `dashboard-parity/chart-geometry.json` `colors` vectors.
 */

export {
  CHART_CHECKBOX_COLORS,
  CHART_COLORLESS_BASE,
  CHART_OPACITY_STEPS,
  CHART_OPTION_COLORS,
  CHART_SERIES_PALETTE,
  CHART_SINGLE_HUE,
};

/** "No {field}" fill and the empty donut ring, as hex (`tokens.json` `color.chartEmpty`). */
export const CHART_EMPTY_COLOR = { light: '#F1F1EF', dark: '#FFFFFF1A' } as const;

/** The card background single-hue ramps are composited over (`tokens.json` `color.cardBg`, web). */
export const CHART_CARD_BG = { light: '#FFFFFF', dark: '#21232A' } as const;

/** What the X property is, as far as colors are concerned. */
export type ChartXFieldKind = 'select' | 'checkbox' | 'date' | 'other';

export interface ChartColorOptions {
  theme: ChartColorTheme;
  xFieldKind: ChartXFieldKind;
  isDark: boolean;
  /** Overrides `CHART_CARD_BG` for the single-hue composite. */
  cardBg?: string;
}

type ColorSource = Pick<ChartDataItem, 'isEmptyCategory' | 'optionColor' | 'checkboxState'>;

function channel(hex: string, index: number) {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

/** `hex` at `alpha` over the opaque `background`, as an opaque `#RRGGBB` (each channel rounded half up). */
export function compositeOver(hex: string, alpha: number, background: string): string {
  const parts = [0, 1, 2].map((index) => {
    const value = Math.round(channel(hex, index) * alpha + channel(background, index) * (1 - alpha));

    return Math.min(255, Math.max(0, value)).toString(16).padStart(2, '0');
  });

  return `#${parts.join('')}`.toUpperCase();
}

function singleHueBase(theme: ChartColorTheme): string | null {
  if (theme === 'colorless') return CHART_COLORLESS_BASE;
  return (CHART_SINGLE_HUE as Record<string, string>)[theme] ?? null;
}

function rampColor(base: string, index: number, isDark: boolean, cardBg?: string) {
  const alpha = CHART_OPACITY_STEPS[index % CHART_OPACITY_STEPS.length];

  return alpha === 1 ? base.toUpperCase() : compositeOver(base, alpha, cardBg ?? CHART_CARD_BG[isDark ? 'dark' : 'light']);
}

/**
 * The color of a category. `index` is the category's position among the
 * non-empty categories in display order.
 */
export function resolveCategoryColor(item: ColorSource, index: number, options: ChartColorOptions): string {
  const { theme, isDark } = options;

  if (item.isEmptyCategory) return CHART_EMPTY_COLOR[isDark ? 'dark' : 'light'];
  const base = singleHueBase(theme);

  if (base) return rampColor(base, index, isDark, options.cardBg);
  if (theme === 'auto') {
    if (options.xFieldKind === 'select' && item.optionColor && CHART_OPTION_COLORS[item.optionColor]) {
      return CHART_OPTION_COLORS[item.optionColor];
    }

    if (options.xFieldKind === 'checkbox' && item.checkboxState) return CHART_CHECKBOX_COLORS[item.checkboxState];
  }

  return CHART_SERIES_PALETTE[index % CHART_SERIES_PALETTE.length];
}

/**
 * `items` with their `color` set. An item that already has its color is
 * reused, and the same array comes back when every item does. Chart data is
 * computed without colors, so `ChartProvider` gets a new array from here and
 * keeps the previous one itself when the content is unchanged.
 */
export function resolveCategoryColors<T extends ChartDataItem>(items: readonly T[], options: ChartColorOptions): T[] {
  let index = 0;
  let changed = false;
  const colored = items.map((item) => {
    const color = resolveCategoryColor(item, index, options);

    if (!item.isEmptyCategory) index += 1;
    if (item.color === color) return item;
    changed = true;
    return { ...item, color };
  });

  return changed ? colored : (items as T[]);
}

/** The color of series `seriesIndex` (lines, and WP12's sub-group series): never an option color. */
export function resolveSeriesColor(
  seriesIndex: number,
  theme: ChartColorTheme,
  isDark: boolean,
  cardBg?: string
): string {
  const base = singleHueBase(theme);

  if (base) return rampColor(base, seriesIndex, isDark, cardBg);
  return CHART_SERIES_PALETTE[seriesIndex % CHART_SERIES_PALETTE.length];
}

/** The five swatches the Color menu shows for a theme. */
export function chartColorThemePreview(theme: ChartColorTheme, isDark = false): string[] {
  const base = singleHueBase(theme);

  if (base) return [0, 1, 2, 3, 4].map((index) => rampColor(base, index, isDark));
  return CHART_SERIES_PALETTE.slice(0, 5);
}
