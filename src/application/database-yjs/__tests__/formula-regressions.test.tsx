import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useMemo } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { CalculationType, FieldType, FilterType } from '@/application/database-yjs/database.type';
import { useSwitchPropertyType } from '@/application/database-yjs/dispatch';
import { CheckboxFilterCondition, DateFilterCondition, NumberFilterCondition } from '@/application/database-yjs/fields';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import { parseFormulaTypeOption } from '@/application/database-yjs/fields/formula';
import type { BackgroundRowDocChange } from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import {
  useAdvancedFilterSelector,
  useAdvancedFiltersSelector,
  useCellSelector,
  useFieldCellsByRowsSelector,
  useFormulaColumnEvaluator,
  useFilterSelector,
  useRowOrdersSelector,
} from '@/application/database-yjs/selector';
import * as relationCache from '@/application/database-yjs/relation/cache';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  MentionablePerson,
  YDatabase,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { loadMentionableUsers } from '@/components/database/components/cell/person/useMentionableUsers';
import { FormulaEditorDialog } from '@/components/database/components/property/formula/FormulaEditorDialog';

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => {
  const users: MentionablePerson[] = [];

  return {
    ...jest.requireActual('@/components/database/components/cell/person/useMentionableUsers'),
    loadMentionableUsers: jest.fn(),
    useMentionableUsersWithAutoFetch: () => ({ users }),
  };
});

let fixtureId = 0;

function fixture(expression: string) {
  const suffix = String(++fixtureId);
  const rowId = `formula-row-${suffix}`;
  const relatedRowId = `related-row-${suffix}`;
  const viewId = `formula-view-${suffix}`;
  const relatedViewId = `related-view-${suffix}`;
  const relatedDatabaseId = `related-db-${suffix}`;
  const fields = createFields([
    { id: 'formula', name: 'Formula', type: FieldType.Formula, typeOption: { expression } },
    { id: 'nested', name: 'Nested', type: FieldType.Formula, typeOption: { expression: 'now()' } },
    { id: 'person', name: 'Owner', type: FieldType.Person },
    { id: 'creator', name: 'Creator', type: FieldType.CreatedBy },
    { id: 'edited-time', name: 'Last edited time', type: FieldType.LastEditedTime },
    { id: 'editor', name: 'Last edited by', type: FieldType.LastEditedBy },
    { id: 'price-first', name: 'Price', type: FieldType.Number },
    { id: 'price-second', name: 'Price', type: FieldType.Number },
    { id: 'relation', name: 'Related', type: FieldType.Relation, typeOption: { database_id: relatedDatabaseId } },
    {
      id: 'rollup',
      name: 'Rollup',
      type: FieldType.Rollup,
      typeOption: {
        relation_field_id: 'relation',
        target_field_id: 'amount',
        calculation_type: CalculationType.Sum,
        show_as: 0,
      },
    },
  ]).clone() as YDatabaseFields;
  const databaseDoc = new Y.Doc({ guid: viewId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const view = new Y.Map() as YDatabaseView;
  const views = new Y.Map() as YDatabaseViews;
  const filters = new Y.Array() as YDatabaseFilters;
  const orders = [{ id: rowId, height: 44 }];

  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.row_orders, Y.Array.from(orders));
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, `base-db-${suffix}`);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  fields.forEach((field) => {
    field.set(YjsDatabaseKey.created_at, '1000');
    field.set(YjsDatabaseKey.last_modified, '2000');
  });

  const { doc: rowDoc, row } = createRow(
    rowId,
    {
      relation: { type: FieldType.Relation, data: { yArray: [relatedRowId] } },
      person: { type: FieldType.Person, data: '["person-ada"]' },
      'price-first': { type: FieldType.Number, data: '2' },
      'price-second': { type: FieldType.Number, data: '42' },
    },
    { createdBy: '42' }
  );
  const { doc: relatedRowDoc, row: relatedRow } = createRow(relatedRowId, {
    amount: { type: FieldType.Number, data: '7' },
    title: { type: FieldType.RichText, data: 'Related title' },
  });
  const relatedDoc = new Y.Doc({ guid: relatedViewId }) as YDoc;
  const relatedDatabase = new Y.Map() as YDatabase;
  const relatedFields = createFields([
    { id: 'amount', name: 'Amount', type: FieldType.Number },
    { id: 'title', name: 'Title', type: FieldType.RichText },
  ]).clone() as YDatabaseFields;

  relatedDatabase.set(YjsDatabaseKey.fields, relatedFields);
  relatedDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, relatedDatabase);
  relatedFields.get('title').set(YjsDatabaseKey.is_primary, true);

  const context: DatabaseContextState = {
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    readOnly: false,
    workspaceId: `workspace-${suffix}`,
    rowMap: { [rowId]: rowDoc },
    loadView: jest.fn(async () => relatedDoc),
    createRow: jest.fn(async () => relatedRowDoc),
    getViewIdFromDatabaseId: jest.fn(async () => relatedViewId),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );
  const option = (id: string) =>
    fields
      .get(id)
      .get(YjsDatabaseKey.type_option)
      .get(String(fields.get(id).get(YjsDatabaseKey.type)));

  return {
    context,
    wrapper,
    rowId,
    row,
    rowDoc,
    relatedRow,
    relatedRowDoc,
    relatedDoc,
    fields,
    filters,
    orders,
    option,
  };
}

