import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import * as Y from 'yjs';

import {
  chartLayoutSettingsEqual,
  DEFAULT_CHART_LAYOUT_SETTINGS,
  readChartLayoutSetting,
  restoreChartLayoutSettingIntegers,
  writeChartLayoutSetting,
} from '@/application/database-yjs/chart-layout-setting';
import {
  CHART_LAYOUT_SETTINGS_KEY,
  ChartAggregationType,
  ChartLayoutKeys,
  type ChartLayoutSettings,
  ChartType,
  LegacyChartLayoutKeys,
  parseChartAggregationTypePb,
  toCollabChartAggregationType,
} from '@/application/database-yjs/chart.type';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { DateGroupCondition } from '@/application/database-yjs/database.type';
import { useUpdateChartSetting } from '@/application/database-yjs/dispatch';
import { useChartLayoutSetting } from '@/application/database-yjs/selector';
import { setYMapBigInt } from '@/application/database-yjs/yjs-bigint';
import {
  type YDatabase,
  type YDatabaseLayoutSettings,
  type YDatabaseView,
  type YDatabaseViews,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  type YSharedRoot,
} from '@/application/types';

type Entries = Record<string, unknown>;

const big = (value: number | string) => BigInt(value);

/** Write raw entries; bigints go through `setYMapBigInt` like desktop's `Any::BigInt`. */
function seed(map: Y.Map<unknown>, entries: Entries) {
  Object.entries(entries).forEach(([key, value]) => {
    if (typeof value === 'bigint') {
      setYMapBigInt(map, key, value);
    } else {
      map.set(key, value);
    }
  });
}

function createChartMap(entries: Entries = {}, clientID = 1) {
  const doc = new Y.Doc();

  doc.clientID = clientID;
  const map = new Y.Map<unknown>();

  doc.getMap('layout_settings').set(CHART_LAYOUT_SETTINGS_KEY, map);
  seed(map, entries);
  return { doc, map };
}

function chartMapOf(doc: Y.Doc) {
  return doc.getMap('layout_settings').get(CHART_LAYOUT_SETTINGS_KEY) as Y.Map<unknown>;
}

function replicate(doc: Y.Doc, version: 'v1' | 'v2' = 'v1', clientID = 99) {
  const replica = new Y.Doc();

  replica.clientID = clientID;
  if (version === 'v1') {
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
  } else {
    Y.applyUpdateV2(replica, Y.encodeStateAsUpdateV2(doc));
  }

  return replica;
}

function rawEntries(map: Y.Map<unknown>, keys: readonly string[] = Object.values(ChartLayoutKeys)) {
  return Object.fromEntries(keys.filter((key) => map.has(key)).map((key) => [key, map.get(key)]));
}

function setting(overrides: Partial<ChartLayoutSettings> = {}): ChartLayoutSettings {
  return { ...DEFAULT_CHART_LAYOUT_SETTINGS, ...overrides };
}

/** Exactly what desktop's `v_set_layout_settings` writes for Line / Median / Relative. */
const DESKTOP_LINE_MEDIAN_RELATIVE: Entries = {
  chart_type: big(1),
  x_field_id: 'x-field',
  show_empty_values: true,
  aggregation_type: big(0),
  y_field_id: 'y-field',
  date_condition: big(0),
  aggregation_type_pb: big(5),
};

/** Mirrors `chart_view_with_sidecar` in flowy-database2-data `util.rs`. */
function chartViewWithSidecar(typedAggregation: bigint, sidecar?: bigint) {
  return createChartMap({
    chart_type: big(0),
    x_field_id: 'field_x',
    y_field_id: 'field_y',
    show_empty_values: false,
    aggregation_type: typedAggregation,
    ...(sidecar === undefined ? {} : { aggregation_type_pb: sidecar }),
  }).map;
}

