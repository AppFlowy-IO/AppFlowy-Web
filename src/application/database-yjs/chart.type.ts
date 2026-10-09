import * as Y from 'yjs';

import { RowId } from '@/application/types';

import { ChartAggregationType, ChartType } from './chart-enums';
import {
  CHART_GROUP_STYLES,
  ChartColorTheme,
  ChartExtendedSettings,
  ChartExtendedSettingsUpdate,
  ChartGroupStyle,
  ChartNumberColor,
  DEFAULT_CHART_EXTENDED_SETTINGS,
  DEFAULT_CHART_GROUP_STYLE,
  parseChartExtendedSettings,
  parseChartGroupStyle,
  writeChartExtendedUpdate,
} from './chart-extended-settings';
import { DateGroupCondition, FieldType } from './database.type';
import { SelectOptionColor } from './fields/select-option/select_option.type';
import { setLayoutKeyIfChanged } from './layout-codec';

export { ChartAggregationType, ChartType } from './chart-enums';

/**
 * Display format for the Number chart value.
 * - `auto`: follow the Y field's number format (currency, percent, ...) when
 *   it is a Number field, otherwise a grouped decimal.
 * - `compact`: abbreviated notation (1.2K, 3.4M).
 * - `percent`: treat the value as a ratio (0.25 → 25%), like the Number
 *   field's Percent format.
 */
export type ChartNumberFormat = 'auto' | 'compact' | 'percent';

export const CHART_NUMBER_FORMATS: readonly ChartNumberFormat[] = ['auto', 'compact', 'percent'];

export const DEFAULT_CHART_NUMBER_FORMAT: ChartNumberFormat = 'auto';

export function parseChartNumberFormat(value: unknown): ChartNumberFormat {
  return (CHART_NUMBER_FORMATS as readonly unknown[]).includes(value)
    ? (value as ChartNumberFormat)
    : DEFAULT_CHART_NUMBER_FORMAT;
}

/**
 * Chart layout settings matching Flutter's ChartLayoutSettingPB
 * Stored in YJS under layout_settings with key '3' (Chart layout enum value)
 */
export interface ChartLayoutSettings {
  chartType: ChartType;
  xFieldId: string;
  showEmptyValues: boolean;
  aggregationType: ChartAggregationType;
  yFieldId?: string;
  cumulative: boolean;
  dateCondition: DateGroupCondition;
  /** Number chart only: how the value is formatted. Defaults to `auto`. */
  numberFormat?: ChartNumberFormat;
  /** Number chart only: custom title. Empty/undefined uses the generated title. */
  titleText?: string;
  /** Settings under the keys of `chart-extended-settings.ts`, defaults applied. */
  extended: ChartExtendedSettings;
}

/**
 * The extended settings of a chart (WP10 style, WP11 data configuration:
 * sort, groups, buckets, the Number card), defaults applied when there is no
 * chart setting yet.
 */
export function resolveChartStyle(
  settings: Pick<ChartLayoutSettings, 'extended'> | null | undefined
): ChartExtendedSettings {
  return settings?.extended ?? DEFAULT_CHART_EXTENDED_SETTINGS;
}

/**
 * A typed chart write (`useUpdateChartSetting`, `applyChartLayoutUpdate`):
 * only the fields present are written.
 *
 * Not `ChartLayoutSettings` (the parsed read model, one letter longer). The
 * rename to `ChartLayoutUpdate`, typed with the enums, waits for a pass that
 * owns `dispatch.ts`, which re-exports this name.
 */
export interface ChartLayoutSetting {
  chartType?: number;
  xFieldId?: string;
  showEmptyValues?: boolean;
  aggregationType?: number;
  yFieldId?: string;
  cumulative?: boolean;
  dateCondition?: number;
  numberFormat?: ChartNumberFormat;
  titleText?: string;
}

/** The group key of the "No {field}" category. */
export const EMPTY_CATEGORY_KEY = '__empty__';

export type { ChartGroupStyle };
export { CHART_GROUP_STYLES, DEFAULT_CHART_GROUP_STYLE, parseChartGroupStyle };

/** The key of the one series of a chart without a Group by (WP12 §2.2). */
export const CHART_ALL_SERIES_KEY = '__all__';

