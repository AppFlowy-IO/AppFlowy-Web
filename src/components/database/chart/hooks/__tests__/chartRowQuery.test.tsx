/**
 * Mirrors desktop's `chart_row_query_test.dart` and `chart_row_filter_test.dart`:
 * the drill-down's rules over database membership, evaluated with the grid's
 * own predicates (`filterBy`). Desktop's asynchronous generation checks have no
 * counterpart here: the web result is derived from the loaded row documents.
 */
import { act, renderHook } from '@testing-library/react';
import dayjs from 'dayjs';
import * as Y from 'yjs';

import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { DetachedFilter } from '@/application/database-yjs/dispatch/detached-filters';
import { SelectOptionColor, SelectOptionFilterCondition as S } from '@/application/database-yjs/fields';
import { CheckboxFilterCondition } from '@/application/database-yjs/fields/checkbox/checkbox.type';
import { DateFilterCondition as D } from '@/application/database-yjs/fields/date/date.type';
import { NumberFilterCondition as N } from '@/application/database-yjs/fields/number/number.type';
import { TextFilterCondition as T } from '@/application/database-yjs/fields/text/text.type';
import { Row } from '@/application/database-yjs/selector';
import {
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFieldTypeOption,
  YDatabaseRowOrders,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey as K,
  YMapFieldTypeOption,
} from '@/application/types';

let mockDatabase: YDatabase;
let mockView: YDatabaseView;
let mockFields: YDatabaseFields;
let mockRowMap: Record<RowId, YDoc>;
let mockCachedRowDocs: Record<RowId, YDoc> = {};
let mockUnavailableRowIds: ReadonlySet<RowId> = new Set();
const mockLoader = jest.fn((_active: boolean, _scope: string) => ({
  cachedRowDocs: mockCachedRowDocs,
  unavailableRowIds: mockUnavailableRowIds,
}));

jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useDatabase: () => mockDatabase,
  useDatabaseContext: () => ({}),
  useDatabaseView: () => mockView,
  useDatabaseFields: () => mockFields,
  useRowMap: () => mockRowMap,
}));
jest.mock('@/application/database-yjs/hooks', () => ({
  useBackgroundRowDocLoader: (active: boolean, scope: string) => mockLoader(active, scope),
  useDatabaseFieldsVersion: () => 0,
}));

import { queryChartRows } from '../chartRowQuery';
import { useChartRowQuery } from '../useChartRowQuery';

type CellInput = ReturnType<typeof createCell> & { endTimestamp?: string; isRange?: boolean };

function addField(id: string, type: FieldType, options?: unknown) {
  const field = new Y.Map() as YDatabaseField;

  mockFields.set(id, field);
  field.set(K.id, id);
  field.set(K.name, id);
  field.set(K.type, type);
  if (options) {
    const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
    const typeOption = new Y.Map() as YMapFieldTypeOption;

    field.set(K.type_option, typeOptions);
    typeOptions.set(String(type), typeOption);
    typeOption.set(K.content, JSON.stringify({ options, disable_color: false }));
  }
}

let rowOrders: YDatabaseRowOrders;

function setup() {
  const doc = new Y.Doc();

  mockDatabase = doc.getMap('database') as YDatabase;
  mockView = doc.getMap('view') as YDatabaseView;
  rowOrders = new Y.Array() as YDatabaseRowOrders;
  mockView.set(K.row_orders, rowOrders);
  mockFields = doc.getMap('fields') as YDatabaseFields;
  mockRowMap = {};
  mockCachedRowDocs = {};
  mockUnavailableRowIds = new Set();
  mockLoader.mockClear();
  addField('number', FieldType.Number);
  addField('text', FieldType.RichText);
  addField('url', FieldType.URL);
  addField('check', FieldType.Checkbox);
  addField('select', FieldType.MultiSelect, [
    { id: 'a', name: 'Same', color: SelectOptionColor.OptionColor1 },
    { id: 'b', name: 'Same', color: SelectOptionColor.OptionColor2 },
  ]);
  addField('date', FieldType.DateTime);
  addField('created', FieldType.CreatedTime);
}

const rule = (fieldId: string, type: FieldType, condition: number, content?: string): DetachedFilter => ({
  [K.id]: `${fieldId}-${condition}-${content ?? ''}`,
  [K.field_id]: fieldId,
  [K.type]: type,
  [K.filter_type]: FilterType.Data,
  [K.condition]: condition,
  ...(content === undefined ? {} : { [K.content]: content }),
});
const number = (condition: N, content: string) => rule('number', FieldType.Number, condition, content);
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id, height: 36 }));
const doc = (id: string, cells: Record<string, CellInput> = {}, createdAt?: string) =>
  createRowDoc(id, 'db', cells, createdAt);
