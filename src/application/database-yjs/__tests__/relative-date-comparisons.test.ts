import dayjs from 'dayjs';
import * as Y from 'yjs';

import { updateServerInfo, SERVER_INFO_LOADING, ServerInfoState } from '@/utils/server-info';

import { DateTimeCell } from '../cell.type';
import { FieldType, FilterType } from '../database.type';
import { applyFilterUpdate } from '../dispatch/filter-update';
import { DateFilter, DateFilterCondition as C } from '../fields/date/date.type';
import { toEndDateCondition, toStartDateCondition } from '../fields/date/relativeDate';
import {
  dateFilterCheck,
  dateFilterFillData,
  getEffectiveFiltersSnapshot,
  parseFilter,
  rowTimeFilterCheck,
} from '../filter';
import {
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YjsDatabaseKey as K,
} from '@/application/types';

function fixture(condition: C, content: string, type = FieldType.DateTime) {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;
  const filters = doc.getArray('filters') as YDatabaseFilters;
  const node = new Y.Map() as YDatabaseFilter;

  fields.set('date', field);
  field.set(K.type, type);
  filters.push([node]);
  node.set(K.id, 'rule');
  node.set(K.field_id, 'date');
  node.set(K.filter_type, FilterType.Data);
  node.set(K.condition, condition);
  node.set(K.content, content);
  return { doc, fields, filters, node };
}

const comparisons: [C, C, (difference: number) => boolean][] = [
  [C.DateStartsOn, C.DateEndsOn, (d) => d === 0],
  [C.DateStartsBefore, C.DateEndsBefore, (d) => d < 0],
  [C.DateStartsAfter, C.DateEndsAfter, (d) => d > 0],
  [C.DateStartsOnOrBefore, C.DateEndsOnOrBefore, (d) => d <= 0],
  [C.DateStartsOnOrAfter, C.DateEndsOnOrAfter, (d) => d >= 0],
];

