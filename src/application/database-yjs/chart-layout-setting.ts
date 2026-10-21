import * as Y from 'yjs';

import {
  CHART_LAYOUT_SETTINGS_KEY,
  ChartLayoutKeys,
  LegacyChartLayoutKeys,
  parseChartAggregationTypePb,
  toCollabChartAggregationType,
} from './chart.type';
import { ChartAggregationType, ChartType } from './chart-enums';
import { DateGroupCondition } from './database.type';

export interface ChartLayoutSettings {
  chartType: ChartType;
  xFieldId: string;
  omitEmptyValues: boolean;
  aggregationType: ChartAggregationType;
  yFieldId?: string;
  dateCondition: DateGroupCondition;
}
import { setYMapBigInt } from './yjs-bigint';

/** Desktop defaults: collab `ChartLayoutSetting::default()` plus a Month date sidecar. */
export const DEFAULT_CHART_LAYOUT_SETTINGS: ChartLayoutSettings = {
  chartType: ChartType.Bar,
  xFieldId: '',
  omitEmptyValues: false,
  aggregationType: ChartAggregationType.Count,
  yFieldId: undefined,
  dateCondition: DateGroupCondition.Month,
};


/** The fields of collab's `ChartLayoutSetting` struct (snake_case on disk). */
interface CollabChartLayoutSetting {
  chartType: ChartType;
  xFieldId: string;
  showEmptyValues: boolean;
  aggregationType: ChartAggregationType;
  yFieldId: string;
}

const COLLAB_DEFAULTS: CollabChartLayoutSetting = {
  chartType: ChartType.Bar,
  xFieldId: '',
  showEmptyValues: false,
  aggregationType: ChartAggregationType.Count,
  yFieldId: '',
};

function isChartType(value: number): value is ChartType {
  return Number.isInteger(value) && value >= ChartType.Bar && value <= ChartType.Number;
}

function isDateCondition(value: number): value is DateGroupCondition {
  return Number.isInteger(value) && value >= DateGroupCondition.Relative && value <= DateGroupCondition.Year;
}

/**
 * A map value the way yrs' `Out::to_json` hands it to desktop's serde decode:
 * nested text types read as their string content, anything else as stored.
 */
function readYrsValue(map: Y.Map<unknown>, key: string): unknown {
  const value = map.get(key);

  return value instanceof Y.Text || value instanceof Y.XmlFragment ? value.toString() : value;
}

/**
 * yrs' serde integer decode: `Any::BigInt` as is, `Any::Number` only without
 * a fractional part (-0 reads as 0). Anything else is a type mismatch.
 */
function toInteger(value: unknown): number | null {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isInteger(value)) return value === 0 ? 0 : value;
  return null;
}

/**
 * Decode the five typed collab fields like desktop's
 * `from_any(...).unwrap_or_default()`: missing keys take their default and
 * unknown keys are ignored, but a single present key with the wrong type or an
 * unknown enum value fails the whole decode and every typed field falls back
 * to its default.
 */
function decodeCollabFields(map: Y.Map<unknown>): CollabChartLayoutSetting {
  const decoded = { ...COLLAB_DEFAULTS };

  if (map.has(ChartLayoutKeys.chartType)) {
    const chartType = toInteger(readYrsValue(map, ChartLayoutKeys.chartType));

    if (chartType === null || !isChartType(chartType)) return { ...COLLAB_DEFAULTS };
    decoded.chartType = chartType;
  }

  if (map.has(ChartLayoutKeys.xFieldId)) {
    const xFieldId = readYrsValue(map, ChartLayoutKeys.xFieldId);

    if (typeof xFieldId !== 'string') return { ...COLLAB_DEFAULTS };
    decoded.xFieldId = xFieldId;
  }

  if (map.has(ChartLayoutKeys.showEmptyValues)) {
    const showEmptyValues = readYrsValue(map, ChartLayoutKeys.showEmptyValues);

    if (typeof showEmptyValues !== 'boolean') return { ...COLLAB_DEFAULTS };
    decoded.showEmptyValues = showEmptyValues;
  }

  if (map.has(ChartLayoutKeys.aggregationType)) {
    const aggregationType = toInteger(readYrsValue(map, ChartLayoutKeys.aggregationType));

    // The collab enum stops at Max; Median / CountValues only live in the sidecar.
    if (aggregationType === null || aggregationType < ChartAggregationType.Count || aggregationType > ChartAggregationType.Max) {
      return { ...COLLAB_DEFAULTS };
    }

    decoded.aggregationType = aggregationType;
  }

  if (map.has(ChartLayoutKeys.yFieldId)) {
    const yFieldId = readYrsValue(map, ChartLayoutKeys.yFieldId);

    if (typeof yFieldId !== 'string') return { ...COLLAB_DEFAULTS };
    decoded.yFieldId = yFieldId;
  }

  return decoded;
}