describe('readChartLayoutSetting', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a plain object', { chart_type: 1 }],
    ['a string', 'chart'],
    ['a Y.Array', new Y.Array()],
  ])('returns null for %s, like desktop skips layout settings that are not maps', (_, value) => {
    expect(readChartLayoutSetting(value)).toBeNull();
  });

  it('returns the desktop defaults for an empty map', () => {
    const { map } = createChartMap();
    const result = readChartLayoutSetting(map);

    expect(result).toEqual(DEFAULT_CHART_LAYOUT_SETTINGS);
    expect(result).not.toBe(DEFAULT_CHART_LAYOUT_SETTINGS);
  });

  it('decodes the key/type set desktop writes', () => {
    const { map } = createChartMap(DESKTOP_LINE_MEDIAN_RELATIVE);

    expect(readChartLayoutSetting(map)).toEqual({
      chartType: ChartType.Line,
      xFieldId: 'x-field',
      omitEmptyValues: true,
      aggregationType: ChartAggregationType.Median,
      yFieldId: 'y-field',
      dateCondition: DateGroupCondition.Relative,
    });
  });

  it('reads `show_empty_values` as the omit-empty-values flag, like desktop', () => {
    expect(readChartLayoutSetting(createChartMap({ show_empty_values: true }).map)?.omitEmptyValues).toBe(true);
    expect(readChartLayoutSetting(createChartMap({ show_empty_values: false }).map)?.omitEmptyValues).toBe(false);
  });

  it('reads an empty y_field_id as no Y axis', () => {
    expect(readChartLayoutSetting(createChartMap({ y_field_id: '' }).map)?.yFieldId).toBeUndefined();
  });

  describe('aggregation_type_pb sidecar', () => {
    it('restores CountValues on read (sidecar_restores_count_values_on_read)', () => {
      expect(readChartLayoutSetting(chartViewWithSidecar(big(0), big(6)))?.aggregationType).toBe(
        ChartAggregationType.CountValues
      );
    });

    it('restores Median on read (sidecar_restores_median_on_read)', () => {
      expect(readChartLayoutSetting(chartViewWithSidecar(big(0), big(5)))?.aggregationType).toBe(
        ChartAggregationType.Median
      );
    });

    it.each([
      [0, ChartAggregationType.Count],
      [1, ChartAggregationType.Sum],
      [2, ChartAggregationType.Average],
      [3, ChartAggregationType.Min],
      [4, ChartAggregationType.Max],
    ])('passes the 5-variant aggregation %i through (sidecar_passes_through_5_variant_aggregations)', (value, expected) => {
      expect(readChartLayoutSetting(chartViewWithSidecar(big(value), big(value)))?.aggregationType).toBe(expected);
    });

    it('keeps the downgraded typed value without a sidecar (missing_sidecar_keeps_legacy_downgraded_behavior)', () => {
      expect(readChartLayoutSetting(chartViewWithSidecar(big(0)))?.aggregationType).toBe(ChartAggregationType.Count);
      expect(readChartLayoutSetting(chartViewWithSidecar(big(3)))?.aggregationType).toBe(ChartAggregationType.Min);
    });

    it.each([big(99), big(7), big(-1), big(2147483647)])(
      'falls back to the typed value for the unknown sidecar %s (malformed_sidecar_value_falls_back_to_typed_value)',
      (sidecar) => {
        expect(readChartLayoutSetting(chartViewWithSidecar(big(2), sidecar))?.aggregationType).toBe(
          ChartAggregationType.Average
        );
      }
    );

    // JSON snapshots (published pages, template copies) erase the tag; those
    // paths run `restoreChartLayoutSettingIntegers` before reading.
    it.each([
      ['a JS number', 6],
      ['a string', '6'],
      ['a boolean', true],
      ['null', null],
    ])('ignores a sidecar stored as %s, which is not Any::BigInt', (_, sidecar) => {
      const { map } = createChartMap({ aggregation_type: big(1), aggregation_type_pb: sidecar });

      expect(readChartLayoutSetting(map)?.aggregationType).toBe(ChartAggregationType.Sum);
    });

    it.each([
      // `parse_chart_aggregation_type_pb(*n as i32)` keeps only the low 32 bits.
      [big('4294967301'), ChartAggregationType.Median],
      [big('-4294967290'), ChartAggregationType.CountValues],
      [big('-9223372036854775808'), ChartAggregationType.Count],
      [big('4294967303'), ChartAggregationType.Max],
    ])('truncates the sidecar %s to 32 bits like desktop', (sidecar, expected) => {
      const { map } = createChartMap({ aggregation_type: big(4), aggregation_type_pb: sidecar });

      expect(readChartLayoutSetting(map)?.aggregationType).toBe(expected);
    });

    it('applies when it is the only stored key', () => {
      const { map } = createChartMap({ aggregation_type_pb: big(5) });

      expect(readChartLayoutSetting(map)).toEqual(setting({ aggregationType: ChartAggregationType.Median }));
    });
  });

  describe('date_condition sidecar', () => {
    it.each([
      [0, DateGroupCondition.Relative],
      [1, DateGroupCondition.Day],
      [2, DateGroupCondition.Week],
      [3, DateGroupCondition.Month],
      [4, DateGroupCondition.Year],
    ])('maps %i to its date grouping', (value, expected) => {
      const { map } = createChartMap({ chart_type: big(0), date_condition: big(value) });

      expect(readChartLayoutSetting(map)?.dateCondition).toBe(expected);
    });

    it('defaults to Month when it is missing (chart_date_condition_defaults_to_month)', () => {
      const { map } = createChartMap({ chart_type: big(2), x_field_id: 'x' });

      expect(readChartLayoutSetting(map)?.dateCondition).toBe(DateGroupCondition.Month);
    });

    it.each([
      ['a JS number', 1],
      ['a string', '1'],
      ['null', null],
    ])('reads Month when it is stored as %s, which is not Any::BigInt', (_, value) => {
      const { map } = createChartMap({ chart_type: big(0), date_condition: value });

      expect(readChartLayoutSetting(map)?.dateCondition).toBe(DateGroupCondition.Month);
    });

    it.each([big(5), big(-1), big('4294967297')])('reads Month for the unknown value %s (no 32-bit truncation)', (value) => {
      const { map } = createChartMap({ date_condition: value });

      expect(readChartLayoutSetting(map)?.dateCondition).toBe(DateGroupCondition.Month);
    });
  });

  describe('typed fields decode all-or-nothing, like from_any(...).unwrap_or_default()', () => {
    const VALID: Entries = {
      chart_type: big(2),
      x_field_id: 'x',
      show_empty_values: true,
      aggregation_type: big(3),
      y_field_id: 'y',
      date_condition: big(4),
      aggregation_type_pb: big(3),
    };
    // Typed fields reset to their defaults; the BigInt sidecars still apply.
    const RESET = setting({ aggregationType: ChartAggregationType.Min, dateCondition: DateGroupCondition.Year });

    it('decodes the valid baseline', () => {
      expect(readChartLayoutSetting(createChartMap(VALID).map)).toEqual({
        chartType: ChartType.HorizontalBar,
        xFieldId: 'x',
        omitEmptyValues: true,
        aggregationType: ChartAggregationType.Min,
        yFieldId: 'y',
        dateCondition: DateGroupCondition.Year,
      });
    });

    it.each<[string, () => unknown]>([
      ['chart_type', () => big(4)],
      ['chart_type', () => big(-1)],
      ['chart_type', () => big(256)],
      ['chart_type', () => big('1099511627777')],
      ['chart_type', () => 1.5],
      ['chart_type', () => 2147483649],
      ['chart_type', () => NaN],
      ['chart_type', () => Infinity],
      ['chart_type', () => '1'],
      ['chart_type', () => true],
      ['chart_type', () => null],
      ['chart_type', () => undefined],
      ['chart_type', () => [1]],
      ['chart_type', () => ({ value: 1 })],
      ['chart_type', () => new Y.Map()],
      ['x_field_id', () => 7],
      ['x_field_id', () => big(7)],
      ['x_field_id', () => null],
      ['x_field_id', () => undefined],
      ['x_field_id', () => true],
      ['x_field_id', () => ['x']],
      ['x_field_id', () => ({ id: 'x' })],
      ['x_field_id', () => new Uint8Array([120])],
      ['x_field_id', () => new Y.Map()],
      ['show_empty_values', () => 1],
      ['show_empty_values', () => 'true'],
      ['show_empty_values', () => null],
      ['show_empty_values', () => big(1)],
      ['aggregation_type', () => big(5)],
      ['aggregation_type', () => big(6)],
      ['aggregation_type', () => big(-1)],
      ['aggregation_type', () => 2.5],
      ['aggregation_type', () => '1'],
      ['y_field_id', () => 7],
      ['y_field_id', () => null],
      ['y_field_id', () => undefined],
      ['y_field_id', () => false],
    ])('resets every typed field when %s holds %p, while sidecars still apply', (key, value) => {
      const { map } = createChartMap({ ...VALID, [key]: value() });

      expect(readChartLayoutSetting(map)).toEqual(RESET);
    });

    it('accepts JS numbers without a fractional part, as yrs accepts Any::Number', () => {
      const { map } = createChartMap({ ...VALID, chart_type: 3, aggregation_type: 4.0 });

      expect(readChartLayoutSetting(map)).toEqual(
        expect.objectContaining({ chartType: ChartType.Donut, aggregationType: ChartAggregationType.Min })
      );
      // Without a sidecar the typed number is the aggregation.
      expect(readChartLayoutSetting(createChartMap({ aggregation_type: 4 }).map)?.aggregationType).toBe(
        ChartAggregationType.Max
      );
    });

    it('reads -0 as 0', () => {
      const result = readChartLayoutSetting(createChartMap({ chart_type: -0, x_field_id: 'x' }).map);

      expect(Object.is(result?.chartType, ChartType.Bar)).toBe(true);
      expect(result?.xFieldId).toBe('x');
    });

    it('reads nested text types as their string, like yrs Out::to_json', () => {
      const { map } = createChartMap({
        chart_type: big(1),
        x_field_id: new Y.Text('text-x'),
        y_field_id: new Y.XmlFragment(),
      });

      expect(readChartLayoutSetting(map)).toEqual(
        setting({ chartType: ChartType.Line, xFieldId: 'text-x', yFieldId: undefined })
      );
    });

    it('ignores unknown keys, including legacy keys next to desktop keys', () => {
      const { map } = createChartMap({
        ...VALID,
        chartType: 3,
        showEmptyValues: 'garbage',
        extra: { nested: [1, null, 'a'] },
        extra_map: new Y.Map(),
        extra_binary: new Uint8Array([1, 2]),
        extra_undefined: undefined,
      });

      expect(readChartLayoutSetting(map)).toEqual(readChartLayoutSetting(createChartMap(VALID).map));
    });

    it('ignores deleted keys', () => {
      const { map } = createChartMap({ ...VALID, chart_type: big(9) });

      map.delete('chart_type');
      expect(readChartLayoutSetting(map)?.chartType).toBe(ChartType.Bar);
      expect(readChartLayoutSetting(map)?.xFieldId).toBe('x');
    });

    it('reads the latest value of an overwritten key', () => {
      const { map } = createChartMap({ ...VALID, chart_type: 9 });

      setYMapBigInt(map, 'chart_type', big(3));
      expect(readChartLayoutSetting(map)?.chartType).toBe(ChartType.Donut);
    });
  });

  describe('legacy camelCase settings from older web builds', () => {
    const LEGACY: Entries = {
      chartType: 3,
      xFieldId: 'lx',
      showEmptyValues: true,
      aggregationType: 6,
      yFieldId: 'ly',
      cumulative: true,
      dateCondition: 1,
    };

    it('decodes them when no desktop key exists', () => {
      expect(readChartLayoutSetting(createChartMap(LEGACY).map)).toEqual({
        chartType: ChartType.Donut,
        xFieldId: 'lx',
        omitEmptyValues: false,
        aggregationType: ChartAggregationType.CountValues,
        yFieldId: 'ly',
        dateCondition: DateGroupCondition.Day,
      });
    });

    it.each([
      ['true', true, false],
      ['false', false, true],
      ['missing', undefined, false],
      ['null', null, true],
    ])('inverts showEmptyValues %s into omitEmptyValues like the old reader', (_, showEmptyValues, omit) => {
      const entries: Entries = { ...LEGACY };

      delete entries.showEmptyValues;
      if (showEmptyValues !== undefined) entries.showEmptyValues = showEmptyValues;

      expect(readChartLayoutSetting(createChartMap(entries).map)?.omitEmptyValues).toBe(omit);
    });

    it.each([
      ['Relative (0)', 0, DateGroupCondition.Relative],
      ['missing', undefined, DateGroupCondition.Month],
      ['null', null, DateGroupCondition.Month],
      ['unknown', 9, DateGroupCondition.Month],
      ['fractional', 1.5, DateGroupCondition.Month],
      ['not a number', 'week', DateGroupCondition.Month],
    ])('reads a %s dateCondition', (_, value, expected) => {
      const entries: Entries = { ...LEGACY, dateCondition: value };

      if (value === undefined) delete entries.dateCondition;
      expect(readChartLayoutSetting(createChartMap(entries).map)?.dateCondition).toBe(expected);
    });

    it.each([7, -1, 1.5, 'abc'])('falls back to Bar for the unknown chartType %p', (value) => {
      expect(readChartLayoutSetting(createChartMap({ ...LEGACY, chartType: value }).map)?.chartType).toBe(ChartType.Bar);
    });

    it.each([9, -1, 2.5, 'abc'])('falls back to Count for the unknown aggregationType %p', (value) => {
      expect(readChartLayoutSetting(createChartMap({ ...LEGACY, aggregationType: value }).map)?.aggregationType).toBe(
        ChartAggregationType.Count
      );
    });

    it('treats empty field ids as unset and ignores cumulative', () => {
      expect(readChartLayoutSetting(createChartMap({ xFieldId: '', yFieldId: '', cumulative: true }).map)).toEqual(
        DEFAULT_CHART_LAYOUT_SETTINGS
      );
    });
  });

  describe('desktop keys take precedence', () => {
    const LEGACY: Entries = { chartType: 3, xFieldId: 'lx', showEmptyValues: false, aggregationType: 5, yFieldId: 'ly' };

    it('decodes desktop keys as a whole when legacy keys disagree', () => {
      const { map } = createChartMap({ ...LEGACY, chart_type: big(1) });

      expect(readChartLayoutSetting(map)).toEqual(setting({ chartType: ChartType.Line }));
    });

    it.each(Object.values(ChartLayoutKeys))('switches to the desktop decoder when only %s exists', (key) => {
      const defaults: Entries = {
        chart_type: big(0),
        x_field_id: '',
        show_empty_values: false,
        aggregation_type: big(0),
        y_field_id: '',
        date_condition: big(3),
        aggregation_type_pb: big(0),
      };
      const { map } = createChartMap({ ...LEGACY, [key]: defaults[key] });

      expect(readChartLayoutSetting(map)).toEqual(DEFAULT_CHART_LAYOUT_SETTINGS);
    });

    it('ignores later legacy writes once desktop keys exist', () => {
      const { map } = createChartMap(LEGACY);

      writeChartLayoutSetting(map, { chartType: ChartType.Line });
      const written = readChartLayoutSetting(map);

      map.set(LegacyChartLayoutKeys.chartType, ChartType.Bar);
      map.set(LegacyChartLayoutKeys.xFieldId, 'changed-by-old-build');
      expect(readChartLayoutSetting(map)).toEqual(written);
    });
  });
});

