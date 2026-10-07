import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FilterType,
  TextFilterCondition,
  useRowOrdersSelector,
} from '@/application/database-yjs';
import {
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRowOrders,
  YDatabaseSorts,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createCell, createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/application/database-yjs/hooks/useRelativeDateFilterRefresh', () => ({
  useRelativeDateFilterRefresh: () => undefined,
}));

// The background loader's cache: copies (a seed, an IndexedDB snapshot) of the
// rows the consumer's row map lacks, or holds without row data yet.
const loader: { cachedRowDocs: Record<RowId, YDoc> } = { cachedRowDocs: {} };

jest.mock('@/application/database-yjs/hooks/useBackgroundRowDocLoader', () => ({
  useBackgroundRowDocLoader: () => ({
    cachedRowDocs: loader.cachedRowDocs,
    getCachedRowDocs: () => loader.cachedRowDocs,
    subscribeToCachedRowDocChanges: () => () => undefined,
  }),
}));

const databaseId = 'database-id';
const viewId = 'view-id';
const statusFieldId = 'status-field';

function createStatusField() {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, statusFieldId);
  field.set(YjsDatabaseKey.name, 'Status');
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  return field;
}

function createStatusFilter(content: string) {
  const filter = new Y.Map() as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, 'view-filter');
  filter.set(YjsDatabaseKey.field_id, statusFieldId);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, TextFilterCondition.TextIs);
  filter.set(YjsDatabaseKey.content, content);
  return filter;
}

function statusRow(rowId: string, status: string) {
  return createRowDoc(rowId, databaseId, { [statusFieldId]: createCell(FieldType.RichText, status) });
}

function createDatabaseDoc(rowIds: string[]) {
  const databaseDoc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: RowId; height: number }>() as unknown as YDatabaseRowOrders;
  const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;

  fields.set(statusFieldId, createStatusField());
  (rowOrders as unknown as Y.Array<{ id: RowId; height: number }>).push(rowIds.map((id) => ({ id, height: 36 })));
  filters.push([createStatusFilter('done')]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, new Y.Array() as YDatabaseSorts);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);
  return databaseDoc;
}

function renderRowOrders(databaseDoc: YDoc, rowMap: Record<RowId, YDoc>) {
  const wrapper = ({ children }: { children: ReactNode }) => {
    const value: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap,
      workspaceId: 'workspace-id',
      isDashboardWidget: true,
    };

    return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
  };

  return renderHook(() => useRowOrdersSelector(), { wrapper });
}

function ids(rows: { id: string }[] | undefined) {
  return rows?.map((row) => row.id);
}

describe('useRowOrdersSelector with a live row doc shadowed by a cached copy', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    loader.cachedRowDocs = {};
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // A row created in another widget of the dashboard reaches this view's row
  // map as a live doc that has no row data yet, while the loader holds a copy
  // taken before the row was edited. The conditions must follow the live doc
  // once it has its cells, as the user's later edit lands there.
  it('re-reads the live doc once it has row data, so a later cell edit reaches the filter', async () => {
    const liveNewRow = new Y.Doc() as YDoc;
    const databaseDoc = createDatabaseDoc(['row-a', 'row-b', 'row-new']);

    loader.cachedRowDocs = { 'row-new': statusRow('row-new', 'todo') };
    const { result } = renderRowOrders(databaseDoc, {
      'row-a': statusRow('row-a', 'done'),
      'row-b': statusRow('row-b', 'todo'),
      'row-new': liveNewRow,
    });

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-a']);
    });

    // The live doc receives its row, edited to match the filter.
    act(() => {
      Y.applyUpdate(liveNewRow, Y.encodeStateAsUpdate(statusRow('row-new', 'done')));
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-a', 'row-new']);
    });
  });

  it('keeps reading a live doc that already had row data when the copy arrived', async () => {
    const liveNewRow = statusRow('row-new', 'done');
    const databaseDoc = createDatabaseDoc(['row-a', 'row-new']);

    loader.cachedRowDocs = { 'row-new': statusRow('row-new', 'todo') };
    const { result } = renderRowOrders(databaseDoc, {
      'row-a': statusRow('row-a', 'todo'),
      'row-new': liveNewRow,
    });

    await waitFor(() => {
      expect(ids(result.current)).toEqual(['row-new']);
    });
  });
});
