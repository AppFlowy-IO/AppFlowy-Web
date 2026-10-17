import * as Y from 'yjs';

import { DatabaseViewLayout, ViewLayout, YDatabase, YDatabaseRow, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { readChartLayoutSetting } from '@/application/database-yjs/chart-layout-setting';
import { CHART_LAYOUT_SETTINGS_KEY, ChartAggregationType, ChartType } from '@/application/database-yjs/chart.type';
import { DateGroupCondition } from '@/application/database-yjs/database.type';
import {
  createDatabaseYjsRenderDocsFromSnapshot,
  getPublishedDatabaseRenderRowMap,
} from '@/application/publish-snapshot/database-yjs-render-bridge';
import type { PublishedDatabaseSnapshot, PublishedJsonObject } from '@/application/publish-snapshot/types';

describe('createDatabaseYjsRenderDocsFromSnapshot', () => {
  it('hydrates database and row snapshot JSON into the Yjs shape expected by database UI hooks', () => {
    const databaseId = 'database-id';
    const viewId = 'view-id';
    const rowId = 'row-id';
    const fieldId = 'field-id';
    const filterId = 'filter-id';
    const childFilterId = 'child-filter-id';
    const groupId = 'group-id';
    const snapshot: PublishedDatabaseSnapshot = {
      schemaVersion: 1,
      kind: 'database',
      namespace: 'namespace',
      publishName: 'publish-name',
      view: {
        viewId,
        name: 'Published database',
        icon: null,
        extra: null,
        layout: ViewLayout.Grid,
        childViews: [],
        ancestorViews: [],
        visibleViewIds: [viewId],
        databaseRelations: {},
      },
      database: {
        databaseId,
        activeViewId: viewId,
        visibleViewIds: [viewId],
        fields: [
          {
            fieldId,
            name: 'Name',
            fieldType: 0,
            isPrimary: true,
          },
        ],
        views: [
          {
            viewId,
            name: 'Grid',
            layout: DatabaseViewLayout.Grid,
            fieldIds: [fieldId],
            rowIds: [rowId],
          },
        ],
        rows: [
          {
            rowId,
            cells: {
              [fieldId]: 'Hello',
            },
          },
        ],
        raw: {
          database: {
            [YjsDatabaseKey.id]: databaseId,
            [YjsDatabaseKey.fields]: {
              [fieldId]: {
                [YjsDatabaseKey.id]: fieldId,
                [YjsDatabaseKey.name]: 'Name',
                [YjsDatabaseKey.type]: 0,
                [YjsDatabaseKey.is_primary]: true,
                [YjsDatabaseKey.type_option]: {},
              },
            },
            [YjsDatabaseKey.views]: {
              [viewId]: {
                [YjsDatabaseKey.database_id]: databaseId,
                [YjsDatabaseKey.name]: 'Grid',
                [YjsDatabaseKey.layout]: DatabaseViewLayout.Grid,
                [YjsDatabaseKey.created_at]: '1',
                [YjsDatabaseKey.modified_at]: '1',
                [YjsDatabaseKey.is_inline]: false,
                [YjsDatabaseKey.embedded]: false,
                [YjsDatabaseKey.field_orders]: [{ id: fieldId }],
                [YjsDatabaseKey.row_orders]: [{ id: rowId, height: 36 }],
                [YjsDatabaseKey.field_settings]: {
                  [fieldId]: {
                    [YjsDatabaseKey.width]: '180',
                    [YjsDatabaseKey.visibility]: '0',
                    [YjsDatabaseKey.wrap]: true,
                  },
                },
                [YjsDatabaseKey.filters]: [
                  {
                    [YjsDatabaseKey.id]: filterId,
                    [YjsDatabaseKey.filter_type]: 0,
                    [YjsDatabaseKey.children]: [
                      {
                        [YjsDatabaseKey.id]: childFilterId,
                        [YjsDatabaseKey.field_id]: fieldId,
                        [YjsDatabaseKey.condition]: '0',
                        [YjsDatabaseKey.content]: '',
                      },
                    ],
                  },
                ],
                [YjsDatabaseKey.groups]: [
                  {
                    [YjsDatabaseKey.id]: groupId,
                    [YjsDatabaseKey.field_id]: fieldId,
                    [YjsDatabaseKey.groups]: [{ id: 'ungrouped', visible: true }],
                  },
                ],
                [YjsDatabaseKey.sorts]: [],
                [YjsDatabaseKey.calculations]: [],
                [YjsDatabaseKey.layout_settings]: {},
              },
            },
            [YjsDatabaseKey.metas]: {},
          },
          rows: {
            [rowId]: {
              [YjsEditorKey.database_row]: {
                [YjsDatabaseKey.id]: rowId,
                [YjsDatabaseKey.database_id]: databaseId,
                [YjsDatabaseKey.visibility]: true,
                [YjsDatabaseKey.height]: 36,
                [YjsDatabaseKey.created_at]: '1',
                [YjsDatabaseKey.last_modified]: '1',
                [YjsDatabaseKey.cells]: {
                  [fieldId]: {
                    [YjsDatabaseKey.field_type]: 0,
                    [YjsDatabaseKey.data]: 'Hello',
                    [YjsDatabaseKey.created_at]: '1',
                    [YjsDatabaseKey.last_modified]: '1',
                  },
                },
              },
              [YjsEditorKey.meta]: {},
            },
          },
          row_documents: {},
        },
      },
    };

    const { doc, rowMap } = createDatabaseYjsRenderDocsFromSnapshot(snapshot);
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const view = database.get(YjsDatabaseKey.views).get(viewId);
    const filters = view.get(YjsDatabaseKey.filters);
    const groups = view.get(YjsDatabaseKey.groups);
    const row = rowMap[rowId]
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells).get(fieldId);

    expect(doc.guid).toBe(databaseId);
    expect(doc.object_id).toBe(databaseId);
    expect(doc.view_id).toBe(viewId);
    expect(database.get(YjsDatabaseKey.id)).toBe(databaseId);
    expect(view.get(YjsDatabaseKey.row_orders)).toBeInstanceOf(Y.Array);
    expect(view.get(YjsDatabaseKey.row_orders).toJSON()).toEqual([{ id: rowId, height: 36 }]);
    expect(filters).toBeInstanceOf(Y.Array);
    expect(filters.get(0).get(YjsDatabaseKey.children)).toBeInstanceOf(Y.Array);
    expect(filters.get(0).get(YjsDatabaseKey.children)?.get(0).get(YjsDatabaseKey.id)).toBe(childFilterId);
    expect(groups).toBeInstanceOf(Y.Array);
    expect(groups.get(0).get(YjsDatabaseKey.groups)).toBeInstanceOf(Y.Array);
    expect(rowMap[rowId].guid).toBe(`${databaseId}_rows_${rowId}`);
    expect(getPublishedDatabaseRenderRowMap(doc)?.[rowId]).toBe(rowMap[rowId]);
    expect(row.get(YjsDatabaseKey.id)).toBe(rowId);
    expect(cell.get(YjsDatabaseKey.data)).toBe('Hello');
  });
});