function dataFilter(condition: number, content = '') {
  const filter = new Y.Map() as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, 'filter');
  filter.set(YjsDatabaseKey.field_id, 'formula');
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, condition);
  filter.set(YjsDatabaseKey.content, content);
  filter.set(YjsDatabaseKey.type, FieldType.Formula);
  return filter;
}

function setAmount(row: YDatabaseRow, amount: string) {
  row.get(YjsDatabaseKey.cells).get('amount').set(YjsDatabaseKey.data, amount);
}

describe('formula conversion resolves external dependencies', () => {
  it('materializes a cold count rollup before the rollup column has mounted', async () => {
    const f = fixture('prop("Rollup") * 10');

    f.option('rollup').set(YjsDatabaseKey.calculation_type, CalculationType.Count);
    f.option('rollup').set(YjsDatabaseKey.target_field_id, '');
    const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });

    await act(async () => {
      await result.current('formula', FieldType.Number);
    });
    expect(f.fields.get('formula').get(YjsDatabaseKey.type)).toBe(FieldType.Number);
    expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe('10');
  });

  it('waits for related row hydration before committing a rollup result', async () => {
    const f = fixture('prop("Rollup") * 10');
    const emptyDoc = new Y.Doc() as YDoc;

    f.context.createRow = jest.fn(async () => emptyDoc);
    const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });
    let pending: Promise<void>;

    act(() => {
      pending = result.current('formula', FieldType.Number);
    });
    await waitFor(() => expect(f.context.createRow).toHaveBeenCalled());
    expect(f.fields.get('formula').get(YjsDatabaseKey.type)).toBe(FieldType.Formula);
    expect(f.row.get(YjsDatabaseKey.cells).has('formula')).toBe(false);
    await act(async () => {
      Y.applyUpdate(emptyDoc, Y.encodeStateAsUpdate(f.relatedRowDoc));
      await pending;
    });
    expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe('70');
  });

  it('awaits uncached relation titles and member names through formula dependencies', async () => {
    const f = fixture('prop("Nested")');

    f.option('nested').set(
      YjsDatabaseKey.expression,
      'prop("Related").join(",") + " / " + prop("Owner").join(",") + " / " + prop("Creator").join(",")'
    );
    let resolveMembers!: (users: MentionablePerson[]) => void;

    jest.mocked(loadMentionableUsers).mockReturnValue(
      new Promise((resolve) => {
        resolveMembers = resolve;
      })
    );
    const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });
    let pending: Promise<void>;

    act(() => {
      pending = result.current('formula', FieldType.RichText);
    });
    await waitFor(() => expect(loadMentionableUsers).toHaveBeenCalledWith(f.context.workspaceId));
    expect(f.fields.get('formula').get(YjsDatabaseKey.type)).toBe(FieldType.Formula);
    await act(async () => {
      resolveMembers([{ uid: '42', person_id: 'person-ada', name: 'Ada' } as MentionablePerson]);
      await pending;
    });
    expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe('Related title / Ada / Ada');
  });

  it('leaves the field and cells unchanged if a required external read fails', async () => {
    const f = fixture('prop("Rollup")');

    f.context.createRow = jest.fn().mockRejectedValue(new Error('unavailable'));
    const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });

    await act(async () => {
      await expect(result.current('formula', FieldType.Number)).rejects.toThrow('unavailable');
    });
    expect(f.fields.get('formula').get(YjsDatabaseKey.type)).toBe(FieldType.Formula);
    expect(f.row.get(YjsDatabaseKey.cells).has('formula')).toBe(false);
  });
});

