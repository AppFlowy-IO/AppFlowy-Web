/**
 * The series builder of every bar, line and donut chart (WP12 §2.2), and the
 * pure helpers the renderers derive from its output. A chart without a Group
 * by has exactly one series, `CHART_ALL_SERIES_KEY`, so single- and
 * multi-series charts take the same path. Pinned by
 * `dashboard-parity/series.json` on both clients (desktop
 * `ChartSeriesBuilder.build` and `ChartSeriesMath`).
 */
import { CHART_CARD_BG, CHART_EMPTY_COLOR, compositeOver } from '@/application/database-yjs/chart-colors';
import {
  aggregateChartCells,
  chartValueOfAggregate,
  ChartGroupSummary,
  ChartYCell,
  CHECKBOX_CHECKED_KEY,
  EMPTY_GROUP_KEY,
  supportsCumulative,
} from '@/application/database-yjs/chart-config';
import {
  ChartColorTheme,
  ChartGroupStyle,
  ChartLegendPosition,
  ChartXSort,
} from '@/application/database-yjs/chart-extended-settings';
import { resolveLegend } from '@/application/database-yjs/chart-scale';
import {
  CHART_ALL_SERIES_KEY,
  CHART_CHECKBOX_COLORS,
  CHART_COLORLESS_BASE,
  CHART_MAX_CATEGORIES,
  CHART_MAX_SERIES,
  CHART_OPACITY_STEPS,
  CHART_OPTION_COLORS,
  CHART_SERIES_PALETTE,
  CHART_SINGLE_HUE,
  ChartAggregationType,
  ChartCategory,
  ChartColor,
  ChartDataItem,
  ChartElementTarget,
  ChartSeries,
  ChartSeriesData,
  ChartType,
} from '@/application/database-yjs/chart.type';
import { SelectOptionColor } from '@/application/database-yjs/fields';
import { RowId } from '@/application/types';

import { ChartSeriesStyle } from './chartGroupBy';

/** A group the X axis or the Group by property can show, in its candidate order. */
export interface ChartSeriesCandidate {
  key: string;
  label: string;
  isEmpty?: boolean;
  /** Select groups: the option's colour (`auto` colours by it). */
  optionColor?: SelectOptionColor | null;
  /** Checkbox groups; read from the key when absent. */
  checkboxState?: 'checked' | 'unchecked';
}

/** What a property is, as far as colours are concerned. */
export type ChartSeriesFieldKind = 'select' | 'checkbox' | 'other';

/** The X axis or the Group by property: its kind and its groups in candidate order (`__empty__` last). */
export interface ChartSeriesGroupField {
  kind: ChartSeriesFieldKind;
  groups: readonly ChartSeriesCandidate[];
}

/** One row as the builder reads it: its X and sub-group keys (`[]` is no value) and its Y cell. */
export interface ChartRowFact {
  id: RowId;
  x: readonly string[];
  sub: readonly string[];
  /** The Y cell a value aggregation reads; `null` when the chart counts rows. */
  y: ChartYCell | null;
}

export interface ChartSeriesLimits {
  maxCategories: number;
  maxSeries: number;
}

export const DEFAULT_CHART_SERIES_LIMITS: ChartSeriesLimits = {
  maxCategories: CHART_MAX_CATEGORIES,
  maxSeries: CHART_MAX_SERIES,
};

export interface BuildChartSeriesInput {
  chartType: ChartType;
  /** The effective aggregation (`effectiveChartAggregation`). */
  aggregation: number;
  /** The stored `group_style`; only percent bars read it. */
  groupStyle: ChartGroupStyle;
  cumulative: boolean;
  showEmptyValues: boolean;
  hiddenGroups: readonly string[];
  xSort: ChartXSort;
  colorTheme: ChartColorTheme;
  xField: ChartSeriesGroupField;
  /** The effective Group by property, or `null` (a donut or Number chart ignores it). */
  subField: ChartSeriesGroupField | null;
  rows: readonly ChartRowFact[];
  limits?: ChartSeriesLimits;
}

