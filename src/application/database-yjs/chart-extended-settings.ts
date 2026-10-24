import { CHART_MAX_DECIMAL_PLACES } from './chart-enums';
import {
  isPlainRecord,
  pickUnknownKeys,
  readBoolean,
  readNumber,
  readStringEnum,
  readStringList,
  sameLayoutValue,
  toPlainValue,
} from './layout-codec';

import type { DateGroupCondition } from './database.type';

/**
 * Chart settings stored under snake_case keys that collab's
 * `ChartLayoutSetting` does not know (`layout_settings['3']`, ARCHITECTURE
 * §3.2). The web twin of Rust `ChartExtendedSettings`.
 *
 * A package that adds a key adds, together: (1) `field: 'snake_key'` to
 * `ChartExtendedLayoutKeys`, (2) the same field to `ChartExtendedSettings`
 * with its documented default, (3) its read in `CHART_EXTENDED_READERS`
 * (through the `layout-codec.ts` readers: absent or wrong-typed values and
 * unknown enum strings read as the default), (4) the key in Rust
 * `ChartExtendedSettings::KEYS` and its `ChartExtendedSettingsPB` field, and
 * (5) fixture cases in `dashboard-parity/layouts/`. Unlike `ChartLayoutKeys`,
 * these keys have no legacy camelCase spelling to mirror.
 */
export const ChartExtendedLayoutKeys = {
  // WP10 style keys.
  decimalPlaces: 'decimal_places',
  colorTheme: 'color_theme',
  showDataLabels: 'show_data_labels',
  legendPosition: 'legend_position',
  // WP11 data configuration keys (Rust `chart_extended_settings.rs`).
  xSort: 'x_sort',
  xManualOrder: 'x_manual_order',
  hiddenGroups: 'hidden_groups',
  xNumberBucketSize: 'x_number_bucket_size',
  xNumberBucketMin: 'x_number_bucket_min',
  xNumberBucketMax: 'x_number_bucket_max',
  xTextGrouping: 'x_text_grouping',
  showTitle: 'show_title',
  numberColor: 'number_color',
  numberConditionalColor: 'number_conditional_color',
  // WP12 sub-group keys (Rust `ChartExtendedSettingsPB` fields 13–15).
  groupByFieldId: 'group_by_field_id',
  groupByDateCondition: 'group_by_date_condition',
  groupStyle: 'group_style',
} as const satisfies Record<string, string>;

export type ChartExtendedField = keyof typeof ChartExtendedLayoutKeys;

/** The persisted `color_theme` values (ARCHITECTURE §3.2). */
export type ChartColorTheme =
  | 'auto'
  | 'colorful'
  | 'colorless'
  | 'blue'
  | 'yellow'
  | 'green'
  | 'purple'
  | 'teal'
  | 'orange'
  | 'pink'
  | 'red';

/** In the order of Notion's Color menu (Auto and Colorful above its divider). */
export const CHART_COLOR_THEMES: readonly ChartColorTheme[] = [
  'auto',
  'colorful',
  'colorless',
  'blue',
  'yellow',
  'green',
  'purple',
  'teal',
  'orange',
  'pink',
  'red',
];

/** The persisted `legend_position` values this client writes. `side` is reserved (P2) and reads as `bottom`. */
export type ChartLegendPosition = 'auto' | 'off' | 'bottom';

export const CHART_LEGEND_POSITIONS: readonly ChartLegendPosition[] = ['auto', 'off', 'bottom'];

export { CHART_MAX_DECIMAL_PLACES };

/** The persisted `x_sort` values (WP11 §1.7); anything else reads as `auto` and is never rewritten. */
export type ChartXSort = 'auto' | 'manual' | 'label_asc' | 'label_desc' | 'value_desc' | 'value_asc';

/** In the order of the Sort by page. */
export const CHART_X_SORTS: readonly ChartXSort[] = ['auto', 'manual', 'label_asc', 'label_desc', 'value_desc', 'value_asc'];