describe('formula rollups with hidden source columns', () => {
  it.each(['before mount', 'after mount'])(
    'observes detached footer rows loaded %s and releases them',
    async (timing) => {
      const f = fixture('prop("Rollup")');
      const relatedRoot = f.relatedRowDoc.getMap(YjsEditorKey.data_section);
      const observe = jest.spyOn(relatedRoot, 'observeDeep');
      const unobserve = jest.spyOn(relatedRoot, 'unobserveDeep');
      const listeners = new Set<(change: BackgroundRowDocChange) => void>();
      let cached: Record<string, YDoc> = timing === 'before mount' ? { [f.rowId]: f.rowDoc } : {};
      const source = {
        rows: {},
        rowIds: [f.rowId],
        getCachedRowDocs: () => cached,
        subscribeToCachedRowDocChanges: (notify: (change: BackgroundRowDocChange) => void) => {
          listeners.add(notify);
          return () => {
            listeners.delete(notify);
          };
        },
      };

      f.context.rowMap = {};
      const { result, unmount } = renderHook(
        () => {
          const evaluate = useFormulaColumnEvaluator('formula', source);

          // Like the timeline projection, recompute when its evaluator changes.
          return useMemo(() => (cached[f.rowId] ? evaluate?.(f.rowId, f.row) : undefined), [evaluate]);
        },
        { wrapper: f.wrapper }
      );

      if (timing === 'after mount') {
        act(() => {
          cached = { [f.rowId]: f.rowDoc };
          listeners.forEach((notify) => notify({ added: cached, removed: {} }));
        });
      }

      await waitFor(() => expect(result.current).toBe(7));
      act(() => setAmount(f.relatedRow, '9'));
      await waitFor(() => expect(result.current).toBe(9));
      act(() => {
        cached = {};
        listeners.forEach((notify) => notify({ added: {}, removed: { [f.rowId]: f.rowDoc } }));
      });
      await waitFor(() => expect(result.current).toBeUndefined());
      expect(observe).toHaveBeenCalled();
      observe.mock.calls.forEach(([listener]) => expect(unobserve).toHaveBeenCalledWith(listener));
      unmount();
      expect(listeners.size).toBe(0);
      observe.mockRestore();
      unobserve.mockRestore();
    }
  );

  it('keeps a resolved rollup through unrelated edits but follows relation membership changes', async () => {
    jest.useFakeTimers();
    const f = fixture('prop("Rollup") * 10');
    const { result, unmount } = renderHook(() => useCellSelector({ rowId: f.rowId, fieldId: 'formula' }), {
      wrapper: f.wrapper,
    });

    try {
      await waitFor(() => expect(result.current?.data).toBe('70'));
      const loadRow = jest.mocked(f.context.createRow!);

      loadRow.mockClear();
      act(() => {
        f.row.get(YjsDatabaseKey.cells).get('price-first').set(YjsDatabaseKey.data, '3');
        f.row.set(YjsDatabaseKey.last_modified, '3000');
      });
      expect(result.current?.data).toBe('70');
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      expect(loadRow).not.toHaveBeenCalled();
      const relationCell = f.row.get(YjsDatabaseKey.cells).get('relation');

      act(() => {
        relationCell.set(YjsDatabaseKey.data, new Y.Array());
      });
      await waitFor(() => expect(result.current?.data).toBe('0'));
      act(() => {
        relationCell.set(YjsDatabaseKey.data, Y.Array.from([f.relatedRow.get(YjsDatabaseKey.id)]));
      });
      await waitFor(() => expect(result.current?.data).toBe('70'));
      act(() => setAmount(f.relatedRow, '9'));
      await waitFor(() => expect(result.current?.data).toBe('90'));
    } finally {
      unmount();
      jest.useRealTimers();
    }
  });

  it('updates the formula when a related amount or rollup configuration changes', async () => {
    const f = fixture('prop("Rollup") * 10');
    const root = f.relatedRowDoc.getMap(YjsEditorKey.data_section);
    const subscribe = jest.spyOn(root, 'observeDeep');
    const unsubscribe = jest.spyOn(root, 'unobserveDeep');
    const { result, unmount } = renderHook(() => useCellSelector({ rowId: f.rowId, fieldId: 'formula' }), {
      wrapper: f.wrapper,
    });

    await waitFor(() => expect(result.current?.data).toBe('70'));
    act(() => setAmount(f.relatedRow, '9'));
    await waitFor(() => expect(result.current?.data).toBe('90'));
    act(() => {
      f.option('rollup').set(YjsDatabaseKey.calculation_type, CalculationType.Count);
    });
    await waitFor(() => expect(result.current?.data).toBe('10'));
    unmount();
    expect(subscribe).toHaveBeenCalled();
    subscribe.mock.calls.forEach(([listener]) => expect(unsubscribe).toHaveBeenCalledWith(listener));
  });

  it('updates a formula filter without mounting either formula or rollup cells', async () => {
    const f = fixture('prop("Rollup")');
    const subscribe = jest.spyOn(f.relatedRowDoc.getMap(YjsEditorKey.data_section), 'observeDeep');

    f.filters.push([dataFilter(NumberFilterCondition.GreaterThan, '8')]);
    const { result } = renderHook(useRowOrdersSelector, { wrapper: f.wrapper });

    await waitFor(() => expect(result.current).toEqual([]));
    // Wait for discovery to finish before changing a source document.
    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    act(() => setAmount(f.relatedRow, '9'));
    await waitFor(() => expect(result.current?.map((row) => row.id)).toEqual([f.rowId]));
  });

  it('updates a footer without mounting formula or rollup cells', async () => {
    const f = fixture('prop("Rollup")');
    const { result } = renderHook(() => useFieldCellsByRowsSelector('formula', f.orders), { wrapper: f.wrapper });

    await waitFor(() => expect(result.current.cells?.get(f.rowId)).toBe(7));
    act(() => setAmount(f.relatedRow, '9'));
    await waitFor(() => expect(result.current.cells?.get(f.rowId)).toBe(9));
    act(() => {
      f.option('rollup').set(YjsDatabaseKey.calculation_type, CalculationType.Count);
    });
    await waitFor(() => expect(result.current.cells?.get(f.rowId)).toBe(1));
  });

  it('settles footer rollups when the view republishes the same row membership', async () => {
    jest.useFakeTimers();
    const f = fixture('prop("Rollup")');
    const { result, unmount } = renderHook(
      () => {
        const rows = useRowOrdersSelector();

        return useFieldCellsByRowsSelector('formula', rows);
      },
      { wrapper: f.wrapper }
    );

    try {
      await waitFor(() => expect(result.current.cells?.get(f.rowId)).toBe(7));
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      const loadRow = jest.mocked(f.context.createRow!);

      loadRow.mockClear();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(result.current.cells?.get(f.rowId)).toBe(7);
      expect(loadRow).not.toHaveBeenCalled();
    } finally {
      unmount();
      jest.useRealTimers();
    }
  });
});

