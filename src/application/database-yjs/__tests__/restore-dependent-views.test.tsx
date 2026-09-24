import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, FilterType, SortCondition } from '@/application/database-yjs/database.type';
import { createFields } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { NumberFilterCondition } from '@/application/database-yjs/fields/number/number.type';
import { invalidateDatabaseDependenciesAfterRestore } from '@/application/database-yjs/restore-dependencies';
import { useCellSelector, useRowOrdersSelector } from '@/application/database-yjs/selector';
import {
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createRelationRollupFixtureFromV069 } from './test-helpers';

it('updates an open formula filter and sort when its rollup target is restored twice', async () => {
  const fixture = createRelationRollupFixtureFromV069({
    suffix: 'restore-dependent-view',
    baseRows: [
      { title: 'First', relatedNames: ['Olaf'] },
      { title: 'Second', relatedNames: ['Beatrice'] },
    ],
  });
  const sourceField = 'formula';
  const formula = createFields([
    {
      id: sourceField,
      name: 'Twice',
      type: FieldType.Formula,
      typeOption: { expression: `prop("${fixture.rollupSumFieldId}") * 2` },
    },
  ])
    .get(sourceField)
    .clone();
  fixture.baseFields.set(sourceField, formula);
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map() as YDatabaseViews;
  const filter = new Y.Map() as YDatabaseFilter;
  const filters = new Y.Array() as YDatabaseFilters;
  filter.set(YjsDatabaseKey.id, 'filter');
  filter.set(YjsDatabaseKey.field_id, sourceField);
  filter.set(YjsDatabaseKey.type, FieldType.Formula);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, NumberFilterCondition.GreaterThan);
  filter.set(YjsDatabaseKey.content, '30');
  filters.push([filter]);
  const sort = new Y.Map() as YDatabaseSort;
  const sorts = new Y.Array() as YDatabaseSorts;
  sort.set(YjsDatabaseKey.id, 'sort');
  sort.set(YjsDatabaseKey.field_id, sourceField);
  sort.set(YjsDatabaseKey.condition, SortCondition.Ascending);
  sorts.push([sort]);
  view.set(YjsDatabaseKey.id, 'view');
  view.set(YjsDatabaseKey.row_orders, Y.Array.from(fixture.baseRows));
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  views.set('view', view);
  fixture.baseDatabase.set(YjsDatabaseKey.views, views);
  const targetRows = fixture.baseRowIds.map((id) => {
    const source = fixture.baseRowMetas[id].getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);
    return source.get(YjsDatabaseKey.cells).get(fixture.relationFieldId).get(YjsDatabaseKey.data).toArray()[0];
  });
  const clone = (doc: YDoc) => {
    const next = new Y.Doc({ guid: doc.guid }) as YDoc;
    Y.applyUpdate(next, Y.encodeStateAsUpdate(doc));
    return next;
  };
  let root = fixture.relatedFixture.databaseDoc;
  let rows = fixture.relatedFixture.rowMetas;
  const setAmounts = (values: number[]) =>
    values.forEach((value, index) => {
      rows[targetRows[index]]
        .getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database_row)
        .get(YjsDatabaseKey.cells)
        .get(fixture.amountFieldId)
        .set(YjsDatabaseKey.data, String(value));
    });
  setAmounts([10, 20]);
  const context: DatabaseContextState = {
    databaseDoc: fixture.baseDoc,
    databasePageId: 'view',
    activeViewId: 'view',
    workspaceId: 'workspace',
    readOnly: false,
    rowMap: fixture.baseRowMetas,
    loadView: async () => root,
    createRow: async (key) => rows[key.split('_rows_').pop()!],
    getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );
  const opened = renderHook(
    () => ({
      ids: useRowOrdersSelector()?.map(({ id }) => id),
      first: useCellSelector({ rowId: fixture.baseRowIds[0], fieldId: sourceField })?.data,
    }),
    { wrapper }
  );
  await waitFor(() => {
    expect(opened.result.current.ids).toEqual([fixture.baseRowIds[1]]);
    expect(opened.result.current.first).toBe('20');
  });
  for (const [amounts, expected] of [
    [[30, 5], [fixture.baseRowIds[0]]],
    [
      [50, 40],
      [fixture.baseRowIds[1], fixture.baseRowIds[0]],
    ],
  ] as const) {
    act(() => {
      const nextRoot = clone(root);
      const nextRows = Object.fromEntries(Object.entries(rows).map(([id, doc]) => [id, clone(doc)]));
      root.destroy();
      Object.values(rows).forEach((doc) => doc.destroy());
      root = nextRoot;
      rows = nextRows;
      setAmounts([...amounts]);
      invalidateDatabaseDependenciesAfterRestore();
    });
    await waitFor(() => {
      expect(opened.result.current.ids).toEqual([...expected]);
      expect(opened.result.current.first).toBe(String(amounts[0] * 2));
    });
  }
  opened.unmount();
});