/**
 * The persisted `group_style` values (WP12 §2.1): one segment per group in a
 * stack, the groups side by side, or a 100% stack. Anything else reads as
 * `stacked` and is never rewritten.
 */
export type ChartGroupStyle = 'stacked' | 'grouped' | 'percent';

/** In the order of the Group style control. */
export const CHART_GROUP_STYLES: readonly ChartGroupStyle[] = ['stacked', 'grouped', 'percent'];

export const DEFAULT_CHART_GROUP_STYLE: ChartGroupStyle = 'stacked';

/** `DateGroupCondition.Month`, the default date grouping of a Group by date property. */
const MONTH_DATE_CONDITION = 3 as DateGroupCondition;

/** The persisted `x_text_grouping` values (WP11 §1.6); anything else reads as `exact`. */
export type ChartTextGrouping = 'exact' | 'first_letter';

export const CHART_TEXT_GROUPINGS: readonly ChartTextGrouping[] = ['exact', 'first_letter'];

/** The persisted Number card colors (`number_color`, rule colors, `else_color`; ARCHITECTURE §2.2). */
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

/** The color chips in Notion's capture order: two rows of five. */
export const NUMBER_COLOR_NAMES: readonly ChartNumberColor[] = [
  'default',
  'gray',
  'brown',
  'yellow',
  'orange',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
];

/** The rule operators this client evaluates; a stored rule may carry another string, which never matches. */
export type NumberColorOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