describe('formula relation title retention', () => {
  it('loads titles with linear cache checks and refreshes only the title that changed', async () => {
    const f = fixture('prop("Related").filter(current != "").length()');
    const ids = Array.from({ length: 100 }, (_, index) => `scoped-title-${f.rowId}-${index}`);
    const unusedId = `unused-title-${f.rowId}`;
    const relatedRows = new Map(
      [...ids, unusedId].map((id) => [
        getRowKey(f.relatedDoc.guid, id),
        createRow(id, { title: { type: FieldType.RichText, data: 'Title' } }),
      ])
    );

    f.context.createRow = jest.fn(async (key: string) => relatedRows.get(key)!.doc);
    f.row.get(YjsDatabaseKey.cells).get('relation').set(YjsDatabaseKey.data, Y.Array.from(ids));
    const ensure = jest.spyOn(relationCache, 'ensureRelationGroupLabel');
    const { result, unmount } = renderHook(() => useCellSelector({ rowId: f.rowId, fieldId: 'formula' }), {
      wrapper: f.wrapper,
    });

    try {
      await waitFor(() => expect(result.current?.data).toBe('100'));
      expect(ensure.mock.calls.length).toBeLessThanOrEqual(ids.length * 4);
      ensure.mockClear();
      act(() => {
        f.row.get(YjsDatabaseKey.cells).get('price-first').set(YjsDatabaseKey.data, '3');
      });
      expect(ensure).not.toHaveBeenCalled();
      const unusedKey = { relationField: f.fields.get('relation'), relatedRowId: unusedId };

      relationCache.ensureRelationGroupLabel({ ...unusedKey, ...f.context });
      await waitFor(() => expect(relationCache.readRelationGroupLabel(unusedKey)).toBe('Title'));
      expect(ensure).toHaveBeenCalledTimes(1);
      ensure.mockClear();
      const edited = relatedRows.get(getRowKey(f.relatedDoc.guid, ids[0]))!.row;

      act(() => {
        edited.get(YjsDatabaseKey.cells).get('title').set(YjsDatabaseKey.data, '');
      });
      await waitFor(() => expect(result.current?.data).toBe('99'));
      expect(ensure).toHaveBeenCalled();
      expect(ensure.mock.calls.every(([key]) => key.relatedRowId === ids[0])).toBe(true);
      unmount();
      ensure.mockClear();
      act(() => {
        edited.get(YjsDatabaseKey.cells).get('title').set(YjsDatabaseKey.data, 'Restored');
      });
      expect(ensure).not.toHaveBeenCalled();
    } finally {
      unmount();
      ensure.mockRestore();
    }
  });

  it.each(['filter', 'footer', 'detached footer'])(
    'settles all 501 titles for a %s and releases them when unmounted',
    async (consumer) => {
      const f = fixture('prop("Related").filter(current != "").length()');
      const ids = Array.from({ length: 501 }, (_, index) => `title-${f.rowId}-${index}`);
      const keys = ids.map((relatedRowId) => ({ relationField: f.fields.get('relation'), relatedRowId }));
      const relatedRows = new Map(
        ids.map((id) => [
          getRowKey(f.relatedDoc.guid, id),
          createRow(id, { title: { type: FieldType.RichText, data: 'Related title' } }).doc,
        ])
      );

      f.context.createRow = jest.fn(async (rowKey: string) => relatedRows.get(rowKey)!);
      f.row.get(YjsDatabaseKey.cells).get('relation').set(YjsDatabaseKey.data, Y.Array.from(ids));
      let readValue: () => number | string | undefined;
      let unmount: () => void;

      if (consumer === 'filter') {
        f.filters.push([dataFilter(NumberFilterCondition.GreaterThan, '500')]);
        const rendered = renderHook(useRowOrdersSelector, { wrapper: f.wrapper });

        readValue = () => rendered.result.current?.length;
        unmount = rendered.unmount;
      } else if (consumer === 'footer') {
        const rendered = renderHook(() => useFieldCellsByRowsSelector('formula', f.orders), { wrapper: f.wrapper });

        readValue = () => rendered.result.current.cells?.get(f.rowId) as number | undefined;
        unmount = rendered.unmount;
      } else {
        // Timeline footers can evaluate rows absent from the mounted row map.
        f.context.rowMap = {};
        const source = { rows: {}, getCachedRowDocs: () => ({ [f.rowId]: f.rowDoc }) };
        const rendered = renderHook(() => useFormulaColumnEvaluator('formula', source), { wrapper: f.wrapper });

        readValue = () => rendered.result.current?.(f.rowId, f.row);
        unmount = rendered.unmount;
      }

      await waitFor(() => {
        expect(readValue()).toBe(consumer === 'filter' ? 1 : 501);
        expect(keys.every((key) => relationCache.readRelationGroupLabel(key) === 'Related title')).toBe(true);
      });

      // A later pass must see the complete set without starting another cache-eviction cycle.
      const loads = jest.mocked(f.context.createRow!).mock.calls.length;

      expect(readValue()).toBe(consumer === 'filter' ? 1 : 501);
      expect(keys.every((key) => relationCache.readRelationGroupLabel(key) === 'Related title')).toBe(true);
      expect(f.context.createRow).toHaveBeenCalledTimes(loads);
      unmount();
      expect(keys.filter((key) => relationCache.readRelationGroupLabel(key) !== '')).toHaveLength(500);
    }
  );
});