describe('writeChartLayoutSetting', () => {
  it('writes the full desktop key set with desktop value types on the first write', () => {
    const { map } = createChartMap();
    const result = writeChartLayoutSetting(map, {
      chartType: ChartType.Donut,
      xFieldId: 'x',
      omitEmptyValues: true,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: 'y',
      dateCondition: DateGroupCondition.Week,
    });

    expect(Array.from(map.keys()).sort()).toEqual(Object.values(ChartLayoutKeys).sort());
    expect(rawEntries(map)).toEqual({
      chart_type: big(3),
      x_field_id: 'x',
      show_empty_values: true,
      aggregation_type: big(1),
      y_field_id: 'y',
      date_condition: big(2),
      aggregation_type_pb: big(1),
    });
    expect(typeof map.get(ChartLayoutKeys.chartType)).toBe('bigint');
    expect(typeof map.get(ChartLayoutKeys.aggregationType)).toBe('bigint');
    expect(typeof map.get(ChartLayoutKeys.dateCondition)).toBe('bigint');
    expect(typeof map.get(ChartLayoutKeys.aggregationTypePb)).toBe('bigint');
    expect(result).toEqual(readChartLayoutSetting(map));
  });

  it('writes the defaults for an empty patch on an empty map', () => {
    const { map } = createChartMap();

    expect(writeChartLayoutSetting(map, {})).toEqual(DEFAULT_CHART_LAYOUT_SETTINGS);
    expect(rawEntries(map)).toEqual({
      chart_type: big(0),
      x_field_id: '',
      show_empty_values: false,
      aggregation_type: big(0),
      y_field_id: '',
      date_condition: big(3),
      aggregation_type_pb: big(0),
    });
  });

  it.each([
    [ChartAggregationType.Count, 0],
    [ChartAggregationType.Sum, 1],
    [ChartAggregationType.Average, 2],
    [ChartAggregationType.Min, 3],
    [ChartAggregationType.Max, 4],
    [ChartAggregationType.Median, 0],
    [ChartAggregationType.CountValues, 0],
  ])(
    'stores aggregation %i as the collab value %i plus the full value in the sidecar',
    (aggregationType, collabValue) => {
      const { doc, map } = createChartMap();

      writeChartLayoutSetting(map, { aggregationType, yFieldId: 'y' });

      expect(map.get(ChartLayoutKeys.aggregationType)).toBe(big(collabValue));
      expect(map.get(ChartLayoutKeys.aggregationTypePb)).toBe(big(aggregationType));
      // chart_aggregation_sidecar_persists_after_close_reopen
      expect(readChartLayoutSetting(chartMapOf(replicate(doc)))?.aggregationType).toBe(aggregationType);
    }
  );

  it('stores Relative (0) instead of dropping it', () => {
    const { map } = createChartMap();

    writeChartLayoutSetting(map, { dateCondition: DateGroupCondition.Relative });
    expect(map.get(ChartLayoutKeys.dateCondition)).toBe(big(0));
    expect(readChartLayoutSetting(map)?.dateCondition).toBe(DateGroupCondition.Relative);
  });

  it('switches between date conditions (chart_date_condition_switch_between_conditions)', () => {
    const { doc, map } = createChartMap();

    for (const condition of [
      DateGroupCondition.Day,
      DateGroupCondition.Year,
      DateGroupCondition.Week,
      DateGroupCondition.Relative,
      DateGroupCondition.Month,
    ]) {
      writeChartLayoutSetting(map, { xFieldId: 'date', dateCondition: condition });
      expect(readChartLayoutSetting(map)?.dateCondition).toBe(condition);
      expect(readChartLayoutSetting(chartMapOf(replicate(doc)))?.dateCondition).toBe(condition);
    }
  });

  it('merges a patch into the stored setting (chart_date_condition_change_preserves_other_settings)', () => {
    const { map } = createChartMap();

    writeChartLayoutSetting(map, {
      chartType: ChartType.Line,
      xFieldId: 'x',
      omitEmptyValues: true,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: 'some_y_field',
      dateCondition: DateGroupCondition.Day,
    });
    const result = writeChartLayoutSetting(map, { dateCondition: DateGroupCondition.Year });

    expect(result).toEqual({
      chartType: ChartType.Line,
      xFieldId: 'x',
      omitEmptyValues: true,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: 'some_y_field',
      dateCondition: DateGroupCondition.Year,
    });
    expect(readChartLayoutSetting(map)).toEqual(result);
  });

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
  ])('clears the Y axis when yFieldId is %s', (_, yFieldId) => {
    const { map } = createChartMap();

    writeChartLayoutSetting(map, { aggregationType: ChartAggregationType.Sum, yFieldId: 'y' });
    const result = writeChartLayoutSetting(map, { aggregationType: ChartAggregationType.Count, yFieldId });

    expect(result.yFieldId).toBeUndefined();
    expect(map.get(ChartLayoutKeys.yFieldId)).toBe('');
    expect(readChartLayoutSetting(map)?.yFieldId).toBeUndefined();
  });

  it('keeps the stored Y axis when the patch does not mention it', () => {
    const { map } = createChartMap();

    writeChartLayoutSetting(map, { aggregationType: ChartAggregationType.Sum, yFieldId: 'y' });
    expect(writeChartLayoutSetting(map, { chartType: ChartType.Donut }).yFieldId).toBe('y');
  });

  it('keeps stored values for undefined or unknown patch values, so desktop never resets', () => {
    const { doc, map } = createChartMap();
    const stored = writeChartLayoutSetting(map, {
      chartType: ChartType.Line,
      xFieldId: 'x',
      omitEmptyValues: true,
      aggregationType: ChartAggregationType.Median,
      yFieldId: 'y',
      dateCondition: DateGroupCondition.Week,
    });
    const before = Y.encodeStateVector(doc);

    const patches = [
      {
        chartType: undefined,
        xFieldId: undefined,
        omitEmptyValues: undefined,
        aggregationType: undefined,
        dateCondition: undefined,
      },
      { chartType: 9 as ChartType, aggregationType: 7 as ChartAggregationType, dateCondition: 5 as DateGroupCondition },
      { chartType: NaN as ChartType, aggregationType: 1.5 as ChartAggregationType, dateCondition: -1 },
      { xFieldId: 7 as unknown as string, omitEmptyValues: 'yes' as unknown as boolean },
    ];

    for (const patch of patches) {
      expect(writeChartLayoutSetting(map, patch)).toEqual(stored);
    }

    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(readChartLayoutSetting(map)).toEqual(stored);
  });

  it('creates no Yjs items when nothing changes, like yrs try_update', () => {
    const { doc, map } = createChartMap();
    const patch = { chartType: ChartType.Donut, xFieldId: 'x', aggregationType: ChartAggregationType.CountValues };

    writeChartLayoutSetting(map, patch);
    const before = Y.encodeStateVector(doc);
    const updates: Uint8Array[] = [];
    const changedKeys: string[] = [];

    doc.on('update', (update: Uint8Array) => updates.push(update));
    map.observe((event) => changedKeys.push(...event.keysChanged));

    writeChartLayoutSetting(map, patch);
    writeChartLayoutSetting(map, {});
    writeChartLayoutSetting(map, readChartLayoutSetting(map) ?? {});

    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(updates).toHaveLength(0);
    expect(changedKeys).toHaveLength(0);
  });

  it('writes only the keys whose value changed', () => {
    const { doc, map } = createChartMap();

    writeChartLayoutSetting(map, { xFieldId: 'x', aggregationType: ChartAggregationType.Sum, yFieldId: 'y' });
    const clock = Y.getState(doc.store, doc.clientID);
    const changedKeys: string[] = [];

    map.observe((event) => changedKeys.push(...event.keysChanged));
    writeChartLayoutSetting(map, { aggregationType: ChartAggregationType.Median });

    // Sum -> Median changes both the collab value (1 -> 0) and the sidecar (1 -> 5).
    expect(changedKeys.sort()).toEqual([ChartLayoutKeys.aggregationType, ChartLayoutKeys.aggregationTypePb]);
    expect(Y.getState(doc.store, doc.clientID)).toBe(clock + 2);
  });

  it('rewrites values stored with another type, like try_update comparing Any variants', () => {
    const { map } = createChartMap({ chart_type: 2, aggregation_type: 1, x_field_id: 'x', show_empty_values: false });
    const changedKeys: string[] = [];

    map.observe((event) => changedKeys.push(...event.keysChanged));
    writeChartLayoutSetting(map, {});

    expect(map.get(ChartLayoutKeys.chartType)).toBe(big(2));
    expect(map.get(ChartLayoutKeys.aggregationType)).toBe(big(1));
    expect(changedKeys).toEqual(expect.arrayContaining([ChartLayoutKeys.chartType, ChartLayoutKeys.aggregationType]));
    expect(changedKeys).not.toContain(ChartLayoutKeys.xFieldId);
    expect(changedKeys).not.toContain(ChartLayoutKeys.showEmptyValues);
  });

  it('repairs a typed value desktop cannot decode, keeping the sidecars', () => {
    const { map } = createChartMap({
      chart_type: 9,
      x_field_id: 'lost-with-the-typed-decode',
      date_condition: big(0),
      aggregation_type_pb: big(6),
    });

    const result = writeChartLayoutSetting(map, { xFieldId: 'x' });

    expect(result).toEqual(
      setting({ xFieldId: 'x', aggregationType: ChartAggregationType.CountValues, dateCondition: DateGroupCondition.Relative })
    );
    expect(map.get(ChartLayoutKeys.chartType)).toBe(big(0));
    expect(readChartLayoutSetting(map)).toEqual(result);
  });

  it('migrates a legacy-only map to the full desktop key set and leaves the legacy keys untouched', () => {
    const legacy: Entries = {
      chartType: 2,
      xFieldId: 'legacy-x',
      showEmptyValues: false,
      aggregationType: 6,
      yFieldId: 'legacy-y',
      cumulative: true,
      dateCondition: 0,
    };
    const { map } = createChartMap(legacy);

    const result = writeChartLayoutSetting(map, { chartType: ChartType.Line });

    expect(result).toEqual({
      chartType: ChartType.Line,
      xFieldId: 'legacy-x',
      omitEmptyValues: true,
      aggregationType: ChartAggregationType.CountValues,
      yFieldId: 'legacy-y',
      dateCondition: DateGroupCondition.Relative,
    });
    expect(rawEntries(map)).toEqual({
      chart_type: big(1),
      x_field_id: 'legacy-x',
      show_empty_values: true,
      aggregation_type: big(0),
      y_field_id: 'legacy-y',
      date_condition: big(0),
      aggregation_type_pb: big(6),
    });
    expect(rawEntries(map, Object.values(LegacyChartLayoutKeys))).toEqual(legacy);
    expect(readChartLayoutSetting(map)).toEqual(result);
  });

  it('runs as one transaction, or joins the surrounding one with its origin', () => {
    const { doc, map } = createChartMap();
    const origins: unknown[] = [];
    let updates = 0;

    doc.on('update', () => {
      updates += 1;
    });
    map.observe((event) => origins.push(event.transaction.origin));

    writeChartLayoutSetting(map, { chartType: ChartType.Line, xFieldId: 'x' });
    expect(updates).toBe(1);

    const origin = { name: 'updateChartSetting' };

    doc.transact(() => {
      writeChartLayoutSetting(map, { chartType: ChartType.Donut });
      writeChartLayoutSetting(map, { dateCondition: DateGroupCondition.Day });
    }, origin);
    expect(updates).toBe(2);
    expect(origins).toEqual([null, origin]);
  });

  it('throws for a map that is not in a document', () => {
    expect(() => writeChartLayoutSetting(new Y.Map(), { chartType: ChartType.Line })).toThrow(
      'Cannot write chart settings to a Y.Map that is not in a document'
    );
  });

  it.each(['v1', 'v2'] as const)('round-trips through %s updates with BigInt values intact', (version) => {
    const { doc, map } = createChartMap();
    const written = writeChartLayoutSetting(map, {
      chartType: ChartType.HorizontalBar,
      xFieldId: 'x',
      omitEmptyValues: true,
      aggregationType: ChartAggregationType.Median,
      yFieldId: 'y',
      dateCondition: DateGroupCondition.Relative,
    });
    const replicaMap = chartMapOf(replicate(doc, version));

    expect(rawEntries(replicaMap)).toEqual(rawEntries(map));
    expect(typeof replicaMap.get(ChartLayoutKeys.chartType)).toBe('bigint');
    expect(typeof replicaMap.get(ChartLayoutKeys.aggregationType)).toBe('bigint');
    expect(typeof replicaMap.get(ChartLayoutKeys.dateCondition)).toBe('bigint');
    expect(typeof replicaMap.get(ChartLayoutKeys.aggregationTypePb)).toBe('bigint');
    expect(readChartLayoutSetting(replicaMap)).toEqual(written);
  });

  it('keeps settings independent per view (chart_*_independent_per_view)', () => {
    const doc = new Y.Doc();
    const viewA = new Y.Map<unknown>();
    const viewB = new Y.Map<unknown>();

    doc.getMap('views').set('a', viewA);
    doc.getMap('views').set('b', viewB);

    writeChartLayoutSetting(viewA, { aggregationType: ChartAggregationType.Median, dateCondition: DateGroupCondition.Day });
    writeChartLayoutSetting(viewB, { aggregationType: ChartAggregationType.Sum, dateCondition: DateGroupCondition.Year });

    const replica = replicate(doc);
    const views = replica.getMap('views');

    expect(readChartLayoutSetting(views.get('a'))).toEqual(
      setting({ aggregationType: ChartAggregationType.Median, dateCondition: DateGroupCondition.Day })
    );
    expect(readChartLayoutSetting(views.get('b'))).toEqual(
      setting({ aggregationType: ChartAggregationType.Sum, dateCondition: DateGroupCondition.Year })
    );
  });

  it('merges concurrent edits of different fields from two clients', () => {
    const { doc: docA, map: mapA } = createChartMap({}, 1);

    writeChartLayoutSetting(mapA, { xFieldId: 'x' });
    const docB = replicate(docA, 'v1', 2);
    const mapB = chartMapOf(docB);

    writeChartLayoutSetting(mapA, { chartType: ChartType.Donut });
    writeChartLayoutSetting(mapB, { aggregationType: ChartAggregationType.Median, yFieldId: 'y' });

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const expected = setting({
      chartType: ChartType.Donut,
      xFieldId: 'x',
      aggregationType: ChartAggregationType.Median,
      yFieldId: 'y',
    });

    expect(readChartLayoutSetting(mapA)).toEqual(expected);
    expect(readChartLayoutSetting(mapB)).toEqual(expected);
  });
});