const numberDocs = (values: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(values).map(([id, value]) => [id, doc(id, { number: createCell(FieldType.Number, value) })])
  );

/** Whether one row with these cells passes the rule. */
function passes(filter: DetachedFilter, cells: Record<string, CellInput>, createdAt?: string) {
  const result = queryChartRows({ members: rows('r'), rowDocs: { r: doc('r', cells, createdAt) }, rules: [filter], fields: mockFields });

  return result.rowIds?.length === 1;
}

beforeEach(setup);

describe('queryChartRows', () => {
  it('applies the category rule at once and combines it with added rules', () => {
    const rowDocs = numberDocs({ a: '10', b: '20' });
    const query = (rules: DetachedFilter[]) =>
      queryChartRows({ members: rows('a', 'b'), rowDocs, rules, fields: mockFields }).rowIds;
    const category = number(N.GreaterThan, '5');

    expect(query([category])).toEqual(['a', 'b']);
    expect(query([category, number(N.LessThan, '15')])).toEqual(['a']);
    expect(query([category])).toEqual(['a', 'b']);
  });

  it('editing or deleting the category reveals rows outside the clicked bucket', () => {
    const rowDocs = numberDocs({ a: '10', b: '20', 'hidden-by-original-view': '20' });
    const members = rows('a', 'b', 'hidden-by-original-view');
    const query = (rules: DetachedFilter[]) => queryChartRows({ members, rowDocs, rules, fields: mockFields }).rowIds;

    expect(query([number(N.Equal, '10')])).toEqual(['a']);
    expect(query([number(N.Equal, '20')])).toEqual(['b', 'hidden-by-original-view']);
    expect(query([])).toEqual(['a', 'b', 'hidden-by-original-view']);
  });

  it('follows membership: inserted rows join and deleted rows leave', () => {
    const rowDocs = numberDocs({ a: '1', b: '1', c: '1' });
    const query = (members: Row[]) =>
      queryChartRows({ members, rowDocs, rules: [number(N.Equal, '1')], fields: mockFields }).rowIds;

    expect(query(rows('a', 'b'))).toEqual(['a', 'b']);
    expect(query(rows('b', 'c'))).toEqual(['b', 'c']);
    expect(query([])).toEqual([]);
  });

  it('filters every member, keeps their order and treats blank rules as drafts', () => {
    const rowDocs = numberDocs({ a: '10', b: '2', c: '10' });
    const query = (rules: DetachedFilter[]) =>
      queryChartRows({ members: rows('a', 'b', 'c'), rowDocs, rules, fields: mockFields }).rowIds;
    const moreThan = number(N.GreaterThan, '5');

    expect(query([moreThan])).toEqual(['a', 'c']);
    expect(query([moreThan, number(N.LessThan, '5')])).toEqual([]);
    expect(query([])).toEqual(['a', 'b', 'c']);
    expect(query([number(N.Equal, '')])).toEqual(['a', 'b', 'c']);
  });

  it('waits for rows without data and reports rows that could not load instead of treating them as empty', () => {
    const rowDocs = numberDocs({ b: '2' });
    const members = rows('a', 'b');

    expect(queryChartRows({ members, rowDocs, rules: [number(N.Equal, '2')], fields: mockFields })).toEqual({
      rowIds: null,
      unavailableRowIds: [],
      pendingRowIds: ['a'],
    });

    const unavailableRowIds = new Set(['a']);

    expect(queryChartRows({ members, rowDocs, rules: [number(N.Equal, '2')], fields: mockFields, unavailableRowIds })).toEqual({
      rowIds: ['b'],
      unavailableRowIds: ['a'],
      pendingRowIds: [],
    });
    expect(
      queryChartRows({ members, rowDocs, rules: [number(N.NumberIsEmpty, '')], fields: mockFields, unavailableRowIds })
        .rowIds
    ).toEqual([]);
    // Without a rule to evaluate, nothing has to load.
    expect(queryChartRows({ members, rowDocs: {}, rules: [number(N.Equal, '')], fields: mockFields }).rowIds).toEqual([
      'a',
      'b',
    ]);
  });

  it('matches every text operator like the grid', () => {
    const expected: [T, boolean][] = [
      [T.TextIs, false],
      [T.TextIsNot, true],
      [T.TextContains, true],
      [T.TextDoesNotContain, false],
      [T.TextStartsWith, true],
      [T.TextEndsWith, false],
      [T.TextIsEmpty, false],
      [T.TextIsNotEmpty, true],
    ];

    for (const [condition, result] of expected) {
      const filter = rule('text', FieldType.RichText, condition, 'HELLO');

      expect([condition, passes(filter, { text: createCell(FieldType.RichText, 'hello world') })]).toEqual([
        condition,
        result,
      ]);
    }

    expect(passes(rule('text', FieldType.RichText, T.TextContains, ''), {})).toBe(true);
    expect(
      passes(rule('url', FieldType.URL, T.TextEndsWith, '.com'), { url: createCell(FieldType.URL, 'https://example.com') })
    ).toBe(true);
  });

  it('matches every number operator, empty cells and drafts like the grid', () => {
    const expected: [N, boolean][] = [
      [N.Equal, true],
      [N.NotEqual, false],
      [N.GreaterThan, false],
      [N.LessThan, false],
      [N.GreaterThanOrEqualTo, true],
      [N.LessThanOrEqualTo, true],
      [N.NumberIsEmpty, false],
      [N.NumberIsNotEmpty, true],
    ];

    for (const [condition, result] of expected) {
      expect([condition, passes(number(condition, '1000'), { number: createCell(FieldType.Number, '1000') })]).toEqual([
        condition,
        result,
      ]);
    }

    expect(passes(number(N.Equal, '1000'), {})).toBe(false);
    expect(passes(number(N.Equal, ''), {})).toBe(true);
  });

  it('defaults a missing checkbox to unchecked and matches select rules by option id, not name', () => {
    expect(passes(rule('check', FieldType.Checkbox, CheckboxFilterCondition.IsChecked), {})).toBe(false);
    expect(passes(rule('check', FieldType.Checkbox, CheckboxFilterCondition.IsUnChecked), {})).toBe(true);

    // Both options are named "Same"; the rule names only `a`.
    const cells = { select: createCell(FieldType.MultiSelect, 'a,b') };
    const expected: [S, boolean][] = [
      [S.OptionIs, false],
      [S.OptionIsNot, true],
      [S.OptionContains, true],
      [S.OptionDoesNotContain, false],
      [S.OptionIsEmpty, false],
      [S.OptionIsNotEmpty, true],
    ];

    for (const [condition, result] of expected) {
      expect([condition, passes(rule('select', FieldType.MultiSelect, condition, 'a'), cells)]).toEqual([condition, result]);
    }

    expect(passes(rule('select', FieldType.MultiSelect, S.OptionIs, ''), cells)).toBe(true);
  });

  describe('dates', () => {
    const at = (day: number, hour = 0, minute = 0) => dayjs(new Date(2026, 9, day, hour, minute)).unix();
    const dateCells = (start: number, end?: number): Record<string, CellInput> => ({
      date: {
        ...createCell(FieldType.DateTime, String(start)),
        ...(end === undefined ? {} : { endTimestamp: String(end), isRange: true }),
      },
    });

    beforeEach(() => {
      jest.useFakeTimers({ now: new Date(2026, 9, 28, 15), doNotFake: ['nextTick', 'setImmediate'] });
    });
    afterEach(() => jest.useRealTimers());

    it('match every date operator on local calendar days', () => {
      // The row starts Oct 28 and ends Oct 29; each rule targets the day its
      // side of the range falls on, as a local midnight like the editors store.
      const isFalse = new Set([
        D.DateStartsBefore,
        D.DateEndsBefore,
        D.DateStartsAfter,
        D.DateEndsAfter,
        D.DateStartIsEmpty,
        D.DateEndIsEmpty,
        D.DateStartsYesterday,
        D.DateEndsYesterday,
        D.DateStartsTomorrow,
        D.DateEndsToday,
        D.DateStartsLastWeek,
        D.DateEndsLastWeek,
        D.DateStartsNextWeek,
        D.DateEndsNextWeek,
      ]);
      // "Between" takes a range and is covered below.
      const conditions = (Object.values(D).filter((value) => typeof value === 'number') as D[]).filter(
        (condition) => condition !== D.DateStartsBetween && condition !== D.DateEndsBetween
      );

      for (const condition of conditions) {
        const target = condition >= D.DateEndsOn && condition <= D.DateEndIsNotEmpty ? at(29) : at(28);
        const filter = rule('date', FieldType.DateTime, condition, JSON.stringify({ timestamp: target }));

        expect([condition, passes(filter, dateCells(at(28, 8), at(29, 8)))]).toEqual([condition, !isFalse.has(condition)]);
      }

      expect(passes(rule('date', FieldType.DateTime, D.DateStartIsEmpty, ''), {})).toBe(true);
    });

    it('between includes the first and last day of its range', () => {
      const between = rule('date', FieldType.DateTime, D.DateStartsBetween, JSON.stringify({ start: at(26), end: at(28) }));

      expect(passes(between, dateCells(at(26)))).toBe(true);
      expect(passes(between, dateCells(at(27, 12)))).toBe(true);
      expect(passes(between, dateCells(at(28)))).toBe(true);
      // A chip's range ends at the last day's midnight, like the editors store it.
      expect(passes(between, dateCells(at(28, 23, 59)))).toBe(true);
      expect(passes(between, dateCells(at(25, 23, 59)))).toBe(false);
      expect(passes(between, dateCells(at(29)))).toBe(false);
    });

    it('relative comparisons and ISO weeks include their boundaries', () => {
      const yesterday = rule('date', FieldType.DateTime, D.DateStartsOn, JSON.stringify({ relative_date: 'Yesterday' }));

      expect(passes(yesterday, dateCells(at(27, 23, 59)))).toBe(true);

      const thisWeek = rule('date', FieldType.DateTime, D.DateStartsThisWeek, '');

      expect(passes(thisWeek, dateCells(at(26)))).toBe(true);
      expect(passes(thisWeek, dateCells(dayjs(new Date(2026, 10, 1, 23, 59)).unix()))).toBe(true);
      expect(passes(thisWeek, dateCells(dayjs(new Date(2026, 10, 2)).unix()))).toBe(false);

      const createdToday = rule('created', FieldType.CreatedTime, D.DateStartsOn, JSON.stringify({ timestamp: at(28, 15) }));

      expect(passes(createdToday, {}, String(at(28, 15)))).toBe(true);
    });
  });
});

