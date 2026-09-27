import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { calculateFieldValue } from '@/application/database-yjs/calculation';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { CalculationType, FieldType, FilterType, SortCondition } from '@/application/database-yjs/database.type';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { NumberFilterCondition } from '@/application/database-yjs/fields/number/number.type';
import { useFieldCellsByRowsSelector, useRowOrdersSelector } from '@/application/database-yjs/selector';
import {
  YDatabase,
  YDatabaseFields,
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

it('reopens formula filters, sorts, and footers using edits made while closed', async () => {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = createFields([
    { id: 'input', name: 'Input', type: FieldType.Number },
    { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression: 'prop("input") * 2' } },
  ]).clone() as YDatabaseFields;
  const rows = [2, 4, 6].map((value, index) => ({
    id: `row-${index}`,
    ...createRow(`row-${index}`, { input: { type: FieldType.Number, data: String(value) } }),
  }));
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map() as YDatabaseViews;
  const filter = new Y.Map() as YDatabaseFilter;
  const filters = new Y.Array() as YDatabaseFilters;
  const sort = new Y.Map() as YDatabaseSort;
  const sorts = new Y.Array() as YDatabaseSorts;

  filter.set(YjsDatabaseKey.id, 'filter');
  filter.set(YjsDatabaseKey.field_id, 'formula');
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, NumberFilterCondition.GreaterThan);
  filter.set(YjsDatabaseKey.content, '5');
  filter.set(YjsDatabaseKey.type, FieldType.Formula);
  filters.push([filter]);
  sort.set(YjsDatabaseKey.id, 'sort');
  sort.set(YjsDatabaseKey.field_id, 'formula');
  sort.set(YjsDatabaseKey.condition, SortCondition.Ascending);
  sorts.push([sort]);
  view.set(YjsDatabaseKey.id, 'view');
  view.set(YjsDatabaseKey.row_orders, Y.Array.from(rows.map(({ id }) => ({ id, height: 44 }))));
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  views.set('view', view);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const context: DatabaseContextState = {
    databaseDoc,
    databasePageId: 'view',
    activeViewId: 'view',
    readOnly: false,
    workspaceId: 'workspace',
    rowMap: Object.fromEntries(rows.map(({ id, doc }) => [id, doc])),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );
  const useView = () => {
    const orders = useRowOrdersSelector();
    const { cells } = useFieldCellsByRowsSelector('formula', orders);

    return {
      ids: orders?.map(({ id }) => id),
      sum: calculateFieldValue({
        fieldType: FieldType.Number,
        calculationType: CalculationType.Sum,
        cellValues: cells?.values() ?? [],
      }),
    };
  };

  const opened = renderHook(useView, { wrapper });

  await waitFor(() => expect(opened.result.current).toEqual({ ids: ['row-1', 'row-2'], sum: '20' }));
  opened.unmount();

  act(() => {
    [10, 1, 3].forEach((value, index) => {
      rows[index].row.get(YjsDatabaseKey.cells).get('input').set(YjsDatabaseKey.data, String(value));
    });
    fields
      .get('formula')
      .get(YjsDatabaseKey.type_option)
      .get(String(FieldType.Formula))
      .set('expression', 'prop("input") * 3');
  });
  const reopened = renderHook(useView, { wrapper });

  await waitFor(() => expect(reopened.result.current).toEqual({ ids: ['row-2', 'row-0'], sum: '39' }));
  reopened.unmount();
  databaseDoc.destroy();
  rows.forEach(({ doc }) => doc.destroy());
});
