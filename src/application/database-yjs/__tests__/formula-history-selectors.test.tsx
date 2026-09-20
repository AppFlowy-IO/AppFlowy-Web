import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { CalculationType, FieldType, FilterType, SortCondition } from '@/application/database-yjs/database.type';
import { TextFilterCondition } from '@/application/database-yjs/fields';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { markDatabaseHistoryDocumentImmutable } from '@/application/database-yjs/immutable';
import {
  useCellSelector,
  useFieldCellsByRowsSelector,
  useRowOrdersSelector,
} from '@/application/database-yjs/selector';
import {
  type MentionablePerson,
  type YDatabase,
  type YDatabaseFields,
  type YDatabaseFilter,
  type YDatabaseSort,
  type YDatabaseView,
  type YDatabaseViews,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { useMentionableUsersWithAutoFetch } from '@/components/database/components/cell/person/useMentionableUsers';

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  ...jest.requireActual('@/components/database/components/cell/person/useMentionableUsers'),
  useMentionableUsersWithAutoFetch: jest.fn(),
}));

const currentMembers = [
  { person_id: 'person-z', uid: '42', name: 'Current Alice' },
  { person_id: 'person-a', uid: '43', name: 'Current Zoe' },
] as MentionablePerson[];

function snapshot(expression: string) {
  const root = new Y.Doc() as YDoc;
  const fieldsSource = createFields([
    { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression } },
    { id: 'creator', name: 'Creator', type: FieldType.CreatedBy },
    { id: 'person', name: 'Owner', type: FieldType.Person, typeOption: {
      persons: JSON.stringify([{ id: 'person-z', name: 'Saved Zed' }, { id: 'person-a', name: 'Saved Ada' }]),
    } },
    { id: 'relation', name: 'Related', type: FieldType.Relation, typeOption: { database_id: 'external-database' } },
    { id: 'rollup', name: 'Rollup', type: FieldType.Rollup, typeOption: {
      relation_field_id: 'relation', target_field_id: 'amount', calculation_type: CalculationType.Sum, show_as: 0,
    } },
  ]);
  const fields = fieldsSource.clone() as YDatabaseFields;

  fieldsSource.doc?.destroy();
  const database = new Y.Map() as YDatabase;
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map() as YDatabaseViews;
  const orders = [{ id: 'row-z', height: 44 }, { id: 'row-a', height: 44 }];

  view.set(YjsDatabaseKey.id, 'saved-view');
  view.set(YjsDatabaseKey.row_orders, Y.Array.from(orders));
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  views.set('saved-view', view);
  database.set(YjsDatabaseKey.id, 'saved-database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  root.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const rows: Record<string, YDoc> = {};

  for (const [index, { id }] of orders.entries()) {
    const suffix = index === 0 ? 'z' : 'a';
    const { doc, row } = createRow(id, {
      person: { type: FieldType.Person, data: JSON.stringify([`person-${suffix}`]) },
      relation: { type: FieldType.Relation, data: { yArray: [`external-${suffix}`] } },
      rollup: { type: FieldType.Rollup, data: '' },
    }, { createdBy: index === 0 ? '42' : '43' });

    row.get(YjsDatabaseKey.cells).get('rollup').set(YjsDatabaseKey.data, index === 0 ? 9 : 2);
    rows[id] = doc;
    markDatabaseHistoryDocumentImmutable(doc);
  }

  markDatabaseHistoryDocumentImmutable(root);
  const context: DatabaseContextState = {
    dataSource: { type: 'history', id: 'history-formulas' },
    readOnly: true,
    databaseDoc: root,
    databasePageId: 'saved-view',
    activeViewId: 'saved-view',
    workspaceId: 'workspace',
    rowMap: rows,
    blobPrefetchComplete: true,
    seedsReady: true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );

  return { root, rows, view, orders, wrapper };
}

beforeEach(() => {
  // A disabled fetch still returns the current workspace's warm member cache.
  jest.mocked(useMentionableUsersWithAutoFetch).mockReset().mockReturnValue({
    users: currentMembers, usersByUid: new Map(), loading: false,
  });
});

describe.each([
  {
    source: 'stored rollups and external relation IDs',
    expression: 'format(prop("Rollup")) + "|" + prop("Related").join(",")',
    firstValue: '9|external-z',
    secondValue: '2|external-a',
  },
  {
    source: 'recorded people and saved actor IDs despite a warm current member cache',
    expression: 'prop("Owner").join(",") + "|" + prop("Creator").join(",")',
    firstValue: 'Saved Zed|User 42',
    secondValue: 'Saved Ada|User 43',
  },
])('historical formulas use $source', ({ expression, firstValue, secondValue }) => {
  it.each(['cell', 'footer', 'filter', 'sort'] as const)('evaluates the %s independently of live data', async (consumer) => {
    const f = snapshot(expression);

    if (consumer === 'filter') {
      const filter = new Y.Map() as YDatabaseFilter;

      filter.set(YjsDatabaseKey.id, 'formula-filter');
      filter.set(YjsDatabaseKey.field_id, 'formula');
      filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
      filter.set(YjsDatabaseKey.condition, TextFilterCondition.TextIs);
      filter.set(YjsDatabaseKey.content, firstValue);
      filter.set(YjsDatabaseKey.type, FieldType.Formula);
      f.view.get(YjsDatabaseKey.filters).push([filter]);
    }

    if (consumer === 'sort') {
      const sort = new Y.Map() as YDatabaseSort;

      sort.set(YjsDatabaseKey.id, 'formula-sort');
      sort.set(YjsDatabaseKey.field_id, 'formula');
      sort.set(YjsDatabaseKey.condition, SortCondition.Ascending);
      f.view.get(YjsDatabaseKey.sorts).push([sort]);
    }

    const before = [f.root, ...Object.values(f.rows)].map((doc) => Y.encodeStateAsUpdate(doc));
    // Conditions and footers must work without a mounted formula cell filling caches.
    const consumers = {
      cell: function useCell() { return useCellSelector({ rowId: 'row-z', fieldId: 'formula' })?.data; },
      footer: function useFooter() { return useFieldCellsByRowsSelector('formula', f.orders).cells; },
      filter: function useFilter() { return useRowOrdersSelector()?.map(({ id }) => id); },
      sort: function useSort() { return useRowOrdersSelector()?.map(({ id }) => id); },
    };
    const { result, unmount } = renderHook(consumers[consumer], { wrapper: f.wrapper });
    const expected = consumer === 'cell' ? firstValue : consumer === 'footer'
      ? new Map([['row-z', firstValue], ['row-a', secondValue]])
      : consumer === 'filter' ? ['row-z'] : ['row-a', 'row-z'];

    try {
      await waitFor(() => expect(result.current).toEqual(expected));
      expect(jest.mocked(useMentionableUsersWithAutoFetch).mock.calls.every(([fetch]) => fetch === false)).toBe(true);
      expect([f.root, ...Object.values(f.rows)].map((doc) => Y.encodeStateAsUpdate(doc))).toEqual(before);
    } finally {
      unmount();
      f.root.destroy();
      Object.values(f.rows).forEach((doc) => doc.destroy());
    }
  });
});