/**
 * Native updates produced by yrs 0.25.0 (the desktop's pinned version, client
 * 1234) at `data/database/views/view/layout_settings/3`. Each write mirrors
 * desktop's `v_set_layout_settings` Chart branch: the collab
 * `ChartLayoutSetting` -> `LayoutSetting` conversion plus the `date_condition`
 * and `aggregation_type_pb` BigInt sidecars, applied key by key with
 * `MapRef::try_update` (collab's `fill_map_from_any`):
 *
 *   let mut raw: LayoutSetting = chart_layout_setting.into();
 *   raw.insert("date_condition".into(), Any::BigInt(date_condition));
 *   raw.insert("aggregation_type_pb".into(), Any::BigInt(aggregation_pb));
 *   for (key, value) in raw { chart_map.try_update(&mut txn, key, value); }
 *
 * `d-two-writes` writes Donut/CountValues/Year and then HorizontalBar/Sum/Day;
 * `d-over-legacy-web-keys` first stores the camelCase keys an old web build
 * wrote (as yrs numbers/strings/bools) and then writes Donut/CountValues/Week.
 */
const DESKTOP_FIXTURES = [
  {
    name: 'd-line-median-relative',
    update:
      'AQzSCQAnAQRkYXRhCGRhdGFiYXNlAScA0gkABXZpZXdzAScA0gkBBHZpZXcBJwDSCQIPbGF5b3V0X3NldHRpbmdzAScA0gkDATMBKADSCQQRc2hvd19lbXB0eV92YWx1ZXMBeCgA0gkECnhfZmllbGRfaWQBdwd4LWZpZWxkKADSCQQQYWdncmVnYXRpb25fdHlwZQF6AAAAAAAAAAAoANIJBAp5X2ZpZWxkX2lkAXcHeS1maWVsZCgA0gkEDmRhdGVfY29uZGl0aW9uAXoAAAAAAAAAACgA0gkECmNoYXJ0X3R5cGUBegAAAAAAAAABKADSCQQTYWdncmVnYXRpb25fdHlwZV9wYgF6AAAAAAAAAAUA',
    expected: {
      chartType: ChartType.Line,
      xFieldId: 'x-field',
      omitEmptyValues: true,
      aggregationType: ChartAggregationType.Median,
      yFieldId: 'y-field',
      dateCondition: DateGroupCondition.Relative,
    },
  },
  {
    name: 'd-two-writes',
    update:
      'ARDSCQAnAQRkYXRhCGRhdGFiYXNlAScA0gkABXZpZXdzAScA0gkBBHZpZXcBJwDSCQIPbGF5b3V0X3NldHRpbmdzAScA0gkDATMBIQDSCQQTYWdncmVnYXRpb25fdHlwZV9wYgEoANIJBBFzaG93X2VtcHR5X3ZhbHVlcwF5IQDSCQQQYWdncmVnYXRpb25fdHlwZQEoANIJBAp5X2ZpZWxkX2lkAXcHeS1maWVsZCgA0gkECnhfZmllbGRfaWQBdwd4LWZpZWxkIQDSCQQKY2hhcnRfdHlwZQEhANIJBA5kYXRlX2NvbmRpdGlvbgGo0gkLAXoAAAAAAAAAAajSCQUBegAAAAAAAAABqNIJCgF6AAAAAAAAAAKo0gkHAXoAAAAAAAAAAQHSCQMFAQcBCgI=',
    expected: {
      chartType: ChartType.HorizontalBar,
      xFieldId: 'x-field',
      omitEmptyValues: false,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: 'y-field',
      dateCondition: DateGroupCondition.Day,
    },
  },
  {
    name: 'd-over-legacy-web-keys',
    update:
      'ARDSCQAnAQRkYXRhCGRhdGFiYXNlAScA0gkABXZpZXdzAScA0gkBBHZpZXcBJwDSCQIPbGF5b3V0X3NldHRpbmdzAScA0gkDATMBKADSCQQJY2hhcnRUeXBlAX0BKADSCQQIeEZpZWxkSWQBdwhsZWdhY3kteCgA0gkED3Nob3dFbXB0eVZhbHVlcwF4KADSCQQPYWdncmVnYXRpb25UeXBlAX0FKADSCQQKeF9maWVsZF9pZAF3AXgoANIJBBFzaG93X2VtcHR5X3ZhbHVlcwF5KADSCQQQYWdncmVnYXRpb25fdHlwZQF6AAAAAAAAAAAoANIJBAp5X2ZpZWxkX2lkAXcBeSgA0gkEDmRhdGVfY29uZGl0aW9uAXoAAAAAAAAAAigA0gkEE2FnZ3JlZ2F0aW9uX3R5cGVfcGIBegAAAAAAAAAGKADSCQQKY2hhcnRfdHlwZQF6AAAAAAAAAAMA',
    expected: {
      chartType: ChartType.Donut,
      xFieldId: 'x',
      omitEmptyValues: false,
      aggregationType: ChartAggregationType.CountValues,
      yFieldId: 'y',
      dateCondition: DateGroupCondition.Week,
    },
  },
];