describe('relative date comparison operands (desktop #9069)', () => {
  beforeEach(() => {
    updateServerInfo('https://test.appflowy.cloud', {
      status: 'available',
      info: { enable_page_history: false, enable_relative_date_comparisons: true },
    });
    jest.useFakeTimers();
    // Local spring DST boundary in America/New_York; also run this suite in UTC.
    jest.setSystemTime(new Date(2026, 2, 8, 12));
  });
  afterEach(() => {
    jest.useRealTimers();
    updateServerInfo('https://test.appflowy.cloud', SERVER_INFO_LOADING);
  });

  it.each(comparisons)('keeps operator %s when switching to end %s', (start, end) => {
    expect(toEndDateCondition(start)).toBe(end);
    expect(toStartDateCondition(end)).toBe(start);
  });

  it.each<ServerInfoState>([
    { status: 'loading' },
    { status: 'unsupported' },
    { status: 'unavailable' },
    { status: 'available', info: { enable_page_history: false } },
    { status: 'available', info: { enable_page_history: false, enable_relative_date_comparisons: false } },
  ])('does not write unsupported comparisons when discovery is $status', (state) => {
    updateServerInfo('https://test.appflowy.cloud', state);
    const { fields, filters, node } = fixture(C.DateStartsBefore, '{"timestamp":1700000000}');
    const saved = node.toJSON();

    applyFilterUpdate(filters, fields, { filterId: 'rule', content: '{"relative_date":"Today"}' });
    expect(node.toJSON()).toEqual(saved);
    applyFilterUpdate(filters, fields, { filterId: 'rule', transformContent: () => '{"relative_date":"Tomorrow"}' });
    expect(node.toJSON()).toEqual(saved);
    applyFilterUpdate(filters, fields, { filterId: 'rule', content: '{"timestamp":1700086400}' });
    expect(node.get(K.content)).toBe('{"timestamp":1700086400}');
  });

  it.each([FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime, FieldType.Rollup])(
    'keeps legacy relative conditions usable for type %s without upgrading their wire format',
    (type) => {
      updateServerInfo('https://test.appflowy.cloud', SERVER_INFO_LOADING);
      const { fields, filters, node } = fixture(C.DateStartsOn, '{"timestamp":1700000000}', type);

      if (type === FieldType.Rollup) {
        node.set(K.rollup_target_type, FieldType.DateTime);
        node.set(K.rollup_meta, { target_field_type: FieldType.DateTime, rollup_filter_mode: 0, rollup_show_as: 1 });
      }
      applyFilterUpdate(filters, fields, { filterId: 'rule', condition: C.DateStartsToday });
      expect(node.get(K.condition)).toBe(C.DateStartsToday);
      expect(node.get(K.content)).toBe('');
      applyFilterUpdate(filters, fields, { filterId: 'rule', condition: C.DateStartsBefore });
      expect(node.get(K.condition)).toBe(C.DateStartsBefore);
      expect(node.get(K.content)).toBe('');
      applyFilterUpdate(filters, fields, { filterId: 'rule', content: '{"relative_date":"Today"}' });
      expect(node.get(K.content)).toBe('');
    }
  );

  it('preserves synced relative comparisons without rewriting them when rollout authorization is absent', () => {
    updateServerInfo('https://test.appflowy.cloud', SERVER_INFO_LOADING);
    const { fields, filters, node } = fixture(C.DateStartsBefore, '{"relative_date":"Today"}');
    const saved = node.toJSON();
    const parsed = parseFilter(FieldType.DateTime, node) as DateFilter;

    expect(dateFilterCheck({ data: dayjs().subtract(1, 'day').unix().toString() } as DateTimeCell, parsed)).toBe(true);
    applyFilterUpdate(filters, fields, { filterId: 'rule', condition: C.DateStartsAfter });
    expect(node.toJSON()).toEqual(saved);
    applyFilterUpdate(filters, fields, { filterId: 'rule', content: '{"timestamp":1700000000}' });
    expect(node.toJSON()).toEqual(saved);
  });

  it('checks the resulting rollup predicate type when metadata and content change together', () => {
    updateServerInfo('https://test.appflowy.cloud', SERVER_INFO_LOADING);
    const { fields, filters, node } = fixture(C.DateStartsBefore, '', FieldType.Rollup);

    node.set(K.rollup_target_type, FieldType.RichText);
    const saved = node.toJSON();

    applyFilterUpdate(filters, fields, {
      filterId: 'rule',
      rollupTargetFieldType: FieldType.DateTime,
      rollupMetadata: { target_field_type: FieldType.DateTime, rollup_filter_mode: 0, rollup_show_as: 1 },
      content: '{"relative_date":"Today"}',
    });
    expect(node.toJSON()).toEqual(saved);
  });

  describe.each([
    ['Yesterday', -1],
    ['Today', 0],
    ['Tomorrow', 1],
  ] as const)('%s', (relativeDate, offset) => {
    it.each(comparisons)('evaluates start %s and end %s with the persisted desktop operand', (start, end, matches) => {
      for (const condition of [start, end]) {
        const { node } = fixture(
          condition,
          JSON.stringify({
            relative_date: relativeDate,
            timestamp: null,
            start: null,
            end: null,
          })
        );
        const filter = parseFilter(FieldType.DateTime, node) as DateFilter;
        const anchor = dayjs().startOf('day').add(offset, 'day');

        for (const delta of [-1, 0, 1]) {
          for (const hour of [0, 12, 23]) {
            const timestamp = anchor.add(delta, 'day').hour(hour).unix().toString();
            const cell = {
              data: condition === start ? timestamp : '',
              endTimestamp: condition === end ? timestamp : '',
            };

            expect(dateFilterCheck(cell as DateTimeCell, filter)).toBe(matches(delta));
            if (condition === start) expect(rowTimeFilterCheck(timestamp, filter)).toBe(matches(delta));
          }
        }
        expect(dateFilterCheck(null, filter)).toBe(false);
        expect(dateFilterCheck({ data: '', endTimestamp: '' } as DateTimeCell, filter)).toBe(false);
        expect(JSON.parse(node.get(K.content)).timestamp).toBeNull();
      }
    });

    it.each(comparisons)('prefills a matching row for %s and %s without freezing the operand', (start, end) => {
      for (const condition of [start, end]) {
        const { node } = fixture(condition, JSON.stringify({ relative_date: relativeDate }));
        const filter = parseFilter(FieldType.DateTime, node) as DateFilter;
        const fill = dateFilterFillData(node);

        expect(dateFilterCheck(fill as DateTimeCell, filter)).toBe(true);
        jest.setSystemTime(dayjs().add(1, 'day').toDate());
        const next = dateFilterFillData(node);

        expect(dateFilterCheck(next as DateTimeCell, filter)).toBe(true);
        expect(dayjs.unix(Number(next.data)).diff(dayjs.unix(Number(fill.data)), 'day')).toBe(1);
        expect(JSON.parse(node.get(K.content))).toEqual({ relative_date: relativeDate });
      }
    });
  });

  it.each([FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime])(
    'preserves relative days across operator edits for date type %s and Yjs reload',
    (type) => {
      const { doc, fields, filters, node } = fixture(C.DateStartsYesterday, '', type);

      doc.transact(() => applyFilterUpdate(filters, fields, { filterId: 'rule', condition: C.DateStartsBefore }));
      expect(JSON.parse(node.get(K.content))).toEqual({ relative_date: 'Yesterday' });
      applyFilterUpdate(filters, fields, { filterId: 'rule', condition: C.DateEndsBefore });
      expect(JSON.parse(node.get(K.content))).toEqual({ relative_date: 'Yesterday' });
      const reopened = new Y.Doc();

      Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc));
      const saved = (reopened.getArray('filters') as YDatabaseFilters).get(0);

      expect(parseFilter(type, saved)).toMatchObject({ condition: C.DateEndsBefore, relative_date: 'Yesterday' });
      applyFilterUpdate(filters, fields, { filterId: 'rule', condition: C.DateEndsBetween });
      expect(node.get(K.content)).not.toContain('relative_date');
      expect(parseFilter(type, node).condition).toBe(C.DateEndsBetween);
    }
  );

  it('retains a relative date rollup in the effective filter tree', () => {
    const { fields, filters, node } = fixture(C.DateStartsBefore, '{"relative_date":"Today"}', FieldType.Rollup);

    node.set(K.rollup_target_type, FieldType.DateTime);
    node.set(K.rollup_meta, { target_field_type: FieldType.DateTime, rollup_filter_mode: 0, rollup_show_as: 1 });
    expect(getEffectiveFiltersSnapshot(filters, fields)).toHaveLength(1);
  });

  it('clears a relative date to a desktop-compatible null without crashing evaluation', () => {
    const { fields, filters, node } = fixture(C.DateStartsBefore, '{"relative_date":"Today"}');

    applyFilterUpdate(filters, fields, { filterId: 'rule', content: '{"timestamp":null}' });
    const parsed = parseFilter(FieldType.DateTime, node) as DateFilter;
    const data = dayjs().unix().toString();

    expect(dateFilterCheck({ data } as DateTimeCell, parsed)).toBe(false);
    expect(rowTimeFilterCheck(data, parsed)).toBe(false);
  });

  it('ignores a relative operand on Between and tolerates an unfinished range', () => {
    const start = dayjs().startOf('day').unix();
    const { node } = fixture(C.DateStartsBetween, JSON.stringify({ start, end: null, relative_date: 'Tomorrow' }));
    const cell = { data: String(start) } as DateTimeCell;
    const partial = parseFilter(FieldType.DateTime, node) as DateFilter;

    expect(dateFilterCheck(cell, partial)).toBe(false);
    expect(rowTimeFilterCheck(cell.data, partial)).toBe(false);
    node.set(K.content, JSON.stringify({ start, end: start, relative_date: 'Tomorrow' }));
    const complete = parseFilter(FieldType.DateTime, node) as DateFilter;

    expect(dateFilterCheck(cell, complete)).toBe(true);
  });

  it.each([C.DateStartIsEmpty, C.DateStartIsNotEmpty, C.DateStartsThisWeek])(
    'clears a relative operand for condition %s without restoring it on a later comparison',
    (condition) => {
      const { fields, filters, node } = fixture(C.DateStartsBefore, '{"relative_date":"Tomorrow"}');

      applyFilterUpdate(filters, fields, { filterId: 'rule', condition });
      expect(node.get(K.content)).not.toContain('relative_date');
      applyFilterUpdate(filters, fields, { filterId: 'rule', condition: C.DateStartsAfter });
      expect(node.get(K.content)).not.toContain('relative_date');
    }
  );

  it('patches desktop plain-object advanced rules without changing siblings', () => {
    const { fields, filters } = fixture(C.DateStartsOn, '');
    const sibling = {
      id: 'sibling',
      field_id: 'date',
      filter_type: FilterType.Data,
      condition: C.DateStartsThisWeek,
      content: '',
    };
    const rule = {
      id: 'nested',
      field_id: 'date',
      filter_type: FilterType.Data,
      condition: C.DateStartsToday,
      content: '',
    };

    filters.delete(0);
    filters.push([{ id: 'group', filter_type: FilterType.Or, children: [rule, sibling] } as unknown as YDatabaseFilter]);
    applyFilterUpdate(filters, fields, { filterId: 'nested', condition: C.DateEndsBefore });
    expect(filters.toJSON()[0].children).toEqual([
      { ...rule, condition: C.DateEndsBefore, content: '{"relative_date":"Today"}' },
      sibling,
    ]);
  });
});
