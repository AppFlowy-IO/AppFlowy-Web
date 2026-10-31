import * as Y from 'yjs';

import {
  YDatabase,
  YDatabaseLayoutSettings,
  YDatabaseView,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';

import { ChartExtendedLayoutKeys } from './chart-extended-settings';
import {
  CHART_LAYOUT_SETTINGS_KEY,
  ChartAggregationType,
  ChartLayoutSetting,
  ChartType,
  writeChartLayoutValue,
} from './chart.type';
import { DateGroupCondition } from './database.type';
import { executeDatabaseOperations } from './history';

/**
 * The chart a dashboard's default widget starts with (WP06 §1.3,
 * `dashboard-parity/add-widget.json` `default_number_chart`): a compact
 * Count all Number card with its title. Every other chart key keeps its
 * default and is not written.
 */
export const DEFAULT_NUMBER_WIDGET_CHART = {
  chartType: ChartType.Number,
  aggregationType: ChartAggregationType.Count,
  numberFormat: 'compact',
  showEmptyValues: true,
  dateCondition: DateGroupCondition.Month,
  showTitle: true,
} as const satisfies Partial<ChartLayoutSetting> & { showTitle: boolean };

function chartLayoutMapOf(view: YDatabaseView): Y.Map<unknown> {
  let layouts = view.get(YjsDatabaseKey.layout_settings);

  if (!layouts) {
    layouts = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layouts);
  }

  const settings = layouts as unknown as Y.Map<unknown>;
  let chart = settings.get(CHART_LAYOUT_SETTINGS_KEY) as Y.Map<unknown> | undefined;

  if (!(chart instanceof Y.Map)) {
    chart = new Y.Map<unknown>();
    settings.set(CHART_LAYOUT_SETTINGS_KEY, chart);
  }

  return chart;
}

/**
 * Seed a new widget view's chart map with `DEFAULT_NUMBER_WIDGET_CHART` before
 * the widget is inserted, so the widget's first frame is the Number card. One
 * write that is not an undo step (like every created-tab seed): undoing the
 * add removes the widget, never the chart. Key by key (the legacy camelCase
 * mirrors included), with `show_title` stored explicitly although it reads as
 * true when absent: desktop and Rust read the stored key (the show_title seed
 * rule). Returns false when the view is not in `sharedRoot`'s database.
 */
export function seedNumberWidgetChart(sharedRoot: YSharedRoot, viewId: string): boolean {
  const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
  const view = database?.get(YjsDatabaseKey.views)?.get(viewId);

  if (!view) return false;
  executeDatabaseOperations(
    sharedRoot,
    [
      () => {
        const chart = chartLayoutMapOf(view);

        writeChartLayoutValue(chart, 'chartType', DEFAULT_NUMBER_WIDGET_CHART.chartType);
        writeChartLayoutValue(chart, 'aggregationType', DEFAULT_NUMBER_WIDGET_CHART.aggregationType);
        writeChartLayoutValue(chart, 'numberFormat', DEFAULT_NUMBER_WIDGET_CHART.numberFormat);
        writeChartLayoutValue(chart, 'showEmptyValues', DEFAULT_NUMBER_WIDGET_CHART.showEmptyValues);
        writeChartLayoutValue(chart, 'dateCondition', DEFAULT_NUMBER_WIDGET_CHART.dateCondition);
        chart.set(ChartExtendedLayoutKeys.showTitle, DEFAULT_NUMBER_WIDGET_CHART.showTitle);
      },
    ],
    'seedNumberWidgetChart',
    { type: 'view.chart.seed', policy: 'skip' }
  );
  return true;
}
