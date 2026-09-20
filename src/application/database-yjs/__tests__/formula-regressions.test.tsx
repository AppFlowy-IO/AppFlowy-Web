import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import * as Y from 'yjs';

import { calculateFieldValue } from '@/application/database-yjs/calculation';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import {
  CalculationType,
  FieldType,
  FilterType,
  RollupDisplayMode,
  SortCondition,
} from '@/application/database-yjs/database.type';
import { useSwitchPropertyType } from '@/application/database-yjs/dispatch';
import {
  CheckboxFilterCondition,
  DateFilterCondition,
  NumberFilterCondition,
  TextFilterCondition,
} from '@/application/database-yjs/fields';
import { parseFormulaTypeOption } from '@/application/database-yjs/fields/formula';
import { createFields, createRow } from '@/application/database-yjs/fields/formula/__tests__/fixture';
import * as formulaMaterialization from '@/application/database-yjs/formula/materialize';
import type { BackgroundRowDocChange } from '@/application/database-yjs/hooks/useBackgroundRowDocLoader';
import * as relationCache from '@/application/database-yjs/relation/cache';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  useAdvancedFilterSelector,
  useAdvancedFiltersSelector,
  useCellSelector,
  useFieldCellsByRowsSelector,
  useFormulaColumnEvaluator,
  useFilterSelector,
  useRowOrdersSelector,
} from '@/application/database-yjs/selector';
import {
  DateFormat,
  MentionablePerson,
  TimeFormat,
  User,
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
import { MetadataKey } from '@/application/user-metadata';
import {
  loadMentionableUsers,
  useMentionableUsersWithAutoFetch,
} from '@/components/database/components/cell/person/useMentionableUsers';
import { FormulaEditorDialog } from '@/components/database/components/property/formula/FormulaEditorDialog';
import { AFConfigContext } from '@/components/main/app.hooks';

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => {
  const users: MentionablePerson[] = [];

  return {
    ...jest.requireActual('@/components/database/components/cell/person/useMentionableUsers'),
    loadMentionableUsers: jest.fn(),
    useMentionableUsersWithAutoFetch: jest.fn(() => ({ users })),
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
  const relatedOrders = Y.Array.from([{ id: relatedRowId, height: 44, is_deleted: false }]);
  const relatedView = new Y.Map() as YDatabaseView;
  const relatedViews = new Y.Map() as YDatabaseViews;

  relatedView.set(YjsDatabaseKey.is_inline, true);
  relatedView.set(YjsDatabaseKey.row_orders, relatedOrders);
  relatedViews.set(relatedViewId, relatedView);
  relatedDatabase.set(YjsDatabaseKey.views, relatedViews);

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
    relatedRowId,
    relatedOrders,
    relatedRowDoc,
    relatedDoc,
    fields,
    filters,
    view,
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

function setRelatedMembership(f: ReturnType<typeof fixture>, ids: string[], deleted = false) {
  f.relatedDoc.transact(() => {
    f.relatedOrders.delete(0, f.relatedOrders.length);
    f.relatedOrders.push(ids.map((id) => ({ id, height: 44, is_deleted: deleted })));
  });
}

describe('formula conversion preserves viewer date formats', () => {
  it.each([
    {
      expression: 'parseDate("2024-03-10T09:30:00")',
      expected: '2024-03-10 09:30',
      loadRow: false,
    },
    {
      expression:
        '[dateRange(parseDate("2024-03-10T09:30:00"), parseDate("2024-03-11T17:45:00")), parseDate("2024-03-12")]',
      expected: '2024-03-10 09:30 → 2024-03-11 17:45, 2024-03-12',
      loadRow: true,
    },
  ])('keeps displayed date text when converting $expression', async ({ expression, expected, loadRow }) => {
    const f = fixture(expression);

    if (loadRow) {
      f.context.rowMap = {};
      f.context.ensureRow = jest.fn(async () => f.rowDoc);
    }

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AFConfigContext.Provider
        value={{
          isAuthenticated: true,
          currentUser: {
            metadata: {
              [MetadataKey.DateFormat]: DateFormat.ISO,
              [MetadataKey.TimeFormat]: TimeFormat.TwentyFourHour,
            },
          } as User,
          updateCurrentUser: async () => undefined,
          openLoginModal: () => undefined,
        }}
      >
        <f.wrapper>{children}</f.wrapper>
      </AFConfigContext.Provider>
    );
    const { result } = renderHook(useSwitchPropertyType, { wrapper });

    await act(async () => {
      await result.current('formula', FieldType.RichText);
    });
    expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe(expected);
    if (loadRow) expect(f.context.ensureRow).toHaveBeenCalledWith(f.rowId);
  });

  it('uses the display defaults when no viewer is available', async () => {
    const f = fixture('parseDate("2024-03-10T09:30:00")');
    const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });

    await act(async () => {
      await result.current('formula', FieldType.RichText);
    });
    expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe('03/10/2024 9:30 AM');
  });
});

