/**
 * The chart drill-down under a real `DatabaseContext`: the clicked category
 * becomes an editable chip over the whole database (rows the view's own filter
 * hides included), rules added from the popup narrow the grid, and none of it
 * is written to the view.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

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
jest.mock('@/components/main/app.hooks', () => ({
  ...jest.requireActual('@/components/main/app.hooks'),
  useCurrentUser: () => undefined,
}));

import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { DEFAULT_CHART_LAYOUT_SETTINGS } from '@/application/database-yjs/chart-layout-setting';
import { ChartClickItem, ChartType } from '@/application/database-yjs/chart.type';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { NumberFilterCondition, SelectOptionColor } from '@/application/database-yjs/fields';
import {
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseFieldTypeOption,
  YDoc,
  YjsDatabaseKey as K,
  YjsEditorKey,
  YMapFieldTypeOption,
} from '@/application/types';
import { ChartContext, ChartContextValue } from '@/components/database/chart/useChartContext';

import { ChartRowListPopup } from '../ChartRowListPopup';

const DATABASE_ID = 'database';
const VIEW_ID = 'view';

function field(id: string, type: FieldType, extra: (map: YDatabaseField) => void = () => undefined) {
  const map = new Y.Map() as YDatabaseField;

  map.set(K.id, id);
  map.set(K.name, id);
  map.set(K.type, type);
  extra(map);
  return map;
}

function setup() {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map<unknown>();
  const view = new Y.Map<unknown>();
  const rowOrders = new Y.Array<{ id: RowId; height: number }>();
  const fieldOrders = new Y.Array<{ id: string }>();
  const viewFilters = new Y.Array<Y.Map<unknown>>();

  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(K.id, DATABASE_ID);
  database.set(K.fields, fields);
  database.set(K.views, views);
  views.set(VIEW_ID, view);
  view.set(K.row_orders, rowOrders);
  view.set(K.filters, viewFilters);
  view.set(K.sorts, new Y.Array());
  view.set(K.field_orders, fieldOrders);

  fields.set('name', field('name', FieldType.RichText, (map) => map.set(K.is_primary, true)));
  const status = field('status', FieldType.SingleSelect, (map) => {
    const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
    const typeOption = new Y.Map() as YMapFieldTypeOption;

    map.set(K.type_option, typeOptions);
    typeOptions.set(String(FieldType.SingleSelect), typeOption);
    typeOption.set(
      K.content,
      JSON.stringify({
        options: [
          { id: 'todo', name: 'Todo', color: SelectOptionColor.OptionColor1 },
          { id: 'done', name: 'Done', color: SelectOptionColor.OptionColor2 },
        ],
        disable_color: false,
      })
    );
  });

  fields.set('status', status);
  fields.set('amount', field('amount', FieldType.Number));
  fields.set('created', field('created', FieldType.CreatedTime));
  fieldOrders.push([{ id: 'name' }, { id: 'status' }, { id: 'amount' }, { id: 'created' }]);

  // The view hides amounts of 20 and more; the chart's bars count what is left.
  const viewRule = new Y.Map<unknown>();

  viewFilters.push([viewRule]);
  viewRule.set(K.id, 'view-rule');
  viewRule.set(K.field_id, 'amount');
  viewRule.set(K.type, FieldType.Number);
  viewRule.set(K.filter_type, FilterType.Data);
  viewRule.set(K.condition, NumberFilterCondition.LessThan);
  viewRule.set(K.content, '20');

  const rows: Record<RowId, YDoc> = {
    r1: createRowDoc('r1', DATABASE_ID, {
      name: createCell(FieldType.RichText, 'Alpha'),
      status: createCell(FieldType.SingleSelect, 'todo'),
      amount: createCell(FieldType.Number, '10'),
    }),
    r2: createRowDoc('r2', DATABASE_ID, {
      name: createCell(FieldType.RichText, 'Beta'),
      status: createCell(FieldType.SingleSelect, 'done'),
      amount: createCell(FieldType.Number, '5'),
    }),
    r3: createRowDoc('r3', DATABASE_ID, {
      name: createCell(FieldType.RichText, 'Gamma'),
      status: createCell(FieldType.SingleSelect, 'todo'),
      amount: createCell(FieldType.Number, '30'),
    }),
  };

  rowOrders.push(Object.keys(rows).map((id) => ({ id, height: 36 })));

  const navigateToRow = jest.fn();
  const context: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    databasePageId: VIEW_ID,
    activeViewId: VIEW_ID,
    rowMap: rows,
    workspaceId: 'workspace',
    ensureRow: async (rowId) => rows[rowId],
    navigateToRow,
    blobPrefetchComplete: true,
  };
  const chart: ChartContextValue = {
    chartType: ChartType.Bar,
    settings: { ...DEFAULT_CHART_LAYOUT_SETTINGS, xFieldId: 'status' },
    chartData: [],
    isLoading: false,
    xAxisField: status,
    fieldType: FieldType.SingleSelect,
    aggregationType: DEFAULT_CHART_LAYOUT_SETTINGS.aggregationType,
    selectOptions: [],
    hasGroupableFields: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>
      <ChartContext.Provider value={chart}>{children}</ChartContext.Provider>
    </DatabaseContext.Provider>
  );

  return { databaseDoc, viewFilters, navigateToRow, wrapper };
}

const ITEM: ChartClickItem = { label: 'Todo', value: 1, rowIds: ['r1'], color: '#e8e0ff' };

const LAYOUT_SIZES = [
  ['offsetHeight', 600],
  ['offsetWidth', 560],
] as const;
const originalLayout = new Map<string, PropertyDescriptor | undefined>();

const listedRowIds = () =>
  screen.queryAllByTestId('chart-row-popup-row').map((row) => row.getAttribute('data-row-id'));

beforeAll(() => {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
  global.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
  // jsdom lays nothing out; give the grid's scroll area a size so the row
  // virtualizer mounts the rows in view.
  for (const [property, size] of LAYOUT_SIZES) {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);

    originalLayout.set(property, original);
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === 'chart-row-popup-grid' ? size : original?.get?.call(this) ?? 0;
      },
    });
  }
});

afterAll(() => {
  originalLayout.forEach((descriptor, property) => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, property, descriptor);
  });
});

describe('ChartRowListPopup', () => {
  it('lists the category across the whole database, with a column per visible field', async () => {
    const { databaseDoc, viewFilters, navigateToRow, wrapper } = setup();
    const before = Y.encodeStateVector(databaseDoc);
    const onClose = jest.fn();

    render(<ChartRowListPopup open item={ITEM} onClose={onClose} />, { wrapper });

    expect(screen.getByTestId('chart-row-popup-title').textContent).toBe('Todo');
    // The bar's only row, and the Todo row the view's own filter hides.
    await waitFor(() => expect(listedRowIds()).toEqual(['r1', 'r3']));
    expect(within(screen.getByTestId('chart-row-popup-filter-bar')).getByTestId('database-filter-condition').textContent).toContain(
      'status'
    );

    const grid = screen.getByTestId('chart-row-popup-grid');

    for (const name of ['name', 'status', 'amount']) expect(within(grid).getAllByText(name).length).toBeGreaterThan(0);
    // Desktop leaves the row timestamps out of the popup.
    expect(within(grid).queryByText('created')).toBeNull();

    fireEvent.click(screen.getAllByTestId('chart-row-popup-row')[1]);
    expect(onClose).toHaveBeenCalled();
    expect(navigateToRow).toHaveBeenCalledWith('r3');
    expect(Y.encodeStateVector(databaseDoc)).toEqual(before);
    expect(viewFilters.length).toBe(1);
  });

  it('narrows the rows with a rule added in the popup, without writing to the view', async () => {
    const { databaseDoc, viewFilters, wrapper } = setup();
    const before = Y.encodeStateVector(databaseDoc);

    render(<ChartRowListPopup open item={ITEM} onClose={jest.fn()} />, { wrapper });
    await waitFor(() => expect(listedRowIds()).toEqual(['r1', 'r3']));

    act(() => {
      fireEvent.click(screen.getByTestId('chart-row-popup-add-filter'));
    });
    fireEvent.click(await screen.findByText('amount', { selector: 'div.flex-1' }));

    // The new rule opens its editor straight away.
    fireEvent.change(await screen.findByTestId('text-filter-input'), { target: { value: '30' } });

    await waitFor(() => expect(listedRowIds()).toEqual(['r3']));
    expect(screen.getAllByTestId('database-filter-condition')).toHaveLength(2);
    expect(Y.encodeStateVector(databaseDoc)).toEqual(before);
    expect(viewFilters.toJSON()).toEqual([expect.objectContaining({ id: 'view-rule', content: '20' })]);
  });

  it('keeps to the bucket rows when the category cannot be written as a rule', async () => {
    const { wrapper } = setup();

    render(<ChartRowListPopup open item={{ ...ITEM, label: 'Renamed since' }} onClose={jest.fn()} />, { wrapper });

    await waitFor(() => expect(listedRowIds()).toEqual(['r1']));
    expect(screen.queryAllByTestId('database-filter-condition')).toHaveLength(0);
  });
});
