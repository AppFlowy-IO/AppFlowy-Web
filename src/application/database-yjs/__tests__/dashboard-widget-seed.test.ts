import * as Y from 'yjs';

import { parseChartLayoutSettings } from '@/application/database-yjs/chart.type';
import { DEFAULT_NUMBER_WIDGET_CHART, seedNumberWidgetChart } from '@/application/database-yjs/dashboard-widget-seed';
import { DatabaseNoHistoryOrigin, getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

import { loadParityFixture } from './dashboard-parity-helpers';

interface AddWidgetFixture {
  default_number_chart: {
    required: Record<string, unknown>;
    parsed: {
      chart_type: number;
      aggregation_type: number;
      number_format: string;
      show_title: boolean;
      x_field_id: string;
      y_field_id: string | null;
      cumulative: boolean;
      title_text: string;
    };
  };
}

const FIXTURE = loadParityFixture<AddWidgetFixture>('add-widget.json').default_number_chart;
const VIEW_ID = 'chart-view';

function createDoc({ withChartMap }: { withChartMap: boolean }) {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  if (withChartMap) {
    const settings = new Y.Map();
    const chart = new Y.Map<unknown>();

    chart.set('probe_unknown', 'kept');
    settings.set('3', chart);
    view.set(YjsDatabaseKey.layout_settings, settings as never);
  }

  views.set(VIEW_ID, view);
  database.set(YjsDatabaseKey.views, views as never);
  sharedRoot.set(YjsEditorKey.database, database as never);
  return { doc, sharedRoot, view };
}

function chartMap(view: YDatabaseView) {
  return (view.get(YjsDatabaseKey.layout_settings) as unknown as Y.Map<unknown>).get('3') as Y.Map<unknown>;
}

describe('seedNumberWidgetChart', () => {
  it.each([
    ['a view without a chart map yet', false],
    ['a view whose chart map the server already wrote', true],
  ])('writes the compact Count all Number chart of add-widget.json into %s', (_name, withChartMap) => {
    const { sharedRoot, view } = createDoc({ withChartMap });

    expect(seedNumberWidgetChart(sharedRoot, VIEW_ID)).toBe(true);
    const chart = chartMap(view);

    // The required keys, by value; show_title is stored although it reads true when absent.
    Object.entries(FIXTURE.required).forEach(([key, value]) => {
      expect([key, chart.get(key)]).toEqual([key, value]);
    });
    // The legacy camelCase mirrors the web writes beside the collab keys.
    expect(chart.get('chartType')).toBe(4);
    expect(chart.get('aggregationType')).toBe(0);
    expect(chart.get('showEmptyValues')).toBe(true);
    expect(chart.get('dateCondition')).toBe(3);
    if (withChartMap) expect(chart.get('probe_unknown')).toBe('kept');

    const parsed = parseChartLayoutSettings(chart);

    expect({
      chart_type: parsed.chartType,
      aggregation_type: parsed.aggregationType,
      number_format: parsed.numberFormat,
      show_title: parsed.extended.showTitle,
      x_field_id: parsed.xFieldId,
      y_field_id: parsed.yFieldId ?? null,
      cumulative: parsed.cumulative,
      title_text: parsed.titleText,
    }).toEqual(FIXTURE.parsed);
  });

  it('is one write that is not an undo step', () => {
    const { doc, sharedRoot } = createDoc({ withChartMap: false });
    const manager = getOrCreateDatabaseHistoryManager(doc);
    const origins: unknown[] = [];

    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));
    seedNumberWidgetChart(sharedRoot, VIEW_ID);

    expect(origins).toHaveLength(1);
    expect(origins[0]).toBeInstanceOf(DatabaseNoHistoryOrigin);
    expect(manager.getSnapshot() & 1).toBe(0);
  });

  it('does nothing for a view the database does not hold', () => {
    const { sharedRoot } = createDoc({ withChartMap: false });

    expect(seedNumberWidgetChart(sharedRoot, 'missing')).toBe(false);
  });

  it('matches the fixture defaults', () => {
    expect(DEFAULT_NUMBER_WIDGET_CHART).toEqual({
      chartType: 4,
      aggregationType: 0,
      numberFormat: 'compact',
      showEmptyValues: true,
      dateCondition: 3,
      showTitle: true,
    });
  });
});