describe('formula conversion resolves external dependencies', () => {
  it('does not let an older pending Number conversion overwrite a newer Text conversion', async () => {
    const f = fixture('prop("Rollup")');
    let releaseFirst!: (doc: YDoc) => void;

    f.context.createRow = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<YDoc>((resolve) => {
            releaseFirst = resolve;
          })
      )
      .mockResolvedValue(f.relatedRowDoc);
    const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });
    const first = result.current('formula', FieldType.Number).catch((error: unknown) => error);

    await waitFor(() => expect(f.context.createRow).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current('formula', FieldType.RichText);
    });
    expect(f.fields.get('formula').get(YjsDatabaseKey.type)).toBe(FieldType.RichText);
    const committed = f.row.toJSON();

    await act(async () => {
      releaseFirst(f.relatedRowDoc);
      expect(await first).toEqual(expect.objectContaining({ message: expect.stringContaining('superseded') }));
    });
    expect(f.fields.get('formula').get(YjsDatabaseKey.type)).toBe(FieldType.RichText);
    expect(f.row.toJSON()).toEqual(committed);
    expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe('7');
  });

  it.each(['deleted', 'changed type'] as const)(
    'abandons conversion and releases observers when the field is %s while external data loads',
    async (change) => {
      const f = fixture('prop("Rollup")');
      let release!: (doc: YDoc) => void;

      f.context.createRow = jest.fn(
        () =>
          new Promise<YDoc>((resolve) => {
            release = resolve;
          })
      );
      const observed = [f.fields, f.row];
      const observers = observed.map((value) => ({
        subscribe: jest.spyOn(value, 'observeDeep'),
        unsubscribe: jest.spyOn(value, 'unobserveDeep'),
      }));
      const documentObservers = [f.relatedDoc, f.relatedRowDoc].map((doc) => ({
        subscribe: jest.spyOn(doc, 'on'),
        unsubscribe: jest.spyOn(doc, 'off'),
      }));
      const { result, unmount } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });
      const pending = result.current('formula', FieldType.Number).catch((error: unknown) => error);

      await waitFor(() => expect(f.context.createRow).toHaveBeenCalled());
      act(() => {
        if (change === 'deleted') f.fields.delete('formula');
        else f.fields.get('formula').set(YjsDatabaseKey.type, FieldType.Checkbox);
      });
      const schemaAfterChange = f.fields.toJSON();
      const rowAfterChange = f.row.toJSON();

      await act(async () => {
        release(f.relatedRowDoc);
        expect(await pending).toEqual(
          expect.objectContaining({ message: expect.stringContaining('Field type changed') })
        );
      });
      expect(f.fields.toJSON()).toEqual(schemaAfterChange);
      expect(f.row.toJSON()).toEqual(rowAfterChange);
      expect(f.row.get(YjsDatabaseKey.cells).has('formula')).toBe(false);
      unmount();
      observers.forEach(({ subscribe, unsubscribe }) => {
        expect(subscribe).toHaveBeenCalled();
        subscribe.mock.calls.forEach(([listener]) => expect(unsubscribe).toHaveBeenCalledWith(listener));
      });
      documentObservers.forEach(({ subscribe, unsubscribe }) => {
        const updates = subscribe.mock.calls.filter(([event]) => event === 'update');

        expect(updates).not.toHaveLength(0);
        updates.forEach(([event, listener]) => expect(unsubscribe).toHaveBeenCalledWith(event, listener));
      });
    }
  );

  it.each([FieldType.SingleSelect, FieldType.MultiSelect])(
    'keeps existing options and deduplicates formula values across loaded and unloaded rows for type %s',
    async (targetType) => {
      const f = fixture('if(prop("Price") > 0, "Existing, New, New", "")');
      const hiddenId = `${f.rowId}-hidden`;
      const blankId = `${f.rowId}-blank`;
      const hidden = createRow(hiddenId, { 'price-first': { type: FieldType.Number, data: '3' } });
      const blank = createRow(blankId, { 'price-first': { type: FieldType.Number, data: '0' } });
      const typeOption = new Y.Map();
      const existing = { id: 'existing-option', name: 'Existing', color: 'Purple' };
      const unused = { id: 'unused-option', name: 'Unused', color: 'Blue' };

      typeOption.set(YjsDatabaseKey.content, JSON.stringify({ disable_color: true, options: [existing, unused] }));
      f.fields.get('formula').get(YjsDatabaseKey.type_option).set(String(targetType), typeOption);
      f.view.get(YjsDatabaseKey.row_orders).push([
        { id: hiddenId, height: 44 },
        { id: blankId, height: 44 },
      ]);
      f.context.ensureRow = jest.fn(async (id) => (id === hiddenId ? hidden.doc : blank.doc));
      const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });

      await act(async () => {
        await result.current('formula', targetType);
      });
      expect(f.context.ensureRow).toHaveBeenCalledWith(hiddenId);
      expect(f.context.ensureRow).toHaveBeenCalledWith(blankId);
      const options = JSON.parse(f.option('formula').get(YjsDatabaseKey.content));

      expect(options.disable_color).toBe(true);
      expect(options.options).toHaveLength(3);
      expect(options.options).toEqual([existing, unused, expect.objectContaining({ name: 'New' })]);
      for (const row of [f.row, hidden.row]) {
        expect(row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe('Existing, New, New');
      }

      expect(blank.row.get(YjsDatabaseKey.cells).has('formula')).toBe(false);
    }
  );

  it('releases related document observers, including reads that finish after disposal', async () => {
    const loadedDoc = new Y.Doc() as YDoc;
    const pendingDoc = new Y.Doc() as YDoc;
    let finishLoading!: (doc: YDoc) => void;
    const pending = new Promise<YDoc>((resolve) => {
      finishLoading = resolve;
    });
    const changed = jest.fn();
    const observed = formulaMaterialization.observeFormulaRelatedDocuments(
      { createRow: async (key) => (key === 'loaded' ? loadedDoc : pending) },
      changed
    );

    await observed.loaders.createRow!('loaded');
    const read = observed.loaders.createRow!('pending');

    observed.dispose();
    finishLoading(pendingDoc);
    await read;
    loadedDoc.getMap('data').set('title', 'changed');
    pendingDoc.getMap('data').set('title', 'changed');
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['rollup row', 'relation schema'] as const)(
    'retries when an already resolved %s changes while another row is loading',
    async (dependency) => {
      const f = fixture(dependency === 'rollup row' ? 'prop("Rollup")' : 'prop("Related").join(",")');
      const secondRowId = `${f.rowId}-second`;
      const secondRowDoc = new Y.Doc() as YDoc;

      Y.applyUpdate(secondRowDoc, Y.encodeStateAsUpdate(f.rowDoc));
      f.context.rowMap = { ...f.context.rowMap, [secondRowId]: secondRowDoc };
      let releaseSecondRow!: () => void;
      const secondRowReady = new Promise<void>((resolve) => {
        releaseSecondRow = resolve;
      });
      let reads = 0;

      f.context.createRow = jest.fn(async () => {
        if (++reads === 2) await secondRowReady;
        return f.relatedRowDoc;
      });
      let firstRowResolved!: () => void;
      const firstRowReady = new Promise<void>((resolve) => {
        firstRowResolved = resolve;
      });
      const resolveContext = formulaMaterialization.resolveFormulaRowContext;
      const resolver = jest
        .spyOn(formulaMaterialization, 'resolveFormulaRowContext')
        .mockImplementation(async (args) => {
          const context = await resolveContext(args);

          if (args.rowId === f.rowId) firstRowResolved();
          return context;
        });
      const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });

      try {
        await act(async () => {
          const pending = result.current('formula', FieldType.RichText);

          await firstRowReady;
          if (dependency === 'rollup row') {
            setAmount(f.relatedRow, '9');
          } else {
            const relatedDatabase = f.relatedDoc
              .getMap(YjsEditorKey.data_section)
              .get(YjsEditorKey.database) as YDatabase;
            const relatedFields = relatedDatabase.get(YjsDatabaseKey.fields);

            f.relatedDoc.transact(() => {
              relatedFields.get('title').set(YjsDatabaseKey.is_primary, false);
              relatedFields.get('amount').set(YjsDatabaseKey.is_primary, true);
            });
          }

          releaseSecondRow();
          await pending;
        });
        expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe(
          dependency === 'rollup row' ? '9' : '7'
        );
      } finally {
        releaseSecondRow();
        resolver.mockRestore();
      }
    }
  );

  it.each([FieldType.Person, FieldType.CreatedBy, FieldType.LastEditedBy])(
    'loads and materializes member names reached only through rollup target %s',
    async (targetType) => {
      for (const showAs of [RollupDisplayMode.OriginalList, RollupDisplayMode.UniqueList]) {
        const f = fixture('prop("Rollup").join(", ")');
        const relatedDatabase = f.relatedDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

        relatedDatabase.get(YjsDatabaseKey.fields).get('amount').set(YjsDatabaseKey.type, targetType);
        const cell = f.relatedRow.get(YjsDatabaseKey.cells).get('amount');

        cell.set(YjsDatabaseKey.field_type, targetType);
        cell.set(YjsDatabaseKey.data, '["person-ada"]');
        f.relatedRow.set(YjsDatabaseKey.created_by, '9007199254740993');
        f.relatedRow.set(YjsDatabaseKey.last_edited_by, '9007199254740993');
        f.option('rollup').set(YjsDatabaseKey.show_as, showAs);
        jest
          .mocked(loadMentionableUsers)
          .mockResolvedValue([{ uid: '9007199254740993', person_id: 'person-ada', name: 'Ada' } as MentionablePerson]);
        const { result, unmount } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });

        await act(async () => {
          await result.current('formula', FieldType.RichText);
        });
        expect(loadMentionableUsers).toHaveBeenCalledWith(f.context.workspaceId);
        expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe('Ada');
        unmount();
      }
    }
  );

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

