import * as Y from 'yjs';

import { RowId } from '@/application/types';

import {
  ChartColorTheme,
  ChartExtendedField,
  ChartExtendedLayoutKeys,
  ChartExtendedSettings,
  ChartExtendedSettingsUpdate,
  DEFAULT_CHART_EXTENDED_SETTINGS,
  parseChartExtendedSettings,
  writeChartExtendedValue,
} from './chart-extended-settings';
import { DateGroupCondition, FieldType } from './database.type';
import { SelectOptionColor } from './fields/select-option/select_option.type';
import { setLayoutKeyIfChanged } from './layout-codec';

/**
 * Chart type enum matching Flutter's ChartTypePB
 */
export enum ChartType {
  Bar = 0,
  Line = 1,
  HorizontalBar = 2,
  Donut = 3,
  /** Single KPI tile: one aggregated value over all filtered rows. */
  Number = 4,
}

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
 * Chart aggregation type enum matching Flutter's ChartAggregationTypePB
 */
export enum ChartAggregationType {
  Count = 0,
  Sum = 1,
  Average = 2,
  Min = 3,
  Max = 4,
  Median = 5,
  CountValues = 6,
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

/** The style settings of a chart (WP10), defaults applied when there is no chart setting yet. */
export function resolveChartStyle(
  settings: Pick<ChartLayoutSettings, 'extended'> | null | undefined
): ChartExtendedSettings {
  return settings?.extended ?? DEFAULT_CHART_EXTENDED_SETTINGS;
}

/**
 * A typed chart write (`useUpdateChartSetting`, `applyChartLayoutUpdate`):
 * only the fields present are written.
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

/**
 * Computed chart data item for rendering
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

/** The persisted `number_color` values (ARCHITECTURE §2.2). */
export type ChartNumberColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

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

/** "No {field}" group fill and the empty donut ring. */
export const CHART_EMPTY_FILL = 'var(--chart-empty)';

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

  if (!extended) return;
  const values: Partial<Record<ChartExtendedField, unknown>> = extended;

  for (const field of Object.keys(ChartExtendedLayoutKeys) as ChartExtendedField[]) {
    const value = values[field];

    if (value !== undefined) writeChartExtendedValue(map, field, value);
  }
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
 * Field types that can be used as X-axis (grouping) fields.
 * Mirrors desktop's `is_chart_groupable_field_type`.
 */
export const GROUPABLE_FIELD_TYPES: readonly FieldType[] = [
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.Checkbox,
  FieldType.DateTime,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
];

/**
 * Field types that produce date buckets when used as X-axis.
 */
export const DATE_GROUPABLE_FIELD_TYPES: readonly FieldType[] = [
  FieldType.DateTime,
  FieldType.LastEditedTime,
  FieldType.CreatedTime,
];

export function isGroupableFieldType(fieldType: number): boolean {
  return (GROUPABLE_FIELD_TYPES as readonly number[]).includes(fieldType);
}

export function isDateGroupableFieldType(fieldType: number): boolean {
  return (DATE_GROUPABLE_FIELD_TYPES as readonly number[]).includes(fieldType);
}