export interface ChartSeriesBuild {
  data: ChartSeriesData;
  /** Every category with rows, in sort order, hidden ones included (the panel's Groups page). */
  groups: ChartGroupSummary[];
}

const GROUP_BY_CHART_TYPES: ReadonlySet<ChartType> = new Set([ChartType.Bar, ChartType.Line, ChartType.HorizontalBar]);
const PERCENT_CHART_TYPES: ReadonlySet<ChartType> = new Set([ChartType.Bar, ChartType.HorizontalBar]);
const EMPTY_Y_CELL: ChartYCell = { empty: true, tokens: [] };

function distinctKeys(keys: readonly string[]): string[] {
  if (keys.length === 1) return [keys[0]];
  return [...new Set(keys)];
}

function isEmptyCandidate(candidate: ChartSeriesCandidate): boolean {
  return candidate.key === EMPTY_GROUP_KEY || candidate.isEmpty === true;
}

/** The candidates with rows, in candidate order with the empty group last; unknown keys follow the known ones. */
function presentCandidates(
  groups: readonly ChartSeriesCandidate[],
  present: ReadonlySet<string>
): ChartSeriesCandidate[] {
  const known = new Set<string>();
  const kept: ChartSeriesCandidate[] = [];

  groups.forEach((group) => {
    if (known.has(group.key)) return;
    known.add(group.key);
    if (present.has(group.key)) kept.push(group);
  });
  present.forEach((key) => {
    if (!known.has(key)) kept.push({ key, label: key, isEmpty: key === EMPTY_GROUP_KEY });
  });
  return [...kept.filter((group) => !isEmptyCandidate(group)), ...kept.filter(isEmptyCandidate)];
}

function singleHueBase(theme: ChartColorTheme): string | null {
  if (theme === 'colorless') return CHART_COLORLESS_BASE;
  return (CHART_SINGLE_HUE as Record<string, string>)[theme] ?? null;
}

function hexColor(hex: string, alpha = 1): ChartColor {
  return { kind: 'hex', hex: hex.toUpperCase(), alpha };
}

/** WP10's colour rules for the group at `index` among the non-empty groups (§2.2 step 8). */
function groupColor(
  candidate: ChartSeriesCandidate,
  index: number,
  kind: ChartSeriesFieldKind,
  theme: ChartColorTheme
): ChartColor {
  if (isEmptyCandidate(candidate)) return { kind: 'empty' };
  const base = singleHueBase(theme);

  if (base) return hexColor(base, CHART_OPACITY_STEPS[index % CHART_OPACITY_STEPS.length]);
  if (theme === 'auto') {
    const option = candidate.optionColor ? CHART_OPTION_COLORS[candidate.optionColor] : undefined;

    if (kind === 'select' && option) return hexColor(option);
    if (kind === 'checkbox') {
      const state = candidate.checkboxState ?? (candidate.key === CHECKBOX_CHECKED_KEY ? 'checked' : 'unchecked');

      return hexColor(CHART_CHECKBOX_COLORS[state]);
    }
  }

  return hexColor(CHART_SERIES_PALETTE[index % CHART_SERIES_PALETTE.length]);
}

/** Colours for `groups` in display order; the index counts the non-empty groups only. */
function groupColors(groups: readonly ChartSeriesCandidate[], kind: ChartSeriesFieldKind, theme: ChartColorTheme) {
  let index = 0;

  return groups.map((group) => {
    const color = groupColor(group, index, kind, theme);

    if (!isEmptyCandidate(group)) index += 1;
    return color;
  });
}

/**
 * Builds the series of a chart (WP12 §2.2): memberships, empty visibility,
 * categories (candidate order, hidden groups, value sort, the category cap),
 * series (present in a kept category, the series cap), cells, cumulative,
 * percent shares and colours. Also returns the Groups page list.
 */
