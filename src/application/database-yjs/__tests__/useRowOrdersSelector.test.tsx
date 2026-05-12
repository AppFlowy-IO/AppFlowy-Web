import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
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
  YDatabaseField,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseSorts,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createCell, createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

type DatabaseFixture = {
  databaseDoc: YDoc;
  filters: YDatabaseFilters;
  rowMap: Record<RowId, YDoc>;
  viewId: string;
};

const databaseId = 'database-id';
const fieldId = 'description-field';

function createTextField() {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Description');
  field.set(YjsDatabaseKey.type, FieldType.RichText);

  return field;
}

function createTextFilter(content: string) {
  const filter = new Y.Map() as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, 'filter-id');
  filter.set(YjsDatabaseKey.field_id, fieldId);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, TextFilterCondition.TextContains);
  filter.set(YjsDatabaseKey.content, content);

  return filter;
}

function createDatabaseFixture(): DatabaseFixture {
  const viewId = 'view-id';
  const databaseDoc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const fields = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: RowId; height: number }>();
  const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
  const sorts = new Y.Array() as YDatabaseSorts;

  fields.set(fieldId, createTextField());
  rowOrders.push([
    { id: 'row-c', height: 44 },
    { id: 'row-a', height: 44 },
    { id: 'row-b', height: 44 },
  ]);

  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  views.set(viewId, view);

  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return {
    databaseDoc,
    filters,
    rowMap: {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'match first'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'match second'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'skip'),
      }),
    },
    viewId,
  };
}

function createWrapper(fixture: DatabaseFixture) {
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc: fixture.databaseDoc,
    databasePageId: fixture.viewId,
    activeViewId: fixture.viewId,
    rowMap: fixture.rowMap,
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('useRowOrdersSelector', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not expose stale row order after a filter is applied', async () => {
    const fixture = createDatabaseFixture();
    const renderedOrders: Array<string[] | undefined> = [];
    const { result } = renderHook(
      () => {
        const rows = useRowOrdersSelector();

        renderedOrders.push(rows?.map((row) => row.id));
        return rows;
      },
      {
        wrapper: createWrapper(fixture),
      }
    );

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-c', 'row-a', 'row-b']);
    });

    const renderCountBeforeFilter = renderedOrders.length;

    act(() => {
      fixture.filters.push([createTextFilter('match')]);
    });

    const ordersRenderedAfterFilter = renderedOrders.slice(renderCountBeforeFilter);

    expect(ordersRenderedAfterFilter).not.toContainEqual(['row-c', 'row-a', 'row-b']);

    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(result.current?.map((row) => row.id)).toEqual(['row-a', 'row-b']);
    });
  });
});
