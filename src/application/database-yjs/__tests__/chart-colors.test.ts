import {
  CHART_CARD_BG,
  CHART_CHECKBOX_COLORS,
  CHART_COLORLESS_BASE,
  CHART_EMPTY_COLOR,
  CHART_OPACITY_STEPS,
  CHART_OPTION_COLORS,
  CHART_SERIES_PALETTE,
  CHART_SINGLE_HUE,
  chartColorThemePreview,
  ChartColorOptions,
  compositeOver,
  resolveCategoryColor,
  resolveCategoryColors,
  resolveSeriesColor,
} from '../chart-colors';
import { ChartColorTheme, ChartDataItem } from '../chart.type';
import { SelectOptionColor } from '../fields/select-option/select_option.type';

import { loadParityFixture } from './dashboard-parity-helpers';

interface Tokens {
  color: Record<string, { resolved?: Record<string, string> }>;
  chart: {
    series: { hex: string }[];
    optionColors: { index: number; name: string; hex: string }[];
    singleHue: Record<string, string>;
    colorlessBase: string;
    opacitySteps: number[];
    checkbox: { checked: string; unchecked: string };
  };
}

interface ColorCase extends ChartColorOptions {
  name: string;
  items: Partial<ChartDataItem>[];
  expected: string[];
}

const tokens = loadParityFixture<Tokens>('tokens.json');
const geometry = loadParityFixture<{
  colors: ColorCase[];
  seriesColors: { theme: ChartColorTheme; isDark: boolean; count: number; expected: string[] }[];
}>('chart-geometry.json');

const item = (entry: Partial<ChartDataItem>): ChartDataItem => ({ label: entry.key ?? '', value: 1, rowIds: [], ...entry });

describe('chart colors ↔ tokens.json', () => {
  it('uses the shared palettes', () => {
    expect(CHART_SERIES_PALETTE).toEqual(tokens.chart.series.map((entry) => entry.hex));
    expect(CHART_CHECKBOX_COLORS).toEqual(tokens.chart.checkbox);
    expect(CHART_SINGLE_HUE).toEqual(tokens.chart.singleHue);
    expect(CHART_COLORLESS_BASE).toBe(tokens.chart.colorlessBase);
    expect(CHART_OPACITY_STEPS).toEqual(tokens.chart.opacitySteps);
    tokens.chart.optionColors.forEach(({ name, hex }) => {
      expect(CHART_OPTION_COLORS[name as SelectOptionColor]).toBe(hex);
    });
  });

  it('uses the resolved empty fill and card background', () => {
    expect(CHART_EMPTY_COLOR.light).toBe(tokens.color.chartEmpty.resolved?.light);
    expect(CHART_EMPTY_COLOR.dark).toBe(tokens.color.chartEmpty.resolved?.dark);
    expect(CHART_CARD_BG.light).toBe(tokens.color.cardBg.resolved?.light);
    expect(CHART_CARD_BG.dark).toBe(tokens.color.cardBg.resolved?.dark);
  });
});

describe('category colors (dashboard-parity/chart-geometry.json)', () => {
  it.each(geometry.colors.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(resolveCategoryColors(entry.items.map(item), entry).map((colored) => colored.color)).toEqual(entry.expected);
  });

  it.each(geometry.seriesColors.map((entry) => [`${entry.theme} × ${entry.count}`, entry] as const))(
    'series %s',
    (_name, entry) => {
      expect(Array.from({ length: entry.count }, (_, index) => resolveSeriesColor(index, entry.theme, entry.isDark))).toEqual(
        entry.expected
      );
    }
  );
});

describe('resolveCategoryColor', () => {
  const auto: ChartColorOptions = { theme: 'auto', xFieldKind: 'select', isDark: false };

  it('takes the option color under auto, whatever the label', () => {
    expect(resolveCategoryColor(item({ label: 'Renamed', optionColor: SelectOptionColor.OptionColor7 }), 0, auto)).toBe(
      '#72BC8F'
    );
  });

  it('colors checkbox categories by their state, whatever the translated label', () => {
    const checkbox: ChartColorOptions = { ...auto, xFieldKind: 'checkbox' };

    expect(resolveCategoryColor(item({ label: 'Coché', checkboxState: 'checked' }), 0, checkbox)).toBe('#72BC8F');
    expect(resolveCategoryColor(item({ label: 'Non coché', checkboxState: 'unchecked' }), 1, checkbox)).toBe('#C7C6C4');
    // A label alone picks a palette color.
    expect(resolveCategoryColor(item({ label: 'Checked' }), 2, checkbox)).toBe(CHART_SERIES_PALETTE[2]);
  });

  it('ignores option and checkbox colors under colorful', () => {
    expect(
      resolveCategoryColor(item({ optionColor: SelectOptionColor.OptionColor2 }), 3, { ...auto, theme: 'colorful' })
    ).toBe(CHART_SERIES_PALETTE[3]);
  });

  it('uses the palette for dates under auto', () => {
    expect(resolveCategoryColor(item({ key: '2026-01' }), 1, { ...auto, xFieldKind: 'date' })).toBe(CHART_SERIES_PALETTE[1]);
  });

  it('draws the empty category gray in every theme and mode', () => {
    (['auto', 'colorful', 'colorless', 'blue', 'red'] as ChartColorTheme[]).forEach((theme) => {
      expect(resolveCategoryColor(item({ isEmptyCategory: true }), 0, { ...auto, theme })).toBe('#F1F1EF');
      expect(resolveCategoryColor(item({ isEmptyCategory: true }), 0, { ...auto, theme, isDark: true })).toBe('#FFFFFF1A');
    });
  });

  it('composites single hues over the dark card background in dark mode', () => {
    expect(resolveCategoryColor(item({}), 1, { ...auto, theme: 'blue', isDark: true })).toBe(
      compositeOver('#5E9FE8', 0.7, CHART_CARD_BG.dark)
    );
  });
});

describe('resolveCategoryColors', () => {
  const options: ChartColorOptions = { theme: 'auto', xFieldKind: 'other', isDark: false };

  it('counts only the non-empty categories', () => {
    const colored = resolveCategoryColors(
      [item({ key: 'a' }), item({ key: '__empty__', isEmptyCategory: true }), item({ key: 'b' })],
      options
    );

    expect(colored.map((entry) => entry.color)).toEqual([CHART_SERIES_PALETTE[0], '#F1F1EF', CHART_SERIES_PALETTE[1]]);
  });

  it('returns the same array when every color is already right', () => {
    const first = resolveCategoryColors([item({ key: 'a' }), item({ key: 'b' })], options);

    expect(resolveCategoryColors(first, options)).toBe(first);
    expect(resolveCategoryColors(first, { ...options, theme: 'blue' })).not.toBe(first);
  });
});

describe('chartColorThemePreview', () => {
  it('shows five swatches per theme', () => {
    expect(chartColorThemePreview('colorful')).toEqual(CHART_SERIES_PALETTE.slice(0, 5));
    expect(chartColorThemePreview('blue')).toEqual(['#5E9FE8', '#8EBCEF', '#AFCFF4', '#C7DDF7', '#DFECFA']);
    expect(chartColorThemePreview('colorless')).toEqual(['#908D8C', '#B1AFAF', '#C8C6C6', '#D8D7D7', '#E9E8E8']);
  });
});