export function buildChartSeriesWithGroups(input: BuildChartSeriesInput): ChartSeriesBuild {
  const { rows, chartType, aggregation } = input;
  const limits = input.limits ?? DEFAULT_CHART_SERIES_LIMITS;
  const hasGroupBy = input.subField !== null && GROUP_BY_CHART_TYPES.has(chartType);
  const cells = new Map<string, Map<string, number[]>>();
  const xMembers = new Map<string, number[]>();

  // 1–2. Memberships, without the empty keys when empty values are hidden.
  rows.forEach((row, index) => {
    let xKeys = row.x.length > 0 ? distinctKeys(row.x) : [EMPTY_GROUP_KEY];
    let subKeys = hasGroupBy ? (row.sub.length > 0 ? distinctKeys(row.sub) : [EMPTY_GROUP_KEY]) : [CHART_ALL_SERIES_KEY];

    if (!input.showEmptyValues) {
      xKeys = xKeys.filter((key) => key !== EMPTY_GROUP_KEY);
      subKeys = subKeys.filter((key) => key !== EMPTY_GROUP_KEY);
    }

    if (xKeys.length === 0 || subKeys.length === 0) return;
    xKeys.forEach((xKey) => {
      let bySub = cells.get(xKey);
      let members = xMembers.get(xKey);

      if (!bySub) {
        bySub = new Map();
        cells.set(xKey, bySub);
      }

      if (!members) {
        members = [];
        xMembers.set(xKey, members);
      }

      members.push(index);
      subKeys.forEach((subKey) => {
        const cell = bySub?.get(subKey);

        if (cell) cell.push(index);
        else bySub?.set(subKey, [index]);
      });
    });
  });

  const aggregate = (indices: readonly number[]): number => {
    if (indices.length === 0) return 0;
    if (aggregation === ChartAggregationType.Count) return indices.length;
    const value = chartValueOfAggregate(
      aggregation,
      aggregateChartCells(
        aggregation,
        indices.map((index) => rows[index].y ?? EMPTY_Y_CELL)
      )
    );

    return value !== null && Number.isFinite(value) ? value : 0;
  };

  // 3. Categories: candidate order, then a stable value sort with the empty group last.
  let ordered = presentCandidates(input.xField.groups, new Set(xMembers.keys()));

  if (input.xSort === 'value_desc' || input.xSort === 'value_asc') {
    const direction = input.xSort === 'value_desc' ? -1 : 1;
    const totals = new Map<string, number>();

    ordered.forEach((group) => {
      let total = 0;

      cells.get(group.key)?.forEach((indices) => {
        total += aggregate(indices);
      });
      totals.set(group.key, total);
    });
    const rest = ordered
      .filter((group) => !isEmptyCandidate(group))
      .map((group, position) => ({ group, position }))
      .sort(
        (a, b) =>
          direction * ((totals.get(a.group.key) ?? 0) - (totals.get(b.group.key) ?? 0)) || a.position - b.position
      )
      .map(({ group }) => group);

    ordered = [...rest, ...ordered.filter(isEmptyCandidate)];
  }

  const hidden = new Set(input.hiddenGroups);
  const groups: ChartGroupSummary[] = ordered.map((group) => {
    const summary: ChartGroupSummary = {
      key: group.key,
      label: group.label,
      count: xMembers.get(group.key)?.length ?? 0,
      isEmpty: isEmptyCandidate(group),
      hidden: hidden.has(group.key),
    };

    if (group.optionColor) summary.optionColor = group.optionColor;
    if (input.xField.kind === 'checkbox' && !summary.isEmpty) {
      summary.checkboxState = group.checkboxState ?? (group.key === CHECKBOX_CHECKED_KEY ? 'checked' : 'unchecked');
    }

    return summary;
  });
  const visibleCategories = ordered.filter((group) => !hidden.has(group.key));
  const keptCategories = visibleCategories.slice(0, Math.max(0, limits.maxCategories));
  const truncatedCategories = visibleCategories.length > keptCategories.length;

  // 4. Series: the sub-groups with a row in a kept category, then the series cap.
  let keptSeries: ChartSeriesCandidate[];
  let truncatedSeries = false;

  if (hasGroupBy && input.subField) {
    const present = new Set<string>();

    keptCategories.forEach((category) => cells.get(category.key)?.forEach((_, subKey) => present.add(subKey)));
    const candidates = presentCandidates(input.subField.groups, present);

    keptSeries = candidates.slice(0, Math.max(0, limits.maxSeries));
    truncatedSeries = candidates.length > keptSeries.length;
  } else {
    keptSeries = [{ key: CHART_ALL_SERIES_KEY, label: '' }];
  }

  // 5. Cells, and the rows of each category's drawn cells.
  const categoryRows: Array<Set<number>> = keptCategories.map(() => new Set());
  const series: ChartSeries[] = keptSeries.map((candidate) => {
    const values: number[] = [];
    const rowIds: RowId[][] = [];

    keptCategories.forEach((category, categoryIndex) => {
      const indices = cells.get(category.key)?.get(candidate.key) ?? [];

      values.push(aggregate(indices));
      rowIds.push(indices.map((index) => rows[index].id));
      indices.forEach((index) => categoryRows[categoryIndex].add(index));
    });
    return {
      key: candidate.key,
      label: candidate.label,
      color: null,
      isEmpty: hasGroupBy && isEmptyCandidate(candidate),
      values,
      rowIds,
    };
  });

  // 6. Cumulative: a running sum per series along the categories; the empty category keeps its own value.
  if (input.cumulative && supportsCumulative(aggregation, chartType)) {
    series.forEach((entry) => {
      let total = 0;

      entry.values = entry.values.map((value, categoryIndex) => {
        if (isEmptyCandidate(keptCategories[categoryIndex])) return value;
        total += value;
        return total;
      });
    });
  }

  // 7. Percent shares of the positive total.
  if (hasGroupBy && PERCENT_CHART_TYPES.has(chartType) && input.groupStyle === 'percent') {
    const positiveTotals = keptCategories.map((_, categoryIndex) =>
      series.reduce((sum, entry) => sum + Math.max(entry.values[categoryIndex], 0), 0)
    );

    series.forEach((entry) => {
      entry.percents = entry.values.map((value, categoryIndex) =>
        positiveTotals[categoryIndex] > 0 ? (Math.max(value, 0) / positiveTotals[categoryIndex]) * 100 : 0
      );
    });
  }

  // 8. Colours: the series with a Group by, the categories without.
  const categoryColors = hasGroupBy ? null : groupColors(keptCategories, input.xField.kind, input.colorTheme);
  const seriesColors =
    hasGroupBy && input.subField ? groupColors(keptSeries, input.subField.kind, input.colorTheme) : null;

  if (seriesColors) series.forEach((entry, index) => (entry.color = seriesColors[index]));
  const categories: ChartCategory[] = keptCategories.map((category, categoryIndex) => ({
    key: category.key,
    label: category.label,
    isEmpty: isEmptyCandidate(category),
    color: categoryColors ? categoryColors[categoryIndex] : null,
    rowIds: [...categoryRows[categoryIndex]].sort((a, b) => a - b).map((index) => rows[index].id),
  }));

  return {
    data: { categories, series, truncated: { categories: truncatedCategories, series: truncatedSeries } },
    groups,
  };
}