/** At most this many categories are drawn, the first ones in sort order (WP12 §2.2). */
export const CHART_MAX_CATEGORIES = 200;

/** At most this many series are drawn, the first ones in sort order (WP12 §2.2). */
export const CHART_MAX_SERIES = 50;

/**
 * A chart colour as the series builder resolves it (WP12 §2.2 step 8): a hex
 * at an opacity step (`alpha` 1 is opaque; a single-hue ramp is composited
 * over the card background at paint time), or the "No {field}" fill.
 */
export type ChartColor = { kind: 'hex'; hex: string; alpha: number } | { kind: 'empty' };

/** A category of the X axis (WP12 §2.2). */
export interface ChartCategory {
  key: string;
  label: string;
  isEmpty: boolean;
  /** The category's own colour; only set without a Group by (the series carry the colours then). */
  color: ChartColor | null;
  /** The rows of the category's drawn cells, in view order, each once. */
  rowIds: RowId[];
}

/** One series: a sub-group of the Group by property, or `CHART_ALL_SERIES_KEY` without one. */
export interface ChartSeries {
  key: string;
  label: string;
  /** `null` for the `__all__` series (its categories carry the colours). */
  color: ChartColor | null;
  isEmpty: boolean;
  /** Raw (post-cumulative) value per category; an empty cell is 0. */
  values: number[];
  /** The rows of each cell, per category, in view order. */
  rowIds: RowId[][];
  /** Percent bars only: each cell's share of its category's positive total. */
  percents?: number[];
}

/** What every bar, line and donut chart draws (WP12 §2.2); the Number chart does not use it. */
export interface ChartSeriesData {
  categories: ChartCategory[];
  series: ChartSeries[];
  truncated: { categories: boolean; series: boolean };
}

export const EMPTY_CHART_SERIES_DATA: ChartSeriesData = Object.freeze({
  categories: [],
  series: [],
  truncated: Object.freeze({ categories: false, series: false }),
}) as ChartSeriesData;

/** What a pointer hit in a chart: a segment (a series index) or the category band beside it (`null`). */
export interface ChartElementTarget {
  categoryIndex: number;
  seriesIndex: number | null;
}

/**
 * The drill-down payload of a chart click (and the Number card's item). WP13
 * turns `categoryKey` / `seriesKey` into the `x_key` / `sub_group_key` of a
 * drill query; until then the rows travel as a snapshot.
 */
export interface ChartDataItem {
  /** Category label (e.g., "Completed", "In Progress", "No Status") */
  label: string;
  /** Aggregated value (count/sum/avg/min/max) */
  value: number;
  /** Row IDs in this category (for drill-down) */
  rowIds: RowId[];
  /**
   * Stable group key: the option id, checkbox key or date bucket, and
   * `EMPTY_CATEGORY_KEY` for the empty category. Charts use `key ?? label`.
   */
  key?: string;
  /** The select option's color, when the X property is a select field. */
  optionColor?: SelectOptionColor;
  /** Checkbox categories only. */
  checkboxState?: 'checked' | 'unchecked';
  /** Presentation only: assigned at render time by `resolveCategoryColors` (`chart-colors.ts`). */
  color?: string;
  /** True for "No {field}" category */
  isEmptyCategory?: boolean;
  /**
   * The group's default-sort hint (WP11 §1.4): a rank (option index, bucket
   * order, range start) or label order. Set by the pipeline.
   */
  hint?: { rank: number; tie?: string } | { label: true };
  /** The clicked category's key (WP12 drill payload). */
  categoryKey?: string;
  /** The clicked segment's series key; absent for a band click, `CHART_ALL_SERIES_KEY` without a Group by. */
  seriesKey?: string;
  /** The clicked segment's series label (the drill-down's second chip). */
  seriesLabel?: string;
}

// ---------------------------------------------------------------------------
// Notion chart palette, exactly `dashboard-parity/tokens.json` `chart` (bound by
// `dashboard-tokens.test.ts`). `chart-colors.ts` assigns it.
// ---------------------------------------------------------------------------

/** Series colors in `colorful` order: blue, yellow, green, purple, orange, pink, teal, red, gray. */
export const CHART_SERIES_PALETTE = [
  '#5E9FE8',
  '#EAC26B',
  '#72BC8F',
  '#BF8EDA',
  '#DE9255',
  '#DF84A8',
  '#4FB9C9',
  '#E97366',
  '#C7C6C4',
] as const;