describe('native desktop updates (yrs 0.25)', () => {
  function loadFixture(update: string) {
    const doc = new Y.Doc();

    doc.clientID = 5150;
    Y.applyUpdate(doc, Buffer.from(update, 'base64'));
    const database = doc.getMap('data').get('database') as Y.Map<unknown>;
    const view = (database.get('views') as Y.Map<unknown>).get('view') as Y.Map<unknown>;

    return { doc, map: (view.get('layout_settings') as Y.Map<unknown>).get(CHART_LAYOUT_SETTINGS_KEY) as Y.Map<unknown> };
  }

  it.each(DESKTOP_FIXTURES)('decodes $name', ({ update, expected }) => {
    const { map } = loadFixture(update);

    expect(readChartLayoutSetting(map)).toEqual(expected);
    expect(Object.fromEntries(Object.entries(rawEntries(map)).map(([key, value]) => [key, typeof value]))).toEqual({
      chart_type: 'bigint',
      x_field_id: 'string',
      show_empty_values: 'boolean',
      aggregation_type: 'bigint',
      y_field_id: 'string',
      date_condition: 'bigint',
      aggregation_type_pb: 'bigint',
    });
  });

  it.each(DESKTOP_FIXTURES)('re-saves $name from the web without creating items', ({ update, expected }) => {
    const { doc, map } = loadFixture(update);
    const before = Y.encodeStateVector(doc);

    writeChartLayoutSetting(map, {});
    writeChartLayoutSetting(map, expected);

    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it('applies a web patch on top of a desktop write by touching only the changed keys', () => {
    const { map } = loadFixture(DESKTOP_FIXTURES[0].update);
    const changedKeys: string[] = [];

    map.observe((event) => changedKeys.push(...event.keysChanged));
    const result = writeChartLayoutSetting(map, { chartType: ChartType.Donut });

    expect(changedKeys).toEqual([ChartLayoutKeys.chartType]);
    expect(result).toEqual({ ...DESKTOP_FIXTURES[0].expected, chartType: ChartType.Donut });
  });
});

describe('chartLayoutSettingsEqual', () => {
  const base = setting({ xFieldId: 'x', yFieldId: 'y' });

  it('compares every field', () => {
    expect(chartLayoutSettingsEqual(base, { ...base })).toBe(true);
    expect(chartLayoutSettingsEqual(null, null)).toBe(true);
    expect(chartLayoutSettingsEqual(base, null)).toBe(false);
    expect(chartLayoutSettingsEqual(null, base)).toBe(false);

    const changes: Partial<ChartLayoutSettings>[] = [
      { chartType: ChartType.Line },
      { xFieldId: 'other' },
      { omitEmptyValues: true },
      { aggregationType: ChartAggregationType.Sum },
      { yFieldId: undefined },
      { dateCondition: DateGroupCondition.Day },
    ];

    changes.forEach((change) => expect(chartLayoutSettingsEqual(base, { ...base, ...change })).toBe(false));
  });
});

describe('wire values match desktop (setting_entities.rs)', () => {
  it('uses the protobuf enum values', () => {
    expect([ChartType.Bar, ChartType.Line, ChartType.HorizontalBar, ChartType.Donut]).toEqual([0, 1, 2, 3]);
    expect([
      ChartAggregationType.Count,
      ChartAggregationType.Sum,
      ChartAggregationType.Average,
      ChartAggregationType.Min,
      ChartAggregationType.Max,
      ChartAggregationType.Median,
      ChartAggregationType.CountValues,
    ]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([
      DateGroupCondition.Relative,
      DateGroupCondition.Day,
      DateGroupCondition.Week,
      DateGroupCondition.Month,
      DateGroupCondition.Year,
    ]).toEqual([0, 1, 2, 3, 4]);
    expect(CHART_LAYOUT_SETTINGS_KEY).toBe('3');
  });

  it('parses every aggregation and rejects unknown values (parse_chart_aggregation_type_pb)', () => {
    [0, 1, 2, 3, 4, 5, 6].forEach((value) => expect(parseChartAggregationTypePb(value)).toBe(value));
    [7, 99, -1, 2147483647, 1.5, NaN].forEach((value) => expect(parseChartAggregationTypePb(value)).toBeNull());
  });

  it('downgrades only Median and CountValues for the collab enum', () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6].map((value) => toCollabChartAggregationType(value as ChartAggregationType))
    ).toEqual([0, 1, 2, 3, 4, 0, 0]);
  });
});