export function buildChartSeries(input: BuildChartSeriesInput): ChartSeriesData {
  return buildChartSeriesWithGroups(input).data;
}

// ---------------------------------------------------------------------------
// Derived values (WP12 §2.2, "Derived values")
// ---------------------------------------------------------------------------

/** Whether the data has sub-group series (a Group by), not the one `__all__` series. */
export function hasSeriesGroupBy(data: ChartSeriesData): boolean {
  return data.series.some((entry) => entry.key !== CHART_ALL_SERIES_KEY);
}

/** Per category, the sum of every series' raw value (the band value and the value sort). */
export function categoryTotals(data: ChartSeriesData): number[] {
  return data.categories.map((_, categoryIndex) =>
    data.series.reduce((sum, entry) => sum + (entry.values[categoryIndex] ?? 0), 0)
  );
}

/** Per category, the sum of the positive and of the negative drawn values. */
export function stackTotals(data: ChartSeriesData): { positive: number[]; negative: number[] } {
  const positive = data.categories.map(() => 0);
  const negative = data.categories.map(() => 0);

  data.series.forEach((entry) => {
    entry.values.forEach((value, categoryIndex) => {
      if (value > 0) positive[categoryIndex] += value;
      else if (value < 0) negative[categoryIndex] += value;
    });
  });
  return { positive, negative };
}