describe('useChartRowQuery', () => {
  const setRowOrders = (...ids: string[]) =>
    act(() => {
      rowOrders.delete(0, rowOrders.length);
      rowOrders.push(rows(...ids));
    });

  it('lists the clicked bucket until the database-wide result settles, and keeps the last result while loading', () => {
    setRowOrders('a', 'b');
    mockRowMap = numberDocs({ a: '10' });
    const { result, rerender } = renderHook(
      ({ rules }) => useChartRowQuery({ rules, baseRowIds: null, initialRowIds: ['a'] }),
      { initialProps: { rules: [number(N.GreaterThan, '5')] } }
    );

    // `b` is hidden by the view's filter, so its document is still loading.
    expect(mockLoader).toHaveBeenLastCalledWith(true, 'chart-row-popup:0');
    expect(result.current).toEqual(expect.objectContaining({ rowIds: ['a'], loading: true, error: false }));

    mockCachedRowDocs = numberDocs({ b: '20' });
    rerender({ rules: [number(N.GreaterThan, '5')] });
    expect(result.current).toEqual(expect.objectContaining({ rowIds: ['a', 'b'], loading: false, error: false }));

    rerender({ rules: [number(N.GreaterThan, '15')] });
    expect(result.current.rowIds).toEqual(['b']);

    // A row inserted while the popup is open has to load before it can be judged.
    setRowOrders('a', 'b', 'c');
    expect(result.current).toEqual(expect.objectContaining({ rowIds: ['b'], loading: true }));

    mockUnavailableRowIds = new Set(['c']);
    rerender({ rules: [number(N.GreaterThan, '15')] });
    expect(result.current).toEqual(expect.objectContaining({ rowIds: ['b'], loading: false, error: true }));

    act(() => result.current.retry());
    expect(mockLoader).toHaveBeenLastCalledWith(true, 'chart-row-popup:1');
  });

  it('needs no row data without an effective rule', () => {
    setRowOrders('a', 'b');
    const { result } = renderHook(() =>
      useChartRowQuery({ rules: [number(N.Equal, '')], baseRowIds: null, initialRowIds: ['a'] })
    );

    expect(mockLoader).toHaveBeenLastCalledWith(false, 'chart-row-popup:0');
    expect(result.current).toEqual(expect.objectContaining({ rowIds: ['a', 'b'], loading: false }));
  });

  it('keeps to the bucket rows when the category has no rule', () => {
    setRowOrders('a', 'b', 'c');
    mockRowMap = numberDocs({ a: '10', b: '20', c: '30' });
    const { result, rerender } = renderHook(
      ({ rules }) => useChartRowQuery({ rules, baseRowIds: ['c', 'a', 'gone'], initialRowIds: ['c', 'a'] }),
      { initialProps: { rules: [] as DetachedFilter[] } }
    );

    expect(result.current.rowIds).toEqual(['c', 'a']);
    rerender({ rules: [number(N.GreaterThan, '15')] });
    expect(result.current.rowIds).toEqual(['c']);
  });
});