export const CHART_CHECKBOX_COLORS = { checked: '#72BC8F', unchecked: '#C7C6C4' } as const;

/** The chart color of each select option color. Mint and after (and LightPink, Lime) are inferred. */
export const CHART_OPTION_COLORS: Record<SelectOptionColor, string> = {
  [SelectOptionColor.OptionColor1]: '#BF8EDA',
  [SelectOptionColor.OptionColor2]: '#DF84A8',
  [SelectOptionColor.OptionColor3]: '#E9A3BF',
  [SelectOptionColor.OptionColor4]: '#DE9255',
  [SelectOptionColor.OptionColor5]: '#EAC26B',
  [SelectOptionColor.OptionColor6]: '#A9C46A',
  [SelectOptionColor.OptionColor7]: '#72BC8F',
  [SelectOptionColor.OptionColor8]: '#4FB9C9',
  [SelectOptionColor.OptionColor9]: '#5E9FE8',
  [SelectOptionColor.OptionColor10]: '#C7C6C4',
  [SelectOptionColor.OptionColor11]: '#8B7FD6',
  [SelectOptionColor.OptionColor12]: '#9D6BC7',
  [SelectOptionColor.OptionColor13]: '#C76B93',
  [SelectOptionColor.OptionColor14]: '#C9774A',
  [SelectOptionColor.OptionColor15]: '#C99A3F',
  [SelectOptionColor.OptionColor16]: '#8FA84A',
  [SelectOptionColor.OptionColor17]: '#5A9A5F',
  [SelectOptionColor.OptionColor18]: '#3F9E86',
  [SelectOptionColor.OptionColor19]: '#3E86C9',
  [SelectOptionColor.OptionColor20]: '#8C8B89',
};

export type { ChartColorTheme };

/** Base hue of each single-hue theme; category i is drawn at `CHART_OPACITY_STEPS[i % 5]`. */
export const CHART_SINGLE_HUE: Record<Exclude<ChartColorTheme, 'auto' | 'colorful' | 'colorless'>, string> = {
  blue: '#5E9FE8',
  yellow: '#EAC26B',
  green: '#72BC8F',
  purple: '#BF8EDA',
  teal: '#4FB9C9',
  orange: '#DE9255',
  pink: '#DF84A8',
  red: '#E97366',
};

/** Base hue of the `colorless` theme. */
export const CHART_COLORLESS_BASE = '#908D8C';

export const CHART_OPACITY_STEPS = [1, 0.7, 0.5, 0.35, 0.2] as const;

export type { ChartNumberColor };
export type {
  ChartTextGrouping,
  ChartXSort,
  NumberColorOperator,
  NumberColorRule,
  NumberConditionalColor,
} from './chart-extended-settings';
export { CHART_TEXT_GROUPINGS, CHART_X_SORTS, NUMBER_COLOR_NAMES } from './chart-extended-settings';

/** Number card value colors; the variables switch with the theme (`dashboard-tokens.css`). */
export const CHART_NUMBER_COLOR_VARS: Record<ChartNumberColor, string> = {
  default: 'var(--chart-number-default)',
  gray: 'var(--chart-number-gray)',
  brown: 'var(--chart-number-brown)',
  orange: 'var(--chart-number-orange)',
  yellow: 'var(--chart-number-yellow)',
  green: 'var(--chart-number-green)',
  blue: 'var(--chart-number-blue)',
  purple: 'var(--chart-number-purple)',
  pink: 'var(--chart-number-pink)',
  red: 'var(--chart-number-red)',
};

/** `stroke-dasharray` of the dotted value-axis grid lines (desktop draws `[2, 3]` too). */
export const CHART_GRID_DASH = '2 3';

/**
 * YJS keys for chart layout settings.
 * The base keys are the snake_case names of collab's `ChartLayoutSetting`,
 * which the server and desktop read and write (`date_condition` and
 * `cumulative` sit beside it the same way). `numberFormat` and `titleText`
 * are camelCase on every client.
 */