describe('formula footer row metadata', () => {
  it.each([
    ['timestamp(prop("Last edited time"))', YjsDatabaseKey.last_modified, 2000],
    ['prop("Last edited by").join(",")', YjsDatabaseKey.last_edited_by, 'User 2'],
  ] as const)('refreshes %s without a cell edit', (expression, key, expected) => {
    const f = fixture(expression);

    f.row.set(key, '1');
    const cellsBefore = f.row.get(YjsDatabaseKey.cells).toJSON();
    const { result } = renderHook(() => useFieldCellsByRowsSelector('formula', f.orders), { wrapper: f.wrapper });

    expect(result.current.cells?.get(f.rowId)).not.toBe(expected);
    act(() => {
      f.row.set(key, '2');
    });
    expect(result.current.cells?.get(f.rowId)).toBe(expected);
    expect(f.row.get(YjsDatabaseKey.cells).toJSON()).toEqual(cellsBefore);
  });
});

describe('formula property insertions', () => {
  it.each(['catalogue', 'autocomplete', 'example'])(
    'preserves the second Price through %s insertion and save',
    (source) => {
      const f = fixture('');

      render(<FormulaEditorDialog fieldId={'formula'} rowId={f.rowId} open onOpenChange={jest.fn()} />, {
        wrapper: f.wrapper,
      });
      const secondPrice = screen.getByTestId('formula-catalogue-property-price-second');

      if (source === 'catalogue') {
        fireEvent.click(secondPrice);
      } else if (source === 'autocomplete') {
        fireEvent.change(screen.getByTestId('formula-editor-input'), { target: { value: 'Price', selectionStart: 5 } });
        fireEvent.click(screen.getAllByTestId('formula-suggestion-Price')[1]);
      } else {
        fireEvent.mouseEnter(secondPrice);
        fireEvent.click(within(screen.getByTestId('formula-docs')).getAllByRole('button')[0]);
      }

      expect(screen.getByTestId('formula-preview-value').textContent).toBe('42');
      fireEvent.click(screen.getByTestId('formula-editor-done'));
      expect(parseFormulaTypeOption(f.fields.get('formula')).formula).toBe('prop("price-second")');
    }
  );
});