/**
 * Per category, the first series (in series order) with a positive drawn
 * value and the first with a negative one: the segments that carry the
 * rounded value end (series 0 is drawn at the value end, decision 1).
 * Percent bars draw no negative segments.
 */
export function outermostSegments(
  data: ChartSeriesData,
  style: ChartSeriesStyle
): { positive: Array<number | null>; negative: Array<number | null> } {
  const first = (test: (value: number) => boolean) =>
    data.categories.map((_, categoryIndex) => {
      const index = data.series.findIndex((entry) => test(entry.values[categoryIndex] ?? 0));

      return index === -1 ? null : index;
    });

  return {
    positive: first((value) => value > 0),
    negative: style === 'percent' ? data.categories.map(() => null) : first((value) => value < 0),
  };
}

/** The value range the axis must show (before WP10's nice ticks and headroom). */
export function valueExtent(
  data: ChartSeriesData,
  chartType: ChartType,
  style: ChartSeriesStyle
): { min: number; max: number } {
  if (style === 'percent') return { min: 0, max: 100 };
  let min = 0;
  let max = 0;

  if (chartType === ChartType.Line || style === 'grouped') {
    data.series.forEach((entry) =>
      entry.values.forEach((value) => {
        if (value < min) min = value;
        if (value > max) max = value;
      })
    );
    return { min, max };
  }

  const totals = stackTotals(data);

  totals.positive.forEach((value) => (max = Math.max(max, value)));
  totals.negative.forEach((value) => (min = Math.min(min, value)));
  return { min, max };
}

export interface ChartSeriesDataLabel {
  categoryIndex: number;
  category: string;
  /** The labelled bar's series; `null` for a stack total (and the single-series labels). */
  seriesIndex: number | null;
  series: string | null;
  side: 'positive' | 'negative';
  value: number;
}

/** The data labels a chart draws (WP12 §2.6), in category then series order. */
export function seriesDataLabels(
  data: ChartSeriesData,
  chartType: ChartType,
  style: ChartSeriesStyle,
  showDataLabels: boolean
): ChartSeriesDataLabel[] {
  if (!showDataLabels || style === 'percent' || chartType === ChartType.Donut || chartType === ChartType.Number)
    return [];
  const labels: ChartSeriesDataLabel[] = [];

  if (chartType === ChartType.Line) {
    if (data.series.length !== 1) return [];
    data.categories.forEach((category, categoryIndex) => {
      const value = data.series[0].values[categoryIndex] ?? 0;

      labels.push({
        categoryIndex,
        category: category.key,
        seriesIndex: null,
        series: null,
        side: value < 0 ? 'negative' : 'positive',
        value,
      });
    });
    return labels;
  }

  if (style === 'grouped') {
    data.categories.forEach((category, categoryIndex) => {
      data.series.forEach((entry, seriesIndex) => {
        const value = entry.values[categoryIndex] ?? 0;

        if (value === 0) return;
        labels.push({
          categoryIndex,
          category: category.key,
          seriesIndex,
          series: entry.key,
          side: value < 0 ? 'negative' : 'positive',
          value,
        });
      });
    });
    return labels;
  }

  const totals = stackTotals(data);

  data.categories.forEach((category, categoryIndex) => {
    const positive = totals.positive[categoryIndex];
    const negative = totals.negative[categoryIndex];
    const base = { categoryIndex, category: category.key, seriesIndex: null, series: null };

    if (positive > 0 || negative === 0) labels.push({ ...base, side: 'positive', value: positive });
    if (negative < 0) labels.push({ ...base, side: 'negative', value: negative });
  });
  return labels;
}

export interface SeriesTooltipRow {
  seriesIndex: number;
  series: string;
  label: string;
  color: ChartColor | null;
  value: number;
  /** Percent bars: the share of the category's positive total. */
  percent?: number;
}

/** At most this many series rows; the rest is "+{n} more" (decision 13). */
export const CHART_TOOLTIP_MAX_ROWS = 10;