export const ChartLayoutKeys = {
  chartType: 'chart_type',
  xFieldId: 'x_field_id',
  showEmptyValues: 'show_empty_values',
  aggregationType: 'aggregation_type',
  yFieldId: 'y_field_id',
  cumulative: 'cumulative',
  dateCondition: 'date_condition',
  numberFormat: 'numberFormat',
  titleText: 'titleText',
} as const;

export type ChartLayoutField = keyof typeof ChartLayoutKeys;

/**
 * camelCase keys earlier web builds wrote instead of the collab names.
 * Readers fall back to them for charts saved by those builds, and writers
 * keep them in sync so those builds still see charts saved now.
 *
 * Removal criterion: the shim can go when no supported web build (hosted or
 * self-hosted) still reads only the camelCase spelling, that is, when every
 * supported release contains `readChartLayoutValue`. There is no tracking
 * issue yet; whoever sets that minimum version removes it in this order:
 * 1. stop the dual write (the second `setLayoutKeyIfChanged` in
 *    `writeChartLayoutValue`), which halves the Yjs writes of a chart edit;
 * 2. keep the read fallback while charts last saved by an old build may
 *    exist (their first edit already adds the collab key);
 * 3. delete this table, the fallback and the legacy cases of
 *    `chart-layout-keys.test.tsx` together.
 */
export const LEGACY_CHART_LAYOUT_KEYS: Partial<Record<ChartLayoutField, string>> = {
  chartType: 'chartType',
  xFieldId: 'xFieldId',
  showEmptyValues: 'showEmptyValues',
  aggregationType: 'aggregationType',
  yFieldId: 'yFieldId',
  dateCondition: 'dateCondition',
};

/** Reads a chart setting from its collab key, falling back to the legacy web key. */
export function readChartLayoutValue(map: { get(key: string): unknown }, field: ChartLayoutField): unknown {
  const value = map.get(ChartLayoutKeys[field]);
  const legacyKey = LEGACY_CHART_LAYOUT_KEYS[field];

  return value === undefined && legacyKey ? map.get(legacyKey) : value;
}

/**
 * Writes a chart setting under its collab key and, while old web builds are
 * around, its legacy key. A spelling that already holds the value is not
 * rewritten (numbers compare by value, so a desktop bigint equals a web
 * number); a legacy-only chart still gets its collab key on its first edit.
 */
export function writeChartLayoutValue(
  map: { get(key: string): unknown; set(key: string, value: unknown): unknown },
  field: ChartLayoutField,
  value: unknown
) {
  const legacyKey = LEGACY_CHART_LAYOUT_KEYS[field];

  setLayoutKeyIfChanged(map, ChartLayoutKeys[field], value);
  if (legacyKey) setLayoutKeyIfChanged(map, legacyKey, value);
}

/**
 * Applies a typed chart write to the chart layout map: each field present in
 * `settings` through `writeChartLayoutValue`, each field present in `extended`
 * through `writeChartExtendedValue` (`null` resets). Unchanged values are not
 * written, and keys this client does not know are never touched.
 */
export function applyChartLayoutUpdate(
  map: Y.Map<unknown>,
  settings: Partial<ChartLayoutSetting>,
  extended?: ChartExtendedSettingsUpdate
) {
  for (const field of Object.keys(ChartLayoutKeys) as ChartLayoutField[]) {
    const value = settings[field];

    if (value !== undefined) writeChartLayoutValue(map, field, value);
  }

  if (extended) writeChartExtendedUpdate(map, extended);
}

/**
 * Projects the persisted chart map onto `ChartLayoutSettings`. Numbers may be
 * stored as JS numbers (web) or bigints (desktop), and are cast to the enum
 * types here so consumers don't have to project again.
 */