export const NUMBER_COLOR_OPERATOR_VALUES: readonly NumberColorOperator[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'];

/** A dynamic color rule. `operator` and `color` keep unknown strings as written. */
export interface NumberColorRule {
  id: string;
  operator: string;
  value: number;
  color: string;
}

/**
 * `number_conditional_color`, known keys only. A write keeps the unknown keys
 * of the stored object and of each stored rule with the same id
 * (`serializeNumberConditionalColor`).
 */
export interface NumberConditionalColor {
  enabled: boolean;
  rules: NumberColorRule[];
  /** Absent: the static `number_color` applies when no rule matches. */
  elseColor?: string;
}

/** The typed extended chart settings, one field per `ChartExtendedLayoutKeys` entry, defaults applied. */
export interface ChartExtendedSettings {
  /** Fixed fraction digits, 0–5; `null` is auto (absent, null, a fraction, a string or out of range). */
  decimalPlaces: number | null;
  colorTheme: ChartColorTheme;
  showDataLabels: boolean;
  legendPosition: ChartLegendPosition;
  xSort: ChartXSort;
  /** Group keys in the order a manual sort shows first. */
  xManualOrder: string[];
  /** Group keys left out of the chart. Keys that match no group are kept as written. */
  hiddenGroups: string[];
  /** Number X axis: the range size (> 0); `null` is auto. */
  xNumberBucketSize: number | null;
  /** Number X axis: where the ranges start; `null` is the data minimum. */
  xNumberBucketMin: number | null;
  /** Number X axis: where the ranges end; `null` is the data maximum. */
  xNumberBucketMax: number | null;
  xTextGrouping: ChartTextGrouping;
  /** Number card: whether the caption shows. */
  showTitle: boolean;
  numberColor: ChartNumberColor;
  /** `null` when the chart has none (dynamic color off and never set). */
  numberConditionalColor: NumberConditionalColor | null;
  /**
   * The Group by property (WP12); `''` is none. Effective only for a field a
   * chart can group by that is not the X field, on a bar or line chart
   * (`resolveGroupByFieldId`); the stored id is never rewritten otherwise.
   */
  groupByFieldId: string;
  /** How a Group by date property is bucketed (0–4); anything else is Month. */
  groupByDateCondition: DateGroupCondition;
  /** Stacked, grouped or percent bars; only bar charts with an effective Group by use it. */
  groupStyle: ChartGroupStyle;
}

/**
 * A typed extended-settings write: only the fields present are written, and
 * `null` resets a key whose default is "absent" (readers treat a stored `null`
 * as absent; see `writeChartExtendedValue`).
 */
export type ChartExtendedSettingsUpdate = {
  [Field in keyof ChartExtendedSettings]?: ChartExtendedSettings[Field] | null;
};

export const DEFAULT_CHART_EXTENDED_SETTINGS: ChartExtendedSettings = {
  decimalPlaces: null,
  colorTheme: 'auto',
  showDataLabels: true,
  legendPosition: 'auto',
  xSort: 'auto',
  xManualOrder: [],
  hiddenGroups: [],
  xNumberBucketSize: null,
  xNumberBucketMin: null,
  xNumberBucketMax: null,
  xTextGrouping: 'exact',
  showTitle: true,
  numberColor: 'default',
  numberConditionalColor: null,
  groupByFieldId: '',
  groupByDateCondition: MONTH_DATE_CONDITION,
  groupStyle: DEFAULT_CHART_GROUP_STYLE,
};

/** The three bucket keys are one setting: when one of them changes, a write stores all three it was given. */
export const CHART_NUMBER_BUCKET_FIELDS = ['xNumberBucketSize', 'xNumberBucketMin', 'xNumberBucketMax'] as const;

/** A whole number 0–5 (a desktop bigint or a JS number); anything else, fractions included, is auto. */
export function parseChartDecimalPlaces(value: unknown): number | null {
  const number = typeof value === 'bigint' ? Number(value) : value;

  return typeof number === 'number' && Number.isInteger(number) && number >= 0 && number <= CHART_MAX_DECIMAL_PLACES
    ? number
    : null;
}

export function parseChartColorTheme(value: unknown): ChartColorTheme {
  return readStringEnum(value, CHART_COLOR_THEMES, 'auto');
}

export function parseChartLegendPosition(value: unknown): ChartLegendPosition {
  return value === 'side' ? 'bottom' : readStringEnum(value, CHART_LEGEND_POSITIONS, 'auto');
}

export function parseChartShowDataLabels(value: unknown): boolean {
  return readBoolean(value, true);
}

export function parseChartXSort(value: unknown): ChartXSort {
  return readStringEnum(value, CHART_X_SORTS, 'auto');
}

export function parseChartTextGrouping(value: unknown): ChartTextGrouping {
  return readStringEnum(value, CHART_TEXT_GROUPINGS, 'exact');
}

/** A Number card color; an unknown name renders as `default` (the stored name is kept). */
export function parseChartNumberColor(value: unknown): ChartNumberColor {
  return readStringEnum(value, NUMBER_COLOR_NAMES, 'default');
}

/** The Group by property id: a string (`''` is none); anything else reads as none. */
export function parseChartGroupByFieldId(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A whole number 0–4 (a desktop bigint or a JS number); anything else, fractions included, is Month. */
export function parseChartGroupByDateCondition(value: unknown): DateGroupCondition {
  const number = readNumber(value);

  return number !== undefined && Number.isInteger(number) && number >= 0 && number <= 4
    ? (number as DateGroupCondition)
    : MONTH_DATE_CONDITION;
}

export function parseChartGroupStyle(value: unknown): ChartGroupStyle {
  return readStringEnum(value, CHART_GROUP_STYLES, DEFAULT_CHART_GROUP_STYLE);
}

/** The bucket size: a finite number above zero (number or bigint); anything else is auto. */
export function parseChartBucketSize(value: unknown): number | null {
  const number = readNumber(value);

  return number !== undefined && number > 0 ? number : null;
}

/** A bucket bound: a finite number (number or bigint); anything else is the data bound. */
export function parseChartBucketBound(value: unknown): number | null {
  return readNumber(value) ?? null;
}

const CONDITIONAL_COLOR_KNOWN_KEYS: ReadonlySet<string> = new Set(['enabled', 'rules', 'else_color']);
const CONDITIONAL_COLOR_RULE_KNOWN_KEYS: ReadonlySet<string> = new Set(['id', 'operator', 'value', 'color']);

function parseNumberColorRule(value: unknown): NumberColorRule | null {
  const rule = toPlainValue(value);

  if (!isPlainRecord(rule)) return null;
  const ruleValue = readNumber(rule.value);

  if (typeof rule.id !== 'string' || typeof rule.operator !== 'string' || typeof rule.color !== 'string') return null;
  if (ruleValue === undefined) return null;
  return { id: rule.id, operator: rule.operator, value: ruleValue, color: rule.color };
}

/**
 * `number_conditional_color` as Rust reads it: `null` unless it is a map; a
 * rule needs a string id, operator and color and a finite value, others are
 * skipped; unknown operators and colors are kept as written.
 */
export function parseNumberConditionalColor(value: unknown): NumberConditionalColor | null {
  const stored = toPlainValue(value);

  if (!isPlainRecord(stored)) return null;
  const rules = Array.isArray(stored.rules)
    ? stored.rules.map(parseNumberColorRule).filter((rule): rule is NumberColorRule => rule !== null)
    : [];
  const color: NumberConditionalColor = { enabled: readBoolean(stored.enabled, false), rules };

  if (typeof stored.else_color === 'string') color.elseColor = stored.else_color;
  return color;
}

/** The persisted shape of a conditional color, known keys only (`else_color` only when set). */
export function numberConditionalColorToPersisted(color: NumberConditionalColor): Record<string, unknown> {
  const persisted: Record<string, unknown> = {
    enabled: color.enabled,
    rules: color.rules.map((rule) => ({ id: rule.id, operator: rule.operator, value: rule.value, color: rule.color })),
  };

  if (color.elseColor !== undefined) persisted.else_color = color.elseColor;
  return persisted;
}

/**
 * The value to store for `color` over `stored` (ARCHITECTURE §3.1 rule 4):
 * the typed fields first, then the unknown keys of the stored object and, per
 * rule, of the stored rule with the same id. `null` resets the key.
 */
export function serializeNumberConditionalColor(
  color: NumberConditionalColor | null,
  stored: unknown
): Record<string, unknown> | null {
  if (color === null) return null;
  const next = numberConditionalColorToPersisted(color);
  const previous = toPlainValue(stored);

  if (!isPlainRecord(previous)) return next;
  const storedRules = new Map<string, Record<string, unknown>>();

  if (Array.isArray(previous.rules)) {
    previous.rules.forEach((rule) => {
      const plain = toPlainValue(rule);

      if (isPlainRecord(plain) && typeof plain.id === 'string' && !storedRules.has(plain.id)) {
        storedRules.set(plain.id, plain);
      }
    });
  }

  const rules = (next.rules as Record<string, unknown>[]).map((rule) => {
    const storedRule = storedRules.get(rule.id as string);
    const extras = storedRule ? pickUnknownKeys(storedRule, CONDITIONAL_COLOR_RULE_KNOWN_KEYS) : undefined;

    return extras ? { ...extras, ...rule } : rule;
  });

  return { ...pickUnknownKeys(previous, CONDITIONAL_COLOR_KNOWN_KEYS), ...next, rules };
}

/** How each key reads; a stored value and a written one are compared through it. */
const CHART_EXTENDED_READERS: { [Field in ChartExtendedField]: (value: unknown) => ChartExtendedSettings[Field] } = {
  decimalPlaces: parseChartDecimalPlaces,
  colorTheme: parseChartColorTheme,
  showDataLabels: parseChartShowDataLabels,
  legendPosition: parseChartLegendPosition,
  xSort: parseChartXSort,
  xManualOrder: readStringList,
  hiddenGroups: readStringList,
  xNumberBucketSize: parseChartBucketSize,
  xNumberBucketMin: parseChartBucketBound,
  xNumberBucketMax: parseChartBucketBound,
  xTextGrouping: parseChartTextGrouping,
  showTitle: (value) => readBoolean(value, true),
  numberColor: parseChartNumberColor,
  numberConditionalColor: parseNumberConditionalColor,
  groupByFieldId: parseChartGroupByFieldId,
  groupByDateCondition: parseChartGroupByDateCondition,
  groupStyle: parseChartGroupStyle,
};

const CHART_EXTENDED_FIELDS = Object.keys(ChartExtendedLayoutKeys) as ChartExtendedField[];

/** Projects the persisted chart map onto `ChartExtendedSettings`; absent keys read as their defaults. */
export function parseChartExtendedSettings(map: { get(key: string): unknown }): ChartExtendedSettings {
  const settings: Record<string, unknown> = {};

  CHART_EXTENDED_FIELDS.forEach((field) => {
    settings[field] = CHART_EXTENDED_READERS[field](map.get(ChartExtendedLayoutKeys[field]));
  });
  return settings as unknown as ChartExtendedSettings;
}

/** A typed value in its persisted shape: arrays as fresh plain arrays, the conditional color merged over `stored`. */
function toPersistedValue(field: ChartExtendedField, value: unknown, stored: unknown): unknown {
  if (field === 'numberConditionalColor') {
    return serializeNumberConditionalColor(value as NumberConditionalColor | null, stored);
  }

  if (Array.isArray(value)) return [...value];
  return value;
}

/**
 * Writes one extended key in its persisted shape unless the stored value
 * reads the same, like Rust `write_changed_to`: picking Auto again over an
 * unknown `color_theme` or an out-of-range `decimal_places` writes nothing,
 * so the value another client stored survives. `null` resets the key; it is
 * written only over a value that reads differently. Returns whether it wrote.
 */
export function writeChartExtendedValue(
  map: { get(key: string): unknown; set(key: string, value: unknown): unknown },
  field: ChartExtendedField,
  value: unknown
): boolean {
  const key = ChartExtendedLayoutKeys[field];
  const read: (value: unknown) => unknown = CHART_EXTENDED_READERS[field];
  const stored = map.get(key);
  const persisted = toPersistedValue(field, value, stored);

  if (sameLayoutValue(read(stored), read(persisted))) return false;
  map.set(key, persisted);
  return true;
}

/**
 * Writes every field present in `update` (`undefined` skips a field) through
 * `writeChartExtendedValue`, except the bucket triple: when one bucket key
 * given reads differently from the stored one, all the bucket keys given are
 * stored, like Rust `write_changed_to`.
 */
export function writeChartExtendedUpdate(
  map: { get(key: string): unknown; set(key: string, value: unknown): unknown },
  update: ChartExtendedSettingsUpdate
) {
  const values: Partial<Record<ChartExtendedField, unknown>> = update;
  const bucketFields: readonly ChartExtendedField[] = CHART_NUMBER_BUCKET_FIELDS;
  const bucketsChanged = bucketFields.some((field) => {
    const value = values[field];
    const read: (value: unknown) => unknown = CHART_EXTENDED_READERS[field];

    return value !== undefined && !sameLayoutValue(read(map.get(ChartExtendedLayoutKeys[field])), read(value));
  });

  CHART_EXTENDED_FIELDS.forEach((field) => {
    const value = values[field];

    if (value === undefined) return;
    if (bucketFields.includes(field)) {
      if (bucketsChanged) map.set(ChartExtendedLayoutKeys[field], value);
      return;
    }

    writeChartExtendedValue(map, field, value);
  });
}

/** A parsed field compared in its persisted shape, so an absent `elseColor` equals an unset one. */
function comparableValue(field: ChartExtendedField, value: unknown): unknown {
  if (field === 'numberConditionalColor' && value) {
    return numberConditionalColorToPersisted(value as NumberConditionalColor);
  }

  return value;
}

/** Field-by-field equality of two parsed extended settings (a missing value is the parsed default). */
export function sameChartExtendedSettings(
  a: ChartExtendedSettings | undefined,
  b: ChartExtendedSettings | undefined
): boolean {
  if (a === b) return true;
  const left: Record<ChartExtendedField, unknown> = { ...DEFAULT_CHART_EXTENDED_SETTINGS, ...a };
  const right: Record<ChartExtendedField, unknown> = { ...DEFAULT_CHART_EXTENDED_SETTINGS, ...b };

  return CHART_EXTENDED_FIELDS.every((field) =>
    sameLayoutValue(comparableValue(field, left[field]), comparableValue(field, right[field]))
  );
}
