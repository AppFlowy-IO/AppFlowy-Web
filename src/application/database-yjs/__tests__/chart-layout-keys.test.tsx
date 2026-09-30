import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState, useChartLayoutSetting } from '@/application/database-yjs';
import {
  ChartAggregationType,
  ChartLayoutKeys,
  ChartType,
  parseChartLayoutSettings,
  readChartLayoutValue,
  writeChartLayoutValue,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition } from '@/application/database-yjs/database.type';
import { useUpdateChartSetting } from '@/application/database-yjs/dispatch';
import { type YDatabase, type YDatabaseView, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

const viewId = 'chart-view';

function mapOf(entries: Record<string, unknown>) {
  return new Map(Object.entries(entries));
}

function createFixture(chartEntries: Record<string, unknown>) {
  const databaseDoc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const layoutSettings = new Y.Map();
  const chart = new Y.Map<unknown>();

  Object.entries(chartEntries).forEach(([key, value]) => chart.set(key, value));
  layoutSettings.set('3', chart);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const context: DatabaseContextState = {
    activeViewId: viewId,
    databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap: null,
    workspaceId: 'workspace',
  };

  return { chart, context };
}

describe('chart layout keys', () => {
  it('uses the collab snake_case names and keeps the camelCase Number chart keys', () => {
    expect(ChartLayoutKeys).toEqual({
      chartType: 'chart_type',
      xFieldId: 'x_field_id',
      showEmptyValues: 'show_empty_values',
      aggregationType: 'aggregation_type',
      yFieldId: 'y_field_id',
      cumulative: 'cumulative',
      dateCondition: 'date_condition',
      numberFormat: 'numberFormat',
      titleText: 'titleText',
    });
  });

  it('reads a chart saved by earlier web builds under the legacy camelCase keys', () => {
    const settings = parseChartLayoutSettings(
      mapOf({
        chartType: ChartType.Number,
        xFieldId: 'status',
        showEmptyValues: false,
        aggregationType: ChartAggregationType.Median,
        yFieldId: 'amount',
        cumulative: true,
        dateCondition: DateGroupCondition.Relative,
        numberFormat: 'compact',
        titleText: 'Revenue',
      })
    );

    expect(settings).toEqual({
      chartType: ChartType.Number,
      xFieldId: 'status',
      showEmptyValues: false,
      aggregationType: ChartAggregationType.Median,
      yFieldId: 'amount',
      cumulative: true,
      dateCondition: DateGroupCondition.Relative,
      numberFormat: 'compact',
      titleText: 'Revenue',
      extended: {},
    });
  });

  it('reads a desktop-written chart, whose numbers are bigints and whose unset Y field is empty', () => {
    const settings = parseChartLayoutSettings(
      mapOf({
        chart_type: BigInt(ChartType.Donut),
        x_field_id: 'status',
        show_empty_values: false,
        aggregation_type: BigInt(ChartAggregationType.Count),
        y_field_id: '',
        date_condition: BigInt(DateGroupCondition.Year),
      })
    );

    expect(settings).toMatchObject({
      chartType: ChartType.Donut,
      xFieldId: 'status',
      showEmptyValues: false,
      aggregationType: ChartAggregationType.Count,
      yFieldId: undefined,
      dateCondition: DateGroupCondition.Year,
    });
  });

  it('prefers the snake_case key and falls back per key to the legacy one', () => {
    const map = mapOf({
      chart_type: ChartType.Line,
      chartType: ChartType.Bar,
      xFieldId: 'legacy-x',
      date_condition: DateGroupCondition.Relative,
      dateCondition: DateGroupCondition.Week,
    });

    expect(readChartLayoutValue(map, 'chartType')).toBe(ChartType.Line);
    expect(readChartLayoutValue(map, 'xFieldId')).toBe('legacy-x');
    expect(parseChartLayoutSettings(map)).toMatchObject({
      chartType: ChartType.Line,
      xFieldId: 'legacy-x',
      dateCondition: DateGroupCondition.Relative,
    });
  });

  it('applies the defaults when nothing is stored', () => {
    expect(parseChartLayoutSettings(mapOf({}))).toEqual({
      chartType: ChartType.Bar,
      xFieldId: '',
      showEmptyValues: true,
      aggregationType: ChartAggregationType.Count,
      yFieldId: undefined,
      cumulative: false,
      dateCondition: DateGroupCondition.Month,
      numberFormat: 'auto',
      titleText: '',
      extended: {},
    });
  });

  it('writes both spellings for the renamed keys and one key for the rest', () => {
    const map = new Map<string, unknown>();

    writeChartLayoutValue(map, 'aggregationType', ChartAggregationType.Sum);
    writeChartLayoutValue(map, 'cumulative', true);
    writeChartLayoutValue(map, 'titleText', 'Total');

    expect(Object.fromEntries(map)).toEqual({
      aggregation_type: ChartAggregationType.Sum,
      aggregationType: ChartAggregationType.Sum,
      cumulative: true,
      titleText: 'Total',
    });
  });

  it('shows a legacy web chart and moves it onto the collab keys when it is edited', () => {
    const { chart, context } = createFixture({
      chartType: ChartType.HorizontalBar,
      xFieldId: 'status',
      aggregationType: ChartAggregationType.Sum,
      yFieldId: 'amount',
    });
    const { result } = renderHook(
      () => ({ setting: useChartLayoutSetting(), update: useUpdateChartSetting() }),
      {
        wrapper: ({ children }) => <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>,
      }
    );

    expect(result.current.setting).toMatchObject({
      chartType: ChartType.HorizontalBar,
      xFieldId: 'status',
      aggregationType: ChartAggregationType.Sum,
      yFieldId: 'amount',
    });

    act(() => result.current.update({ chartType: ChartType.Number, dateCondition: DateGroupCondition.Relative }));

    expect(chart.get('chart_type')).toBe(ChartType.Number);
    expect(chart.get('chartType')).toBe(ChartType.Number);
    expect(chart.get('date_condition')).toBe(DateGroupCondition.Relative);
    expect(chart.get('dateCondition')).toBe(DateGroupCondition.Relative);
    expect(result.current.setting).toMatchObject({
      chartType: ChartType.Number,
      xFieldId: 'status',
      dateCondition: DateGroupCondition.Relative,
    });
  });

  it('writes nothing when the stored value is selected again', () => {
    const { chart, context } = createFixture({
      chart_type: ChartType.Donut,
      chartType: ChartType.Donut,
      aggregation_type: ChartAggregationType.Sum,
      aggregationType: ChartAggregationType.Sum,
      titleText: 'Revenue',
    });
    const { result } = renderHook(() => ({ setting: useChartLayoutSetting(), update: useUpdateChartSetting() }), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>,
    });
    const changed: string[] = [];

    chart.observe((event) => event.keysChanged.forEach((key) => changed.push(key)));
    const setting = result.current.setting;

    act(() =>
      result.current.update({
        chartType: ChartType.Donut,
        aggregationType: ChartAggregationType.Sum,
        titleText: 'Revenue',
      })
    );

    expect(changed).toEqual([]);
    expect(result.current.setting).toBe(setting);

    act(() => result.current.update({ chartType: ChartType.Bar, titleText: 'Revenue' }));

    expect(changed.sort()).toEqual(['chartType', 'chart_type']);
    expect(chart.get('titleText')).toBe('Revenue');
  });
});