/**
 * The tooltip rows of category `categoryIndex` (WP12 §2.8): every series with
 * a non-zero raw value in series order, or every series when all are 0, cut
 * after `maxRows` (`more` counts the rest).
 */
export function seriesTooltipRows(
  data: ChartSeriesData,
  categoryIndex: number,
  style: ChartSeriesStyle,
  maxRows: number = CHART_TOOLTIP_MAX_ROWS
): { rows: SeriesTooltipRow[]; more: number } {
  const all = data.series.map<SeriesTooltipRow>((entry, seriesIndex) => {
    const row: SeriesTooltipRow = {
      seriesIndex,
      series: entry.key,
      label: entry.label,
      color: entry.color,
      value: entry.values[categoryIndex] ?? 0,
    };

    if (style === 'percent') row.percent = entry.percents?.[categoryIndex] ?? 0;
    return row;
  });
  const nonZero = all.filter((row) => row.value !== 0);
  const listed = nonZero.length > 0 ? nonZero : all;

  return { rows: listed.slice(0, maxRows), more: Math.max(0, listed.length - maxRows) };
}

/** Whether the chart shows a legend (WP10's `resolveLegend` with the series count). */
export function legendVisible(
  data: ChartSeriesData,
  legendPosition: ChartLegendPosition,
  chartType: ChartType
): boolean {
  return resolveLegend(chartType, data.series.length, legendPosition) !== null;
}

/** The `{n}` of "Only showing the first {n} groups" (decision 8), or `null` when nothing was cut. */
export function truncationCaptionCount(
  data: ChartSeriesData,
  limits: ChartSeriesLimits = DEFAULT_CHART_SERIES_LIMITS
): number | null {
  if (data.truncated.categories) return limits.maxCategories;
  if (data.truncated.series) return limits.maxSeries;
  return null;
}

/** The width of one grouped bar in a category slot. */
export function groupedBarWidth(slot: number, seriesCount: number): number {
  return Math.max(1, Math.min(16, (slot * 0.8) / Math.max(1, seriesCount)));
}

/** The Recharts data key of series `index`: never the series key, which may contain dots (decision 17). */
export function seriesDataKey(index: number, style: ChartSeriesStyle): string {
  return style === 'percent' ? `p${index}` : `s${index}`;
}

export interface ChartRechartsRow {
  __c: number;
  __key: string;
  __label: string;
  [dataKey: string]: number | string;
}

/** One Recharts row per category: `s{j}` raw values and, for percent bars, `p{j}` shares. */
export function toRechartsRows(data: ChartSeriesData, style: ChartSeriesStyle): ChartRechartsRow[] {
  return data.categories.map((category, categoryIndex) => {
    const row: ChartRechartsRow = { __c: categoryIndex, __key: category.key, __label: category.label };

    data.series.forEach((entry, seriesIndex) => {
      row[`s${seriesIndex}`] = entry.values[categoryIndex] ?? 0;
      if (style === 'percent') row[`p${seriesIndex}`] = entry.percents?.[categoryIndex] ?? 0;
    });
    return row;
  });
}