/** Desktop reads `date_condition` only as BigInt; anything else, or an unknown value, means Month. */
function decodeDateCondition(value: unknown): DateGroupCondition {
  if (typeof value !== 'bigint') return DateGroupCondition.Month;
  const condition = Number(value);

  return isDateCondition(condition) ? condition : DateGroupCondition.Month;
}

/**
 * Desktop honors `aggregation_type_pb` only as BigInt, truncated to 32 bits
 * (`parse_chart_aggregation_type_pb(*n as i32)`), and ignores unknown values.
 */
function decodeAggregationSidecar(value: unknown): ChartAggregationType | null {
  if (typeof value !== 'bigint') return null;
  return parseChartAggregationTypePb(Number(BigInt.asIntN(32, value)));
}

function readDesktopChartSetting(map: Y.Map<unknown>): ChartLayoutSettings {
  const collab = decodeCollabFields(map);

  return {
    chartType: collab.chartType,
    xFieldId: collab.xFieldId,
    omitEmptyValues: collab.showEmptyValues,
    aggregationType: decodeAggregationSidecar(map.get(ChartLayoutKeys.aggregationTypePb)) ?? collab.aggregationType,
    yFieldId: collab.yFieldId || undefined,
    dateCondition: decodeDateCondition(map.get(ChartLayoutKeys.dateCondition)),
  };
}

/**
 * Settings written by web builds before desktop key parity, read the way
 * those builds read them. They stored "show empty values" (missing = show),
 * so it inverts into `omitEmptyValues`; `cumulative` is no longer supported
 * and is ignored. Unknown enum values fall back to their defaults.
 */
function readLegacyChartSetting(map: Y.Map<unknown>): ChartLayoutSettings {
  const chartType = Number(map.get(LegacyChartLayoutKeys.chartType) || 0);
  const aggregationType = parseChartAggregationTypePb(Number(map.get(LegacyChartLayoutKeys.aggregationType) || 0));
  const showEmptyValues = map.get(LegacyChartLayoutKeys.showEmptyValues);
  const yFieldId = map.get(LegacyChartLayoutKeys.yFieldId);
  const storedDateCondition = map.get(LegacyChartLayoutKeys.dateCondition);
  // `DateGroupCondition.Relative` is 0, so only a missing value means Month.
  const dateCondition =
    storedDateCondition === undefined || storedDateCondition === null
      ? DateGroupCondition.Month
      : Number(storedDateCondition);

  return {
    chartType: isChartType(chartType) ? chartType : ChartType.Bar,
    xFieldId: String(map.get(LegacyChartLayoutKeys.xFieldId) || ''),
    omitEmptyValues: showEmptyValues === undefined ? false : !showEmptyValues,
    aggregationType: aggregationType ?? ChartAggregationType.Count,
    yFieldId: yFieldId ? String(yFieldId) : undefined,
    dateCondition: isDateCondition(dateCondition) ? dateCondition : DateGroupCondition.Month,
  };
}

/**
 * Read `view.layout_settings['3']`. Desktop keys win as a whole: once any
 * desktop key exists the map is decoded exactly the way desktop decodes it,
 * so both clients render the same chart. Maps that only carry the old web
 * camelCase keys are read through the legacy decoder. Like desktop, anything
 * other than a Y.Map means there is no chart setting.
 */
export function readChartLayoutSetting(map: unknown): ChartLayoutSettings | null {
  if (!(map instanceof Y.Map)) return null;

  const DESKTOP_KEYS = [ChartLayoutKeys.chartType, ChartLayoutKeys.xFieldId, ChartLayoutKeys.showEmptyValues, ChartLayoutKeys.aggregationType, ChartLayoutKeys.yFieldId, ChartLayoutKeys.dateCondition, ChartLayoutKeys.aggregationTypePb];
  const LEGACY_KEYS = Object.values(LegacyChartLayoutKeys);

  if (DESKTOP_KEYS.some((key) => map.has(key))) {
    return readDesktopChartSetting(map);
  }

  if (LEGACY_KEYS.some((key) => map.has(key))) {
    return readLegacyChartSetting(map);
  }

  return { ...DEFAULT_CHART_LAYOUT_SETTINGS };
}

/**
 * Apply `patch` to `current`, keeping only values desktop's typed settings can
 * hold: an `undefined` or unknown value leaves the field unchanged, except
 * `yFieldId`, where `undefined` or '' clears the Y axis (desktop's empty
 * `y_field_id`).
 */