describe('date formula filter selectors', () => {
  it.each([
    [DateFilterCondition.DateStartsOn, { timestamp: 1700000000 }],
    [DateFilterCondition.DateStartsBetween, { start: 1700000000, end: 1700086400 }],
  ])('preserves saved date selections for condition %s', (condition, selection) => {
    const f = fixture('today()');
    const filter = dataFilter(condition as number, JSON.stringify(selection));

    f.filters.push([filter]);
    const simple = renderHook(() => useFilterSelector('filter'), { wrapper: f.wrapper });

    expect(simple.result.current).toMatchObject(selection);
    simple.unmount();
    const root = new Y.Map() as YDatabaseFilter;

    root.set(YjsDatabaseKey.id, 'root');
    root.set(YjsDatabaseKey.filter_type, FilterType.And);
    root.set(YjsDatabaseKey.children, Y.Array.from([filter.clone()]));
    f.filters.delete(0, 1);
    f.filters.push([root]);
    const advanced = renderHook(
      () => ({ one: useAdvancedFilterSelector('filter'), all: useAdvancedFiltersSelector() }),
      { wrapper: f.wrapper }
    );

    expect(advanced.result.current.one).toMatchObject(selection);
    expect(advanced.result.current.all[0]).toMatchObject(selection);
  });
});

describe('time-dependent formulas', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('refreshes indirect now() cells and footers and releases the shared timer', () => {
    jest.setSystemTime(new Date('2026-01-02T10:00:00'));
    const f = fixture('timestamp(prop("Nested"))');
    const timerCount = jest.getTimerCount();
    const { result, unmount } = renderHook(
      () => ({
        cell: useCellSelector({ rowId: f.rowId, fieldId: 'formula' }),
        footer: useFieldCellsByRowsSelector('formula', f.orders),
      }),
      { wrapper: f.wrapper }
    );
    const before = Date.now();

    expect(result.current.cell?.data).toBe(String(before));
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.cell?.data).toBe(String(before + 1000));
    expect(result.current.footer.cells?.get(f.rowId)).toBe(before + 1000);
    unmount();
    expect(jest.getTimerCount()).toBe(timerCount);
  });

  it('refreshes today() and formula filters across local midnight', () => {
    jest.setSystemTime(new Date('2026-01-02T23:59:59'));
    const f = fixture(`timestamp(prop("Nested")) > ${new Date('2026-01-02T00:00:00').valueOf()}`);

    f.option('nested').set(YjsDatabaseKey.expression, 'today()');
    f.filters.push([dataFilter(CheckboxFilterCondition.IsChecked)]);
    const { result, unmount } = renderHook(useRowOrdersSelector, { wrapper: f.wrapper });

    expect(result.current).toEqual([]);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current?.map((row) => row.id)).toEqual([f.rowId]);
    unmount();
  });
});