/** The number of non-zero cells (drawn segments). */
export function drawnSegmentCount(data: ChartSeriesData): number {
  return data.series.reduce((count, entry) => count + entry.values.filter((value) => value !== 0).length, 0);
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** A colour in the fixture form of `series.json`: `#RRGGBB`, `#RRGGBB/0.7`, `empty` or `null`. */
export function chartColorToFixture(color: ChartColor | null): string | null {
  if (!color) return null;
  if (color.kind === 'empty') return 'empty';
  return color.alpha === 1 ? color.hex.toUpperCase() : `${color.hex.toUpperCase()}/${color.alpha}`;
}

/** A colour as CSS: an opacity step composited over the card background, the empty fill per theme. */
export function paintChartColor(
  color: ChartColor | null | undefined,
  isDark: boolean,
  cardBg?: string
): string | undefined {
  if (!color) return undefined;
  if (color.kind === 'empty') return CHART_EMPTY_COLOR[isDark ? 'dark' : 'light'];
  if (color.alpha === 1) return color.hex.toUpperCase();
  return compositeOver(color.hex, color.alpha, cardBg ?? CHART_CARD_BG[isDark ? 'dark' : 'light']);
}

/** Paints a builder colour; `useChartContext().paint` binds the theme. */
export type ChartColorPainter = (color: ChartColor | null | undefined) => string | undefined;

const NO_PAINT: ChartColorPainter = () => undefined;

// ---------------------------------------------------------------------------
// Drill payloads and category items
// ---------------------------------------------------------------------------

/**
 * The drill-down payload of a pointer target (WP12 §2.10): a segment passes
 * its cell (value, rows, series colour) and its series key unless the series
 * is `__all__`; the band passes the whole category.
 */
export function toDrillItem(
  data: ChartSeriesData,
  target: ChartElementTarget,
  paint: ChartColorPainter = NO_PAINT
): ChartDataItem | null {
  const category = data.categories[target.categoryIndex];

  if (!category) return null;
  const base = {
    label: category.label,
    key: category.key,
    categoryKey: category.key,
    isEmptyCategory: category.isEmpty,
  };
  const entry = target.seriesIndex === null ? undefined : data.series[target.seriesIndex];

  if (entry) {
    const item: ChartDataItem = {
      ...base,
      value: entry.values[target.categoryIndex] ?? 0,
      rowIds: entry.rowIds[target.categoryIndex] ?? [],
      color: paint(entry.color ?? category.color),
    };

    if (entry.key !== CHART_ALL_SERIES_KEY) {
      item.seriesKey = entry.key;
      item.seriesLabel = entry.label;
    }

    return item;
  }

  return {
    ...base,
    value: categoryTotals(data)[target.categoryIndex] ?? 0,
    rowIds: category.rowIds,
    color: paint(category.color ?? data.series[0]?.color ?? null),
  };
}

/** One item per category: its total, its rows and its colour (or series 0's), as single-series charts read them. */
export function toCategoryItems(data: ChartSeriesData, paint: ChartColorPainter = NO_PAINT): ChartDataItem[] {
  const totals = categoryTotals(data);

  return data.categories.map((category, categoryIndex) => {
    const item: ChartDataItem = {
      label: category.label,
      value: totals[categoryIndex],
      rowIds: category.rowIds,
      key: category.key,
      isEmptyCategory: category.isEmpty,
    };
    const color = paint(category.color ?? data.series[0]?.color ?? null);

    if (color !== undefined) item.color = color;
    return item;
  });
}

function sameColor(a: ChartColor | null, b: ChartColor | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'empty' || (b.kind === 'hex' && a.hex === b.hex && a.alpha === b.alpha);
}

function sameNumbers(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameIds(a: readonly RowId[], b: readonly RowId[]): boolean {
  return a === b || (a.length === b.length && a.every((id, index) => id === b[index]));
}

/**
 * Content equality of two builds: keys, labels, colours, flags, values,
 * percents and every row id (the drill-down reads the ids, so a filter that
 * swaps the rows of a cell must not keep the old data).
 */
export function chartSeriesDataEqual(a: ChartSeriesData, b: ChartSeriesData): boolean {
  if (a === b) return true;
  if (
    a.truncated.categories !== b.truncated.categories ||
    a.truncated.series !== b.truncated.series ||
    a.categories.length !== b.categories.length ||
    a.series.length !== b.series.length
  ) {
    return false;
  }

  const categoriesEqual = a.categories.every((category, index) => {
    const other = b.categories[index];

    return (
      category.key === other.key &&
      category.label === other.label &&
      category.isEmpty === other.isEmpty &&
      sameColor(category.color, other.color) &&
      sameIds(category.rowIds, other.rowIds)
    );
  });

  return (
    categoriesEqual &&
    a.series.every((entry, index) => {
      const other = b.series[index];

      return (
        entry.key === other.key &&
        entry.label === other.label &&
        entry.isEmpty === other.isEmpty &&
        sameColor(entry.color, other.color) &&
        sameNumbers(entry.values, other.values) &&
        sameNumbers(entry.percents, other.percents) &&
        entry.rowIds.length === other.rowIds.length &&
        entry.rowIds.every((ids, cell) => sameIds(ids, other.rowIds[cell]))
      );
    })
  );
}