function mergeChartLayoutSetting(current: ChartLayoutSettings, patch: Partial<ChartLayoutSettings>): ChartLayoutSettings {
  const { chartType, xFieldId, omitEmptyValues, aggregationType, dateCondition } = patch;

  return {
    chartType: chartType !== undefined && isChartType(chartType) ? chartType : current.chartType,
    xFieldId: typeof xFieldId === 'string' ? xFieldId : current.xFieldId,
    omitEmptyValues: typeof omitEmptyValues === 'boolean' ? omitEmptyValues : current.omitEmptyValues,
    aggregationType:
      aggregationType !== undefined && parseChartAggregationTypePb(aggregationType) !== null
        ? aggregationType
        : current.aggregationType,
    yFieldId: 'yFieldId' in patch ? (typeof patch.yFieldId === 'string' && patch.yFieldId) || undefined : current.yFieldId,
    dateCondition: dateCondition !== undefined && isDateCondition(dateCondition) ? dateCondition : current.dateCondition,
  };
}

/** yrs `Map::try_update`: write only when the stored value differs in type or value. */
function setIfChanged(map: Y.Map<unknown>, key: string, value: string | boolean | bigint) {
  const current = map.get(key);

  if (typeof current === typeof value && current === value) return;

  if (typeof value === 'bigint') {
    setYMapBigInt(map, key, value);
  } else {
    map.set(key, value);
  }
}

/**
 * Merge `patch` into the stored setting and write the complete result with
 * the same keys and value types desktop's `v_set_layout_settings` writes:
 * integers as BigInt, `aggregation_type` downgraded to the collab enum and
 * the full aggregation kept in the `aggregation_type_pb` sidecar. Like
 * desktop's `try_update`, keys whose stored value already matches are left
 * untouched. Legacy camelCase keys are not removed so older web builds keep
 * reading their last known values. Runs as one transaction.
 *
 * `map` must already be integrated into a document (see `setYMapBigInt`).
 */
export function writeChartLayoutSetting(map: Y.Map<unknown>, patch: Partial<ChartLayoutSettings>): ChartLayoutSettings {
  const doc = map.doc;

  if (!doc) {
    throw new Error('Cannot write chart settings to a Y.Map that is not in a document');
  }

  const next = mergeChartLayoutSetting(readChartLayoutSetting(map) ?? DEFAULT_CHART_LAYOUT_SETTINGS, patch);

  Y.transact(doc, () => {
    setIfChanged(map, ChartLayoutKeys.chartType, BigInt(next.chartType));
    setIfChanged(map, ChartLayoutKeys.xFieldId, next.xFieldId);
    setIfChanged(map, ChartLayoutKeys.showEmptyValues, next.omitEmptyValues);
    setIfChanged(map, ChartLayoutKeys.aggregationType, BigInt(toCollabChartAggregationType(next.aggregationType)));
    setIfChanged(map, ChartLayoutKeys.yFieldId, next.yFieldId ?? '');
    setIfChanged(map, ChartLayoutKeys.dateCondition, BigInt(next.dateCondition));
    setIfChanged(map, ChartLayoutKeys.aggregationTypePb, BigInt(next.aggregationType));
  });

  return next;
}

/** The chart integers desktop's `v_set_layout_settings` writes as `Any::BigInt`. */


/**
 * Put the BigInt tag back on the chart integers of `layoutSettings['3']`
 * after a JSON round trip. JSON cannot tell `Any::BigInt` from `Any::Number`,
 * so the publish snapshot (`collab.to_json_value()`) and the row-template copy
 * (`templateJson`) hand the integers back as plain numbers, and both clients
 * then ignore the `date_condition` / `aggregation_type_pb` sidecars (Month and
 * the downgraded aggregation show instead). Only safe-integer numbers under
 * the desktop keys are re-tagged; the legacy camelCase keys were always
 * numbers. `layoutSettings` must already be integrated into a document.
 */
export function restoreChartLayoutSettingIntegers(layoutSettings: unknown): void {
  const CHART_INTEGER_KEYS: readonly string[] = [
    ChartLayoutKeys.chartType,
    ChartLayoutKeys.aggregationType,
    ChartLayoutKeys.dateCondition,
    ChartLayoutKeys.aggregationTypePb,
  ];

  if (!(layoutSettings instanceof Y.Map)) return;
  const chart = layoutSettings.get(CHART_LAYOUT_SETTINGS_KEY);

  if (!(chart instanceof Y.Map)) return;
  const integers = CHART_INTEGER_KEYS.flatMap((key) => {
    const value = chart.get(key);

    return typeof value === 'number' && Number.isSafeInteger(value) ? [[key, value] as const] : [];
  });

  if (integers.length === 0) return;
  const doc = chart.doc;

  if (!doc) {
    throw new Error('Cannot restore chart settings in a Y.Map that is not in a document');
  }

  Y.transact(doc, () => {
    integers.forEach(([key, value]) => setYMapBigInt(chart, key, BigInt(value)));
  });
}

export function chartLayoutSettingsEqual(a: ChartLayoutSettings | null, b: ChartLayoutSettings | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.chartType === b.chartType &&
    a.xFieldId === b.xFieldId &&
    a.omitEmptyValues === b.omitEmptyValues &&
    a.aggregationType === b.aggregationType &&
    a.yFieldId === b.yFieldId &&
    a.dateCondition === b.dateCondition
  );
}
