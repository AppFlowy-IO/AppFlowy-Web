/**
 * `useChartData` under a real `DatabaseContext`, with the real
 * `useRowOrdersSelector` / `useRowMap`: an unsorted, unfiltered view, where
 * nothing but the chart's own row observers can notice an in-place edit.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, useMemo } from 'react';
import * as Y from 'yjs';

// Real English strings, so labels read like the UI ("No Status", "Jan 2026").
jest.mock('react-i18next', () => {
  const i18n = jest.requireActual('i18next').createInstance();

  i18n.init({
    lng: 'en',
    initImmediate: false,
    resources: { en: { translation: jest.requireActual('@/@types/translations/en.json') } },
  });
  const t = i18n.t.bind(i18n);

  return { useTranslation: () => ({ t }) };
});

import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DEFAULT_CHART_EXTENDED_SETTINGS } from '@/application/database-yjs/chart-extended-settings';
import { ChartAggregationType, ChartDataItem, ChartLayoutSettings, ChartType } from '@/application/database-yjs/chart.type';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { SelectOption, SelectOptionColor } from '@/application/database-yjs/fields';
import {
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseFieldTypeOption,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YMapFieldTypeOption,
} from '@/application/types';

import { useChartData } from './useChartData';
import { toCategoryItems } from './chartSeries';

const DATABASE_ID = 'chart-database';
const VIEW_ID = 'chart-view';

interface FieldSpec {
  id: string;
  name: string;
  type: FieldType;
  options?: SelectOption[];
}

const STATUS_FIELD: FieldSpec = {
  id: 'status',
  name: 'Status',
  type: FieldType.SingleSelect,
  options: [
    { id: 'opt-todo', name: 'Todo', color: SelectOptionColor.OptionColor1 },
    { id: 'opt-done', name: 'Done', color: SelectOptionColor.OptionColor2 },
  ],
};
const AMOUNT_FIELD: FieldSpec = { id: 'amount', name: 'Amount', type: FieldType.Number };
const EDITED_FIELD: FieldSpec = { id: 'edited', name: 'Last edited', type: FieldType.LastEditedTime };

function createField({ id, name, type, options }: FieldSpec): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, type);
  if (options) {
    const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
    const typeOption = new Y.Map() as YMapFieldTypeOption;

    field.set(YjsDatabaseKey.type_option, typeOptions);
    typeOptions.set(String(type), typeOption);
    typeOption.set(YjsDatabaseKey.content, JSON.stringify({ options, disable_color: false }));
  }

  return field;
}

function createFixture({
  fields,
  rows,
  dataSource,
}: {
  fields: FieldSpec[];
  rows: Record<RowId, YDoc>;
  dataSource?: DatabaseContextState['dataSource'];
}) {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fieldMap = new Y.Map<YDatabaseField>();
  const views = new Y.Map<unknown>();
  const view = new Y.Map<unknown>();
  const rowOrders = new Y.Array<{ id: RowId; height: number }>();
  const fieldOrders = new Y.Array<{ id: string }>();

  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.fields, fieldMap);
  database.set(YjsDatabaseKey.views, views);
  views.set(VIEW_ID, view);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  fields.forEach((spec) => fieldMap.set(spec.id, createField(spec)));
  fieldOrders.push(fields.map(({ id }) => ({ id })));
  rowOrders.push(Object.keys(rows).map((id) => ({ id, height: 36 })));

  const context: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    databasePageId: VIEW_ID,
    activeViewId: VIEW_ID,
    rowMap: rows,
    workspaceId: 'workspace',
    ensureRow: async (rowId) => rows[rowId],
    dataSource,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  return { wrapper, rows };
}

function statusRows(): Record<RowId, YDoc> {
  return {
    r1: createRowDoc('r1', DATABASE_ID, {
      status: createCell(FieldType.SingleSelect, 'opt-todo'),
      amount: createCell(FieldType.Number, '10'),
    }),
    r2: createRowDoc('r2', DATABASE_ID, {
      status: createCell(FieldType.SingleSelect, 'opt-done'),
      amount: createCell(FieldType.Number, '5'),
    }),
  };
}

const summarize = (data: ChartDataItem[]) => data.map(({ label, value }) => [label, value]);
const rowOf = (doc: YDoc) => doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
const cellOf = (doc: YDoc, fieldId: string) => rowOf(doc).get(YjsDatabaseKey.cells).get(fieldId);
/** Two animation frames: enough for a coalesced publish, or its absence, to land. */
const settleFrames = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );

function renderLiveChart(wrapper: ReturnType<typeof createFixture>['wrapper'], patch: Partial<ChartLayoutSettings>) {
  const settings: ChartLayoutSettings = {
    chartType: ChartType.Bar, xFieldId: '', aggregationType: ChartAggregationType.Count,
    showEmptyValues: true, cumulative: false, dateCondition: DateGroupCondition.Month,
    extended: { ...DEFAULT_CHART_EXTENDED_SETTINGS, xSort: 'label_asc' }, ...patch,
  };

  return renderHook(() => {
    const data = useChartData({ settings });
    const chartData = useMemo(() => toCategoryItems(data.seriesData), [data.seriesData]);

    return { ...data, chartData };
  }, { wrapper });
}