describe('chart layout settings in a published snapshot', () => {
  const databaseId = 'database-id';
  const viewId = 'chart-view-id';
  const DESKTOP_INTEGER_KEYS = ['chart_type', 'aggregation_type', 'date_condition', 'aggregation_type_pb'];

  /** The server builds `layout_settings` with `collab.to_json_value()`: every yrs integer arrives as a JSON number. */
  function chartSnapshot(layoutSettings: Record<string, PublishedJsonObject>): PublishedDatabaseSnapshot {
    return {
      schemaVersion: 1,
      kind: 'database',
      namespace: 'namespace',
      publishName: 'publish-name',
      view: {
        viewId,
        name: 'Published chart',
        icon: null,
        extra: null,
        layout: ViewLayout.Grid,
        childViews: [],
        ancestorViews: [],
        visibleViewIds: [viewId],
        databaseRelations: {},
      },
      database: {
        databaseId,
        activeViewId: viewId,
        visibleViewIds: [viewId],
        fields: [],
        views: [{ viewId, name: 'Chart', layout: DatabaseViewLayout.Chart, fieldIds: [], rowIds: [] }],
        rows: [],
        raw: {
          database: {
            [YjsDatabaseKey.id]: databaseId,
            [YjsDatabaseKey.fields]: {},
            [YjsDatabaseKey.views]: {
              [viewId]: {
                [YjsDatabaseKey.database_id]: databaseId,
                [YjsDatabaseKey.name]: 'Chart',
                [YjsDatabaseKey.layout]: DatabaseViewLayout.Chart,
                [YjsDatabaseKey.field_orders]: [],
                [YjsDatabaseKey.row_orders]: [],
                [YjsDatabaseKey.layout_settings]: layoutSettings,
              },
            },
            [YjsDatabaseKey.metas]: {},
          },
          rows: {},
          row_documents: {},
        },
      },
    };
  }

  function readChart(snapshot: PublishedDatabaseSnapshot) {
    const { doc } = createDatabaseYjsRenderDocsFromSnapshot(snapshot);
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const layoutSettings = database.get(YjsDatabaseKey.views).get(viewId).get(YjsDatabaseKey.layout_settings);
    const chart = layoutSettings.get(CHART_LAYOUT_SETTINGS_KEY) as unknown as Y.Map<unknown>;

    return { layoutSettings, chart, setting: readChartLayoutSetting(chart) };
  }

  it('restores the BigInt tag the server JSON erased, so Line / Median / Day read back', () => {
    const { chart, setting } = readChart(
      chartSnapshot({
        [CHART_LAYOUT_SETTINGS_KEY]: {
          chart_type: 1,
          x_field_id: 'x',
          show_empty_values: false,
          aggregation_type: 0,
          y_field_id: 'y',
          date_condition: 1,
          aggregation_type_pb: 5,
        },
      })
    );

    expect(setting).toEqual({
      chartType: ChartType.Line,
      xFieldId: 'x',
      omitEmptyValues: false,
      aggregationType: ChartAggregationType.Median,
      yFieldId: 'y',
      dateCondition: DateGroupCondition.Day,
    });
    DESKTOP_INTEGER_KEYS.forEach((key) => expect(typeof chart.get(key)).toBe('bigint'));
    expect(chart.get('x_field_id')).toBe('x');
    expect(chart.get('show_empty_values')).toBe(false);
  });

  it('still reads the legacy camelCase keys of a chart authored by an older web build', () => {
    const { chart, setting } = readChart(
      chartSnapshot({
        [CHART_LAYOUT_SETTINGS_KEY]: {
          chartType: 1,
          xFieldId: 'x',
          showEmptyValues: true,
          aggregationType: 5,
          yFieldId: 'y',
          dateCondition: 1,
        },
      })
    );

    expect(setting).toEqual({
      chartType: ChartType.Line,
      xFieldId: 'x',
      omitEmptyValues: false,
      aggregationType: ChartAggregationType.Median,
      yFieldId: 'y',
      dateCondition: DateGroupCondition.Day,
    });
    expect(chart.get('aggregationType')).toBe(5);
    expect(chart.get('dateCondition')).toBe(1);
  });

  it('decodes the desktop keys of a legacy chart edited in this build, sidecars included', () => {
    const { setting } = readChart(
      chartSnapshot({
        [CHART_LAYOUT_SETTINGS_KEY]: {
          // Legacy: Line / Median / Day.
          chartType: 1,
          xFieldId: 'x',
          aggregationType: 5,
          yFieldId: 'y',
          dateCondition: 1,
          // Desktop keys written since: Bar / Sum / Year.
          chart_type: 0,
          x_field_id: 'x',
          show_empty_values: true,
          aggregation_type: 1,
          y_field_id: 'y',
          date_condition: 4,
          aggregation_type_pb: 1,
        },
      })
    );

    expect(setting).toEqual({
      chartType: ChartType.Bar,
      xFieldId: 'x',
      omitEmptyValues: true,
      aggregationType: ChartAggregationType.Sum,
      yFieldId: 'y',
      dateCondition: DateGroupCondition.Year,
    });
  });

  it('leaves the other layouts, and a view without a chart entry, as plain JSON values', () => {
    const { layoutSettings, setting } = readChart(chartSnapshot({ '5': { card_size: 1 } }));

    expect(setting).toBeNull();
    expect((layoutSettings.get('5') as unknown as Y.Map<unknown>).get('card_size')).toBe(1);
  });
});