describe('chart setting hooks', () => {
  const viewId = 'view-id';

  function createDatabase(chartEntries?: Entries | 'not-a-map') {
    const databaseDoc = new Y.Doc({ guid: 'database-id' }) as YDoc;
    const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const database = new Y.Map() as YDatabase;
    const views = new Y.Map() as YDatabaseViews;
    const view = new Y.Map() as YDatabaseView;

    sharedRoot.set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.id, 'database-id');
    database.set(YjsDatabaseKey.views, views);
    views.set(viewId, view);
    view.set(YjsDatabaseKey.id, viewId);

    if (chartEntries) {
      const layoutSettings = new Y.Map() as YDatabaseLayoutSettings;

      view.set(YjsDatabaseKey.layout_settings, layoutSettings);
      if (chartEntries === 'not-a-map') {
        layoutSettings.set(CHART_LAYOUT_SETTINGS_KEY, { chart_type: 1 });
      } else {
        const chart = new Y.Map<unknown>();

        layoutSettings.set(CHART_LAYOUT_SETTINGS_KEY, chart);
        seed(chart, chartEntries);
      }
    }

    const value: DatabaseContextState = {
      activeViewId: viewId,
      databaseDoc,
      databasePageId: viewId,
      readOnly: false,
      rowMap: {},
      workspaceId: 'workspace-id',
    };
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(DatabaseContext.Provider, { value }, children);

    return { databaseDoc, view, wrapper };
  }

  it('returns the stored setting on the first render', () => {
    const { wrapper } = createDatabase(DESKTOP_LINE_MEDIAN_RELATIVE);
    const renders: (ChartLayoutSettings | null)[] = [];

    renderHook(
      () => {
        const value = useChartLayoutSetting();

        renders.push(value);
        return value;
      },
      { wrapper }
    );

    expect(renders[0]).toEqual(readChartLayoutSetting(createChartMap(DESKTOP_LINE_MEDIAN_RELATIVE).map));
  });

  it('returns null without a chart setting and picks one up from a remote update', () => {
    const { databaseDoc, wrapper } = createDatabase();
    const { result } = renderHook(() => useChartLayoutSetting(), { wrapper });

    expect(result.current).toBeNull();

    const remote = replicate(databaseDoc, 'v1', 77);
    const remoteView = (
      (remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>).get(
        YjsDatabaseKey.views
      ) as Y.Map<unknown>
    ).get(viewId) as Y.Map<unknown>;
    const layoutSettings = new Y.Map<unknown>();
    const chart = new Y.Map<unknown>();

    remoteView.set(YjsDatabaseKey.layout_settings, layoutSettings);
    layoutSettings.set(CHART_LAYOUT_SETTINGS_KEY, chart);
    seed(chart, DESKTOP_LINE_MEDIAN_RELATIVE);

    act(() => {
      Y.applyUpdate(databaseDoc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(databaseDoc)));
    });

    expect(result.current).toEqual(readChartLayoutSetting(chart));
  });

  it('returns null when the chart entry is not a map', () => {
    const { wrapper } = createDatabase('not-a-map');

    expect(renderHook(() => useChartLayoutSetting(), { wrapper }).result.current).toBeNull();
  });

  it('keeps the same object across unrelated view changes', () => {
    const { view, wrapper } = createDatabase(DESKTOP_LINE_MEDIAN_RELATIVE);
    const { result } = renderHook(() => useChartLayoutSetting(), { wrapper });
    const first = result.current;

    act(() => {
      view.set(YjsDatabaseKey.name, 'Renamed');
    });

    expect(result.current).toBe(first);
  });

  it('writes desktop keys through useUpdateChartSetting and reads them back', () => {
    const { view, wrapper } = createDatabase();
    const { result } = renderHook(() => ({ setting: useChartLayoutSetting(), update: useUpdateChartSetting() }), {
      wrapper,
    });

    act(() => {
      result.current.update({ chartType: ChartType.Donut, aggregationType: ChartAggregationType.Median, yFieldId: 'y' });
    });

    const chart = view.get(YjsDatabaseKey.layout_settings).get(CHART_LAYOUT_SETTINGS_KEY) as Y.Map<unknown>;

    expect(rawEntries(chart)).toEqual(
      expect.objectContaining({ chart_type: big(3), aggregation_type: big(0), aggregation_type_pb: big(5), y_field_id: 'y' })
    );
    expect(result.current.setting).toEqual(
      setting({ chartType: ChartType.Donut, aggregationType: ChartAggregationType.Median, yFieldId: 'y' })
    );

    act(() => {
      result.current.update({ aggregationType: ChartAggregationType.Count, yFieldId: undefined });
    });

    expect(result.current.setting).toEqual(setting({ chartType: ChartType.Donut }));
  });

  it('replaces a chart entry that is not a map, like desktop get_or_init', () => {
    const { view, wrapper } = createDatabase('not-a-map');
    const { result } = renderHook(() => ({ setting: useChartLayoutSetting(), update: useUpdateChartSetting() }), {
      wrapper,
    });

    act(() => {
      result.current.update({ chartType: ChartType.Line });
    });

    expect(view.get(YjsDatabaseKey.layout_settings).get(CHART_LAYOUT_SETTINGS_KEY)).toBeInstanceOf(Y.Map);
    expect(result.current.setting).toEqual(setting({ chartType: ChartType.Line }));
  });
});