describe('useChartData live row updates', () => {
  it('moves a row to another bucket when its select cell is edited in place', async () => {
    const { wrapper, rows } = createFixture({ fields: [STATUS_FIELD, AMOUNT_FIELD], rows: statusRows() });
    const { result } = renderLiveChart(wrapper, { xFieldId: 'status' });

    await waitFor(() =>
      expect(summarize(result.current.chartData)).toEqual([
        ['Done', 1],
        ['Todo', 1],
      ])
    );

    // What the drill-down's row peek, a collaborator or desktop does.
    act(() => {
      cellOf(rows.r1, 'status').set(YjsDatabaseKey.data, 'opt-done');
    });

    await waitFor(() =>
      expect(summarize(result.current.chartData)).toEqual([
        ['Done', 2],
      ])
    );
    expect(result.current.chartData[0].rowIds).toEqual(['r1', 'r2']);
  });

  it('updates Sum when a Number cell of the Y field is edited in place', async () => {
    const { wrapper, rows } = createFixture({ fields: [STATUS_FIELD, AMOUNT_FIELD], rows: statusRows() });
    const { result } = renderLiveChart(wrapper, {
      xFieldId: 'status',
      aggregationType: ChartAggregationType.Sum,
      yFieldId: 'amount',
    });

    await waitFor(() =>
      expect(summarize(result.current.chartData)).toEqual([
        ['Done', 5],
        ['Todo', 10],
      ])
    );

    act(() => {
      cellOf(rows.r1, 'amount').set(YjsDatabaseKey.data, '100');
    });

    await waitFor(() =>
      expect(summarize(result.current.chartData)).toEqual([
        ['Done', 5],
        ['Todo', 100],
      ])
    );
  });

  it('re-buckets a row whose doc opened empty once a sync fills it in place', async () => {
    const rows = { ...statusRows(), r3: new Y.Doc() as YDoc };
    const { wrapper } = createFixture({ fields: [STATUS_FIELD], rows });
    const { result } = renderLiveChart(wrapper, { xFieldId: 'status' });

    await waitFor(() =>
      expect(summarize(result.current.chartData)).toEqual([
        ['Done', 1],
        ['Todo', 1],
        ['No Status', 1],
      ])
    );

    const source = createRowDoc('r3', DATABASE_ID, { status: createCell(FieldType.SingleSelect, 'opt-todo') });

    act(() => {
      // A remote update applied to the same Y.Doc instance that is in rowMap.
      Y.applyUpdate(rows.r3, Y.encodeStateAsUpdate(source));
    });

    await waitFor(() =>
      expect(summarize(result.current.chartData)).toEqual([
        ['Done', 1],
        ['Todo', 2],
      ])
    );
  });

  it('follows an in-place last_modified bump for a Last edited time axis', async () => {
    const jan = String(Math.floor(new Date(2026, 0, 15).getTime() / 1000));
    const feb = String(Math.floor(new Date(2026, 1, 15).getTime() / 1000));
    const rows: Record<RowId, YDoc> = {
      r1: createRowDoc('r1', DATABASE_ID, {}, '0', jan),
      r2: createRowDoc('r2', DATABASE_ID, {}, '0', feb),
    };
    const { wrapper } = createFixture({ fields: [EDITED_FIELD], rows });
    const { result } = renderLiveChart(wrapper, { xFieldId: 'edited', dateCondition: DateGroupCondition.Month, extended: DEFAULT_CHART_EXTENDED_SETTINGS });

    await waitFor(() =>
      expect(summarize(result.current.chartData)).toEqual([
        ['Jan 2026', 1],
        ['Feb 2026', 1],
      ])
    );

    act(() => {
      rowOf(rows.r1).set(YjsDatabaseKey.last_modified, feb);
    });

    await waitFor(() => expect(summarize(result.current.chartData)).toEqual([['Feb 2026', 2]]));
  });

  it('does not recompute for edits to fields the chart does not read', async () => {
    const { wrapper, rows } = createFixture({ fields: [STATUS_FIELD, AMOUNT_FIELD], rows: statusRows() });
    const { result } = renderLiveChart(wrapper, { xFieldId: 'status' });

    await waitFor(() =>
      expect(summarize(result.current.chartData)).toEqual([
        ['Done', 1],
        ['Todo', 1],
      ])
    );
    const before = result.current.chartData;

    act(() => {
      cellOf(rows.r1, 'amount').set(YjsDatabaseKey.data, '100');
      rowOf(rows.r1).set(YjsDatabaseKey.last_modified, '1');
    });
    await settleFrames();

    expect(result.current.chartData).toBe(before);
  });

  it('attaches no row observers to a historical snapshot', async () => {
    const rows = statusRows();
    const observeDeep = jest.spyOn(rows.r1.getMap(YjsEditorKey.data_section), 'observeDeep');
    const { wrapper } = createFixture({
      fields: [STATUS_FIELD],
      rows,
      dataSource: { type: 'history', id: 'snapshot' },
    });
    const { result } = renderLiveChart(wrapper, { xFieldId: 'status' });

    await waitFor(() =>
      expect(summarize(result.current.chartData)).toEqual([
        ['Done', 1],
        ['Todo', 1],
      ])
    );
    const before = result.current.chartData;

    act(() => {
      cellOf(rows.r1, 'status').set(YjsDatabaseKey.data, 'opt-done');
    });
    await settleFrames();

    expect(observeDeep).not.toHaveBeenCalled();
    expect(result.current.chartData).toBe(before);
  });
});