export function parseChartLayoutSettings(map: { get(key: string): unknown }): ChartLayoutSettings {
  const read = (field: ChartLayoutField) => readChartLayoutValue(map, field);
  // Persisted Yjs cells may be missing for fields that haven't been
  // explicitly written yet (e.g. only the aggregation was changed).
  // Apply desktop-parity defaults for those — most importantly
  // `showEmptyValues = true`, otherwise an empty grid renders "No data"
  // instead of a single "No <field>" bar after a partial write.
  const showEmptyRaw = read('showEmptyValues');
  // `DateGroupCondition.Relative` persists as `0`, so we must use an
  // undefined-only fallback — `|| 3` would silently coerce Relative back
  // to Month every time the chart loads.
  const dateConditionRaw = read('dateCondition');
  const yFieldId = read('yFieldId');

  return {
    chartType: Number(read('chartType') || 0) as ChartType,
    xFieldId: String(read('xFieldId') || ''),
    showEmptyValues: showEmptyRaw === undefined ? true : Boolean(showEmptyRaw),
    aggregationType: Number(read('aggregationType') || 0) as ChartAggregationType,
    yFieldId: yFieldId ? String(yFieldId) : undefined,
    cumulative: Boolean(read('cumulative')),
    dateCondition: (dateConditionRaw === undefined || dateConditionRaw === null
      ? DateGroupCondition.Month
      : Number(dateConditionRaw)) as DateGroupCondition,
    numberFormat: parseChartNumberFormat(read('numberFormat')),
    titleText: String(read('titleText') ?? ''),
    extended: parseChartExtendedSettings(map),
  };
}

/**
 * Layout settings key for Chart (DatabaseViewLayout.Chart = 3)
 */
export const CHART_LAYOUT_SETTINGS_KEY = '3';

/**
 * The X-axis types a chart picks by default when `x_field_id` names no usable
 * field, so existing charts do not move (WP11 §1.4). Mirrors Rust
 * `is_chart_groupable_field_type` (the aggregate cache stays single-select).
 */
export const CHART_DEFAULT_X_FIELD_TYPES: readonly FieldType[] = [
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.DateTime,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
];

/** The second default tier, used when no field of `CHART_DEFAULT_X_FIELD_TYPES` exists. */
export const CHART_FALLBACK_X_FIELD_TYPES: readonly FieldType[] = [
  FieldType.Person,
  FieldType.CreatedBy,
  FieldType.LastEditedBy,
  FieldType.Relation,
  FieldType.Number,
  FieldType.URL,
];

/** Every type a chart can group its X axis by (WP11 §1.4); formulas, rollups and AI fields are excluded. */
export const CHART_X_FIELD_TYPES: readonly FieldType[] = [
  ...CHART_DEFAULT_X_FIELD_TYPES,
  FieldType.Person,
  FieldType.CreatedBy,
  FieldType.LastEditedBy,
  FieldType.Relation,
  FieldType.RichText,
  FieldType.URL,
  FieldType.Number,
];

/** Every type a chart can aggregate as its value ("What to show", WP11 §1.9). */
export const CHART_Y_FIELD_TYPES: readonly FieldType[] = [
  FieldType.Number,
  FieldType.Checkbox,
  FieldType.DateTime,
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.RichText,
  FieldType.URL,
  FieldType.Person,
  FieldType.CreatedBy,
  FieldType.LastEditedBy,
  FieldType.Relation,
];

export function isChartXFieldType(fieldType: number): boolean {
  return (CHART_X_FIELD_TYPES as readonly number[]).includes(fieldType);
}

export function isChartYFieldType(fieldType: number): boolean {
  return (CHART_Y_FIELD_TYPES as readonly number[]).includes(fieldType);
}

/**
 * The X field a chart uses when `x_field_id` is empty or names a missing or
 * ineligible field: the first field (in view order) of the default types,
 * else of the fallback types, else the primary field (WP11 §1.4).
 */
export function defaultChartXField<T extends { type: number; isPrimary?: boolean }>(fields: readonly T[]): T | null {
  return (
    fields.find((field) => (CHART_DEFAULT_X_FIELD_TYPES as readonly number[]).includes(field.type)) ??
    fields.find((field) => (CHART_FALLBACK_X_FIELD_TYPES as readonly number[]).includes(field.type)) ??
    fields.find((field) => field.isPrimary && isChartXFieldType(field.type)) ??
    null
  );
}

/**
 * Field types that produce date buckets when used as X-axis.
 */
export const DATE_GROUPABLE_FIELD_TYPES: readonly FieldType[] = [
  FieldType.DateTime,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
];

export function isDateGroupableFieldType(fieldType: number): boolean {
  return (DATE_GROUPABLE_FIELD_TYPES as readonly number[]).includes(fieldType);
}