describe('restoreChartLayoutSettingIntegers', () => {
  /** `layout_settings` the way a JSON round trip hands it back: every integer a plain number. */
  function createLayoutSettings(chart?: Entries, others: Record<string, Entries> = {}) {
    const doc = new Y.Doc();
    const layoutSettings = new Y.Map<unknown>();

    doc.getMap('view').set(YjsDatabaseKey.layout_settings, layoutSettings);
    if (chart) layoutSettings.set(CHART_LAYOUT_SETTINGS_KEY, new Y.Map(Object.entries(chart)));
    Object.entries(others).forEach(([key, entries]) => layoutSettings.set(key, new Y.Map(Object.entries(entries))));

    return {
      doc,
      layoutSettings,
      chart: layoutSettings.get(CHART_LAYOUT_SETTINGS_KEY) as Y.Map<unknown> | undefined,
    };
  }

  const JSON_CHART: Entries = {
    chart_type: 1,
    x_field_id: 'x',
    show_empty_values: false,
    aggregation_type: 0,
    y_field_id: 'y',
    date_condition: 1,
    aggregation_type_pb: 5,
  };
  const LINE_MEDIAN_DAY: ChartLayoutSettings = {
    chartType: ChartType.Line,
    xFieldId: 'x',
    omitEmptyValues: false,
    aggregationType: ChartAggregationType.Median,
    yFieldId: 'y',
    dateCondition: DateGroupCondition.Day,
  };

  it('re-tags the chart integers as BigInt so both sidecars decode again', () => {
    const { doc, layoutSettings, chart } = createLayoutSettings(JSON_CHART);

    // Plain numbers read like desktop reads Any::Number: the sidecars are ignored.
    expect(readChartLayoutSetting(chart)).toEqual({
      ...LINE_MEDIAN_DAY,
      aggregationType: ChartAggregationType.Count,
      dateCondition: DateGroupCondition.Month,
    });

    restoreChartLayoutSettingIntegers(layoutSettings);

    expect(chart?.get(ChartLayoutKeys.chartType)).toBe(big(1));
    expect(chart?.get(ChartLayoutKeys.aggregationType)).toBe(big(0));
    expect(chart?.get(ChartLayoutKeys.dateCondition)).toBe(big(1));
    expect(chart?.get(ChartLayoutKeys.aggregationTypePb)).toBe(big(5));
    expect(chart?.get(ChartLayoutKeys.xFieldId)).toBe('x');
    expect(chart?.get(ChartLayoutKeys.showEmptyValues)).toBe(false);
    expect(readChartLayoutSetting(chart)).toEqual(LINE_MEDIAN_DAY);

    const replica = new Y.Doc();

    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    const copy = (replica.getMap('view').get(YjsDatabaseKey.layout_settings) as Y.Map<unknown>).get(
      CHART_LAYOUT_SETTINGS_KEY
    );

    expect(readChartLayoutSetting(copy)).toEqual(LINE_MEDIAN_DAY);
  });

  it('leaves fractions, strings, booleans, null and the legacy camelCase keys alone', () => {
    const { layoutSettings, chart } = createLayoutSettings({
      chart_type: 1.5,
      aggregation_type: '2',
      date_condition: true,
      aggregation_type_pb: null,
      chartType: 1,
      aggregationType: 5,
      dateCondition: 1,
    });

    restoreChartLayoutSettingIntegers(layoutSettings);

    expect(chart?.get(ChartLayoutKeys.chartType)).toBe(1.5);
    expect(chart?.get(ChartLayoutKeys.aggregationType)).toBe('2');
    expect(chart?.get(ChartLayoutKeys.dateCondition)).toBe(true);
    expect(chart?.get(ChartLayoutKeys.aggregationTypePb)).toBeNull();
    expect(chart?.get(LegacyChartLayoutKeys.chartType)).toBe(1);
    expect(chart?.get(LegacyChartLayoutKeys.aggregationType)).toBe(5);
    expect(chart?.get(LegacyChartLayoutKeys.dateCondition)).toBe(1);
  });

  it('writes nothing when the integers are already BigInt', () => {
    const { doc, layoutSettings, chart } = createLayoutSettings({ x_field_id: 'x' });

    seed(chart!, { chart_type: big(2), date_condition: big(4) });
    const before = Y.encodeStateVector(doc);

    restoreChartLayoutSettingIntegers(layoutSettings);

    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(readChartLayoutSetting(chart)?.dateCondition).toBe(DateGroupCondition.Year);
  });

  it('runs as one transaction', () => {
    const { doc, layoutSettings } = createLayoutSettings(JSON_CHART);
    let updates = 0;

    doc.on('update', () => {
      updates += 1;
    });
    restoreChartLayoutSettingIntegers(layoutSettings);

    expect(updates).toBe(1);
  });

  it('touches only the chart entry and tolerates missing or non-map entries', () => {
    const { layoutSettings } = createLayoutSettings(undefined, { '5': { card_size: 1 } });

    expect(() => restoreChartLayoutSettingIntegers(layoutSettings)).not.toThrow();
    expect((layoutSettings.get('5') as Y.Map<unknown>).get('card_size')).toBe(1);

    layoutSettings.set(CHART_LAYOUT_SETTINGS_KEY, 'not a map');
    expect(() => restoreChartLayoutSettingIntegers(layoutSettings)).not.toThrow();
    expect(() => restoreChartLayoutSettingIntegers(undefined)).not.toThrow();
    expect(() => restoreChartLayoutSettingIntegers(null)).not.toThrow();
  });
});