describe('formula member-name updates', () => {
  const RosterContext = createContext<MentionablePerson[]>([]);
  const sources = [
    { type: FieldType.Person, name: 'Owner' },
    { type: FieldType.CreatedBy, name: 'Creator' },
    { type: FieldType.LastEditedBy, name: 'Last edited by' },
  ].flatMap((source) => [
    { ...source, display: undefined },
    { ...source, name: 'Rollup', display: RollupDisplayMode.OriginalList },
    { ...source, name: 'Rollup', display: RollupDisplayMode.UniqueList },
  ]);
  const cases = sources.flatMap((source) =>
    (['cell', 'filter', 'sort', 'footer'] as const).map((consumer) => ({ ...source, consumer }))
  );

  it.each(cases)(
    'updates $consumer when member names change for field $type, rollup display $display',
    async ({ type, name, display, consumer }) => {
      const expression = `prop("${name}").join(",")`;
      const f = fixture(consumer === 'footer' ? `${expression}.length()` : expression);
      let roster = [
        { uid: '42', person_id: 'person-ada', name: 'Ada' } as MentionablePerson,
        { uid: '43', person_id: 'person-eve', name: 'Eve' } as MentionablePerson,
      ];
      const rosterHook = jest.mocked(useMentionableUsersWithAutoFetch);

      rosterHook.mockClear();
      rosterHook.mockImplementation(() => {
        const users = useContext(RosterContext);

        return { users, usersByUid: new Map(), loading: false };
      });
      const setPerson = (row: YDatabaseRow, personId: string, uid: string) => {
        row.set(YjsDatabaseKey.created_by, uid);
        row.set(YjsDatabaseKey.last_edited_by, uid);
        const cell = row.get(YjsDatabaseKey.cells).get(display === undefined ? 'person' : 'amount');

        cell.set(YjsDatabaseKey.field_type, type);
        cell.set(YjsDatabaseKey.data, JSON.stringify([personId]));
      };

      if (display !== undefined) {
        const relatedDatabase = f.relatedDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

        relatedDatabase.get(YjsDatabaseKey.fields).get('amount').set(YjsDatabaseKey.type, type);
        f.option('rollup').set(YjsDatabaseKey.show_as, display);
      }

      setPerson(display === undefined ? f.row : f.relatedRow, 'person-ada', '42');
      const secondId = `${f.rowId}-second`;

      if (consumer === 'sort') {
        const secondRelatedId = `${f.relatedRowId}-second`;
        const secondSource = createRow(
          secondId,
          {
            person: { type: FieldType.Person, data: '["person-eve"]' },
            relation: { type: FieldType.Relation, data: { yArray: [secondRelatedId] } },
          },
          { createdBy: '43', lastEditedBy: '43' }
        );
        const secondRelated = createRow(
          secondRelatedId,
          {
            amount: { type, data: '["person-eve"]' },
          },
          { createdBy: '43', lastEditedBy: '43' }
        );

        f.context.rowMap = { ...f.context.rowMap, [secondId]: secondSource.doc };
        f.context.createRow = jest.fn(async (key) =>
          key === getRowKey(f.relatedDoc.guid, secondRelatedId) ? secondRelated.doc : f.relatedRowDoc
        );
        f.relatedOrders.push([{ id: secondRelatedId, height: 44, is_deleted: false }]);
        f.view.get(YjsDatabaseKey.row_orders).push([{ id: secondId, height: 44 }]);
        const sort = new Y.Map();

        sort.set(YjsDatabaseKey.id, 'formula-sort');
        sort.set(YjsDatabaseKey.field_id, 'formula');
        sort.set(YjsDatabaseKey.condition, SortCondition.Ascending);
        f.view.get(YjsDatabaseKey.sorts).push([sort]);
      }

      if (consumer === 'filter') f.filters.push([dataFilter(TextFilterCondition.TextIs, 'Grace')]);
      const wrapper = ({ children }: { children: ReactNode }) => (
        <RosterContext.Provider value={roster}>
          <f.wrapper>{children}</f.wrapper>
        </RosterContext.Provider>
      );
      // Mount only the consumer under test: a visible formula cell must not
      // accidentally provide the refresh that hidden-column conditions need.
      const consumers = {
        cell: function useCell() {
          return useCellSelector({ rowId: f.rowId, fieldId: 'formula' })?.data;
        },
        footer: function useFooter() {
          return useFieldCellsByRowsSelector('formula', f.orders).cells?.get(f.rowId);
        },
        filter: function useFilter() {
          return useRowOrdersSelector()?.map(({ id }) => id);
        },
        sort: function useSort() {
          return useRowOrdersSelector()?.map(({ id }) => id);
        },
      };
      const { result, rerender, unmount } = renderHook(consumers[consumer], { wrapper });

      try {
        const before =
          consumer === 'cell' ? 'Ada' : consumer === 'footer' ? 3 : consumer === 'sort' ? [f.rowId, secondId] : [];
        const after =
          consumer === 'cell'
            ? 'Grace'
            : consumer === 'footer'
            ? 5
            : consumer === 'sort'
            ? [secondId, f.rowId]
            : [f.rowId];

        await waitFor(() => expect(result.current).toEqual(before));
        expect(rosterHook).toHaveBeenCalledWith(true);
        const sourceSnapshot = f.row.toJSON();
        const relatedSnapshot = f.relatedRow.toJSON();

        roster = [{ ...roster[0], name: 'Grace' }, roster[1]];
        rerender();
        await waitFor(() => expect(result.current).toEqual(after));
        expect(f.row.toJSON()).toEqual(sourceSnapshot);
        expect(f.relatedRow.toJSON()).toEqual(relatedSnapshot);
      } finally {
        unmount();
        const users: MentionablePerson[] = [];

        rosterHook.mockImplementation(() => ({ users, usersByUid: new Map(), loading: false }));
      }
    }
  );
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

  it('refreshes a formula filter after its related value changes while the view is unmounted', async () => {
    const f = fixture('prop("Rollup")');

    f.filters.push([dataFilter(NumberFilterCondition.GreaterThan, '8')]);
    const opened = renderHook(useRowOrdersSelector, { wrapper: f.wrapper });

    await waitFor(() => expect(opened.result.current).toEqual([]));
    opened.unmount();
    act(() => setAmount(f.relatedRow, '9'));
    const reopened = renderHook(useRowOrdersSelector, { wrapper: f.wrapper });

    await waitFor(() => expect(reopened.result.current?.map((row) => row.id)).toEqual([f.rowId]));
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

describe('formula relation membership', () => {
  it.each(['cell', 'filter', 'footer', 'detached footer'])(
    'refreshes a %s when a related row is deleted and restored without changing its source IDs',
    async (consumer) => {
      const f = fixture('prop("Related").length()');
      let readValue: () => unknown;
      let unmount: () => void;

      if (consumer === 'cell') {
        const rendered = renderHook(() => useCellSelector({ rowId: f.rowId, fieldId: 'formula' }), {
          wrapper: f.wrapper,
        });

        readValue = () => rendered.result.current?.rawNumeric;
        unmount = rendered.unmount;
      } else if (consumer === 'filter') {
        f.filters.push([dataFilter(NumberFilterCondition.GreaterThan, '0')]);
        const rendered = renderHook(useRowOrdersSelector, { wrapper: f.wrapper });

        readValue = () => rendered.result.current?.length;
        unmount = rendered.unmount;
      } else if (consumer === 'footer') {
        const rendered = renderHook(() => useFieldCellsByRowsSelector('formula', f.orders), { wrapper: f.wrapper });

        readValue = () => rendered.result.current.cells?.get(f.rowId);
        unmount = rendered.unmount;
      } else {
        f.context.rowMap = {};
        const source = { rows: {}, getCachedRowDocs: () => ({ [f.rowId]: f.rowDoc }) };
        const rendered = renderHook(() => useFormulaColumnEvaluator('formula', source), { wrapper: f.wrapper });

        readValue = () => rendered.result.current?.(f.rowId, f.row);
        unmount = rendered.unmount;
      }

      const key = { relationField: f.fields.get('relation'), relatedRowId: f.relatedRowId };

      try {
        await waitFor(() => {
          expect(readValue()).toBe(1);
          expect(relationCache.readRelationGroupLabel(key)).toBe('Related title');
        });
        act(() => setRelatedMembership(f, [f.relatedRowId], true));
        await waitFor(() => expect(readValue()).toBe(0));
        // A cached title edit must not resurrect a deleted list item.
        act(() => {
          f.relatedRow.get(YjsDatabaseKey.cells).get('title').set(YjsDatabaseKey.data, '');
        });
        expect(readValue()).toBe(0);
        act(() => setRelatedMembership(f, [f.relatedRowId]));
        await waitFor(() => expect(readValue()).toBe(1));
        // A live row with no title remains in the relation list.
        expect(f.row.get(YjsDatabaseKey.cells).get('relation').get(YjsDatabaseKey.data).toArray()).toEqual([
          f.relatedRowId,
        ]);
      } finally {
        unmount();
      }
    }
  );

  it('removes cached deleted titles and recovers them on restoration', async () => {
    const f = fixture('prop("Related").join(",")');
    const { result } = renderHook(() => useCellSelector({ rowId: f.rowId, fieldId: 'formula' }), { wrapper: f.wrapper });

    await waitFor(() => expect(result.current?.data).toBe('Related title'));
    act(() => setRelatedMembership(f, [f.relatedRowId], true));
    await waitFor(() => expect(result.current?.data).toBe(''));
    act(() => setRelatedMembership(f, [f.relatedRowId]));
    await waitFor(() => expect(result.current?.data).toBe('Related title'));
  });

  it('materializes only live relation members and skips loading deleted row documents', async () => {
    const f = fixture('prop("Related").length()');

    setRelatedMembership(f, [f.relatedRowId], true);
    f.context.createRow = jest.fn().mockRejectedValue(new Error('Deleted rows must not be loaded'));
    const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });

    await act(async () => result.current('formula', FieldType.Number));
    expect(f.context.createRow).not.toHaveBeenCalled();
    expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe('0');
  });

  it.each(['all views', 'canonical orders'])(
    'awaits target membership hydration before materializing a relation with missing %s',
    async (missing) => {
      const f = fixture('prop("Related").length()');
      const relatedDatabase = f.relatedDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
      const views = relatedDatabase.get(YjsDatabaseKey.views).clone();

      if (missing === 'all views') {
        relatedDatabase.delete(YjsDatabaseKey.views);
      } else {
        relatedDatabase.set(YjsDatabaseKey.metas, new Y.Map([[YjsDatabaseKey.iid, f.relatedDoc.guid]]));
        relatedDatabase.get(YjsDatabaseKey.views).get(f.relatedDoc.guid).delete(YjsDatabaseKey.row_orders);
        const linkedView = new Y.Map() as YDatabaseView;

        linkedView.set(YjsDatabaseKey.row_orders, new Y.Array());
        relatedDatabase.get(YjsDatabaseKey.views).set('linked', linkedView);
      }

      const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });
      let pending!: Promise<void>;

      act(() => {
        pending = result.current('formula', FieldType.Number);
      });
      await waitFor(() => expect(f.context.loadView).toHaveBeenCalled());
      expect(f.fields.get('formula').get(YjsDatabaseKey.type)).toBe(FieldType.Formula);
      await act(async () => {
        relatedDatabase.set(YjsDatabaseKey.views, views);
        await pending;
      });
      expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe('1');
    }
  );

  it('shares one membership scan across every source row in a conversion', async () => {
    const f = fixture('prop("Related").length()');

    for (let index = 1; index < 20; index += 1) {
      const doc = new Y.Doc() as YDoc;

      Y.applyUpdate(doc, Y.encodeStateAsUpdate(f.rowDoc));
      f.context.rowMap![`${f.rowId}-${index}`] = doc;
    }

    const scan = jest.spyOn(f.relatedOrders, 'toArray');
    const { result } = renderHook(useSwitchPropertyType, { wrapper: f.wrapper });

    try {
      await act(async () => result.current('formula', FieldType.Number));
      expect(f.row.get(YjsDatabaseKey.cells).get('formula').get(YjsDatabaseKey.data)).toBe('1');
      // One canonical read and one view read, regardless of the source row count.
      expect(scan).toHaveBeenCalledTimes(2);
    } finally {
      scan.mockRestore();
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
    setRelatedMembership(f, [...ids, unusedId]);
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
      setRelatedMembership(f, ids);
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

describe('formula review regressions', () => {
  it.each(['', ' + "unfinished'])('preserves IDs when names are reused with draft suffix %s', (suffix) => {
    const f = fixture('prop("price-first")');

    f.fields.get('price-second').set(YjsDatabaseKey.name, 'Other');
    render(<FormulaEditorDialog fieldId='formula' rowId={f.rowId} open onOpenChange={jest.fn()} />, {
      wrapper: f.wrapper,
    });
    if (suffix) {
      fireEvent.change(screen.getByTestId('formula-editor-input'), { target: { value: `prop("Price")${suffix}` } });
    }

    act(() => {
      f.fields.doc.transact(() => {
        f.fields.get('price-first').set(YjsDatabaseKey.name, 'Amount');
        f.fields.get('price-second').set(YjsDatabaseKey.name, 'Price');
      });
    });
    expect(screen.getByTestId('formula-editor-input').value).toBe(`prop("Amount")${suffix}`);
    if (suffix) {
      fireEvent.change(screen.getByTestId('formula-editor-input'), { target: { value: 'prop("Amount") + 1' } });
    }

    expect(screen.getByTestId('formula-preview-value').textContent).toBe(suffix ? '3' : '2');
    fireEvent.click(screen.getByTestId('formula-editor-done'));
    expect(parseFormulaTypeOption(f.fields.get('formula')).formula).toBe(`prop("price-first")${suffix ? ' + 1' : ''}`);
  });

  it('keeps zero non-empty in grid and timeline footer calculations', () => {
    const f = fixture('prop("price-first")');

    f.row.get(YjsDatabaseKey.cells).get('price-first').set(YjsDatabaseKey.data, '0');
    const { result } = renderHook(
      () => ({
        grid: useFieldCellsByRowsSelector('formula', f.orders),
        timeline: useFormulaColumnEvaluator('formula', { rows: {}, getCachedRowDocs: () => ({ [f.rowId]: f.rowDoc }) }),
      }),
      { wrapper: f.wrapper }
    );
    const values = [result.current.grid.cells?.get(f.rowId), result.current.timeline?.(f.rowId, f.row)];

    expect(values).toEqual([0, 0]);
    for (const value of values) {
      expect(
        calculateFieldValue({
          fieldType: FieldType.Number,
          calculationType: CalculationType.CountEmpty,
          cellValues: [value, ''],
        })
      ).toBe(1);
      expect(
        calculateFieldValue({
          fieldType: FieldType.Number,
          calculationType: CalculationType.CountNonEmpty,
          cellValues: [value, ''],
        })
      ).toBe(1);
    }
  });
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
