import * as Y from 'yjs';

import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { DateFilterCondition, TextFilterCondition } from '@/application/database-yjs/fields';
import {
  combineFilters,
  createVirtualFilters,
  filterBy,
  getEffectiveFiltersSnapshot,
  hasEffectiveFilters,
} from '@/application/database-yjs/filter';
import { Row } from '@/application/database-yjs/selector';
import {
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDoc,
  YjsDatabaseKey,
} from '@/application/types';

import { createCell, createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

const DATABASE_ID = 'database-id';
const TITLE = 'title-field';
const STATUS = 'status-field';

type PlainNode = {
  id: string;
  filter_type: FilterType;
  field_id: string;
  ty: FieldType;
  condition: number;
  content: string;
};

function plainNode(
  id: string,
  fieldId: string,
  content: string,
  condition = TextFilterCondition.TextContains
): PlainNode {
  return { id, filter_type: FilterType.Data, field_id: fieldId, ty: FieldType.RichText, condition, content };
}

function createFixture() {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;
  const viewFilters = doc.getArray('filters') as unknown as YDatabaseFilters;

  [TITLE, STATUS].forEach((fieldId) => {
    const field = new Y.Map() as YDatabaseField;

    fields.set(fieldId, field);
    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.name, fieldId);
    field.set(YjsDatabaseKey.type, FieldType.RichText);
  });

  const rowMetas: Record<string, YDoc> = {
    'row-a': createRowDoc('row-a', DATABASE_ID, {
      [TITLE]: createCell(FieldType.RichText, 'alpha task'),
      [STATUS]: createCell(FieldType.RichText, 'done'),
    }),
    'row-b': createRowDoc('row-b', DATABASE_ID, {
      [TITLE]: createCell(FieldType.RichText, 'beta task'),
      [STATUS]: createCell(FieldType.RichText, 'todo'),
    }),
    'row-c': createRowDoc('row-c', DATABASE_ID, {
      [TITLE]: createCell(FieldType.RichText, 'gamma note'),
      [STATUS]: createCell(FieldType.RichText, 'done'),
    }),
  };
  const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 36 }));

  return { doc, fields, viewFilters, rowMetas, rows };
}

function pushViewFilter(filters: YDatabaseFilters, node: PlainNode) {
  const filter = new Y.Map() as YDatabaseFilter;

  (filters as unknown as Y.Array<YDatabaseFilter>).push([filter]);
  Object.entries(node).forEach(([key, value]) => filter.set(key as YjsDatabaseKey, value as never));
  return filter;
}

function ids(rows: Row[]) {
  return rows.map((row) => row.id);
}

describe('combineFilters', () => {
  it('passes the view filters through untouched when nothing is injected', () => {
    const { viewFilters } = createFixture();

    expect(combineFilters(viewFilters, undefined)).toBe(viewFilters);
    expect(combineFilters(viewFilters, [])).toBe(viewFilters);
    expect(combineFilters(undefined, undefined)).toBeUndefined();
    expect(combineFilters(undefined, [])).toBeUndefined();
  });

  it('exposes injected nodes when the view has no filters', () => {
    const node = plainNode('gf', STATUS, 'done');
    const combined = combineFilters(undefined, [node]);

    expect(combined).toBeDefined();
    expect(combined?.length).toBe(1);
    expect(combined?.get(0).get(YjsDatabaseKey.field_id)).toBe(STATUS);
    expect(combined?.toArray()).toHaveLength(1);
    expect(combined?.toJSON()).toEqual([node]);
    expect(combined?.toJSON()[0]).not.toBe(node);
  });

  it('appends injected nodes after the view filters', () => {
    const { viewFilters } = createFixture();
    const viewNode = plainNode('view', TITLE, 'task');
    const extra = [plainNode('gf-1', STATUS, 'done'), plainNode('gf-2', TITLE, 'alpha')];
    const viewFilter = pushViewFilter(viewFilters, viewNode);
    const combined = combineFilters(viewFilters, extra) as YDatabaseFilters;

    expect(combined).not.toBe(viewFilters);
    expect(combined.length).toBe(3);
    expect(combined.get(0)).toBe(viewFilter);
    expect(combined.get(1).get(YjsDatabaseKey.content)).toBe('done');
    expect(combined.get(2).get(YjsDatabaseKey.id)).toBe('gf-2');
    expect(combined.get(3)).toBeUndefined();

    const array = combined.toArray();

    expect(array).toHaveLength(3);
    expect(array[0]).toBe(viewFilter);
    expect(array.map((filter) => filter.get(YjsDatabaseKey.id))).toEqual(['view', 'gf-1', 'gf-2']);
    expect(combined.toJSON()).toEqual([viewNode, ...extra]);

    const visited: string[] = [];

    combined.forEach((filter, index) => visited.push(`${index}:${filter.get(YjsDatabaseKey.id)}`));
    expect(visited).toEqual(['0:view', '1:gf-1', '2:gf-2']);
    expect(combined.map((filter) => filter.get(YjsDatabaseKey.field_id))).toEqual([TITLE, STATUS, TITLE]);
    expect(combined.slice(1).map((filter) => filter.get(YjsDatabaseKey.id))).toEqual(['gf-1', 'gf-2']);
    expect(combined.slice(0, 1)).toEqual([viewFilter]);

    // The view's own array is not mutated.
    expect((viewFilters as unknown as Y.Array<unknown>).length).toBe(1);
  });

  it('reads the live view filters, so edits after combining are visible', () => {
    // useRowOrdersSelector memoises the combined list on the Y.Array identity,
    // which does not change when a filter is pushed or deleted in place.
    const { viewFilters } = createFixture();
    const combined = combineFilters(viewFilters, [plainNode('gf', STATUS, 'done')]) as YDatabaseFilters;

    pushViewFilter(viewFilters, plainNode('view', TITLE, 'task'));
    expect(combined.length).toBe(2);
    expect(combined.toArray().map((filter) => filter.get(YjsDatabaseKey.id))).toEqual(['view', 'gf']);
    expect(combined.toJSON()).toEqual([plainNode('view', TITLE, 'task'), plainNode('gf', STATUS, 'done')]);

    (viewFilters as unknown as Y.Array<unknown>).delete(0, 1);
    expect(combined.length).toBe(1);
    expect(combined.get(0).get(YjsDatabaseKey.id)).toBe('gf');
  });

  it('forwards observers to the view filters', () => {
    const { viewFilters } = createFixture();
    const combined = combineFilters(viewFilters, [plainNode('gf', STATUS, 'done')]) as YDatabaseFilters;
    const observer = jest.fn();

    combined.observeDeep(observer);
    pushViewFilter(viewFilters, plainNode('view', TITLE, 'task'));
    expect(observer).toHaveBeenCalled();

    const calls = observer.mock.calls.length;

    combined.unobserveDeep(observer);
    (viewFilters as unknown as Y.Array<unknown>).delete(0, 1);
    expect(observer).toHaveBeenCalledTimes(calls);
  });

  it('can be observed without view filters', () => {
    const combined = combineFilters(undefined, [plainNode('gf', STATUS, 'done')]) as YDatabaseFilters;
    const observer = jest.fn();

    expect(() => combined.observeDeep(observer)).not.toThrow();
    expect(() => combined.unobserveDeep(observer)).not.toThrow();
  });

  it('keeps reading the injected nodes as plain values', () => {
    const node = plainNode('gf', STATUS, 'done');
    const combined = combineFilters(undefined, [node]) as YDatabaseFilters;

    node.content = 'todo';
    expect(combined.get(0).get(YjsDatabaseKey.content)).toBe('todo');
  });
});

describe('createVirtualFilters', () => {
  it('wraps plain nodes in the Y.Array surface the evaluators use', () => {
    const nodes = [plainNode('a', TITLE, 'task'), plainNode('b', STATUS, 'done')];
    const virtual = createVirtualFilters(nodes);

    expect(virtual.length).toBe(2);
    expect(virtual.get(0).get(YjsDatabaseKey.id)).toBe('a');
    expect(virtual.get(1).get(YjsDatabaseKey.condition)).toBe(TextFilterCondition.TextContains);
    expect(virtual.toArray().map((filter) => filter.get(YjsDatabaseKey.field_id))).toEqual([TITLE, STATUS]);
    expect(virtual.toJSON()).toEqual(nodes);
    expect(virtual.toJSON()[0]).not.toBe(nodes[0]);
    expect(virtual.map((filter, index) => `${index}${filter.get(YjsDatabaseKey.id)}`)).toEqual(['0a', '1b']);
    expect(virtual.slice(1)).toHaveLength(1);

    const seen: number[] = [];

    virtual.forEach((_filter, index) => seen.push(index));
    expect(seen).toEqual([0, 1]);
  });

  it('accepts observers as a no-op', () => {
    const virtual = createVirtualFilters([plainNode('a', TITLE, 'task')]);
    const observer = jest.fn();

    expect(() => virtual.observeDeep(observer)).not.toThrow();
    expect(() => virtual.unobserveDeep(observer)).not.toThrow();
    expect(observer).not.toHaveBeenCalled();
  });

  it('is empty for no nodes', () => {
    const virtual = createVirtualFilters([]);

    expect(virtual.length).toBe(0);
    expect(virtual.toArray()).toEqual([]);
    expect(virtual.toJSON()).toEqual([]);
  });
});

describe('evaluating virtual filters', () => {
  it('filterBy applies plain nodes like persisted filters', () => {
    const { fields, rowMetas, rows } = createFixture();

    expect(ids(filterBy(rows, createVirtualFilters([plainNode('gf', STATUS, 'done')]), fields, rowMetas))).toEqual([
      'row-a',
      'row-c',
    ]);
    expect(
      ids(
        filterBy(
          rows,
          createVirtualFilters([plainNode('gf', STATUS, 'done', TextFilterCondition.TextIs)]),
          fields,
          rowMetas
        )
      )
    ).toEqual(['row-a', 'row-c']);
  });

  it('filterBy ANDs the view filters with the injected nodes', () => {
    const { fields, rowMetas, rows, viewFilters } = createFixture();

    pushViewFilter(viewFilters, plainNode('view', TITLE, 'task'));
    expect(ids(filterBy(rows, viewFilters, fields, rowMetas))).toEqual(['row-a', 'row-b']);

    const combined = combineFilters(viewFilters, [plainNode('gf', STATUS, 'done')]) as YDatabaseFilters;

    expect(ids(filterBy(rows, combined, fields, rowMetas))).toEqual(['row-a']);

    const none = combineFilters(viewFilters, [plainNode('gf', STATUS, 'archived')]) as YDatabaseFilters;

    expect(filterBy(rows, none, fields, rowMetas)).toEqual([]);
  });

  it('filterBy ignores injected nodes for unknown fields or without content', () => {
    const { fields, rowMetas, rows } = createFixture();
    const virtual = createVirtualFilters([plainNode('missing', 'no-such-field', 'x'), plainNode('blank', STATUS, '')]);

    expect(ids(filterBy(rows, virtual, fields, rowMetas))).toEqual(['row-a', 'row-b', 'row-c']);
  });

  it('reports effective filters across view and injected nodes', () => {
    const { fields, viewFilters } = createFixture();

    expect(hasEffectiveFilters(viewFilters, fields)).toBe(false);
    expect(hasEffectiveFilters(combineFilters(viewFilters, [plainNode('blank', STATUS, '')]), fields)).toBe(false);

    const withExtra = combineFilters(viewFilters, [plainNode('gf', STATUS, 'done')]);

    expect(hasEffectiveFilters(withExtra, fields)).toBe(true);
    expect(getEffectiveFiltersSnapshot(withExtra, fields)).toEqual([
      expect.objectContaining({
        filterType: FilterType.Data,
        fieldId: STATUS,
        fieldType: FieldType.RichText,
        condition: TextFilterCondition.TextContains,
        content: 'done',
      }),
    ]);

    pushViewFilter(viewFilters, plainNode('view-blank', TITLE, ''));
    pushViewFilter(viewFilters, plainNode('view', TITLE, 'task'));

    const combined = combineFilters(viewFilters, [
      plainNode('gf', STATUS, 'done'),
      plainNode('gf-empty', STATUS, '', TextFilterCondition.TextIsEmpty),
    ]);
    const snapshot = getEffectiveFiltersSnapshot(combined, fields);

    expect(snapshot.map((entry) => [entry.fieldId, entry.content, entry.condition])).toEqual([
      [TITLE, 'task', TextFilterCondition.TextContains],
      [STATUS, 'done', TextFilterCondition.TextContains],
      [STATUS, '', TextFilterCondition.TextIsEmpty],
    ]);
  });

  it('changes the effective snapshot when the injected content changes', () => {
    const { fields, viewFilters } = createFixture();
    const first = getEffectiveFiltersSnapshot(combineFilters(viewFilters, [plainNode('gf', STATUS, 'done')]), fields);
    const second = getEffectiveFiltersSnapshot(combineFilters(viewFilters, [plainNode('gf', STATUS, 'todo')]), fields);

    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
  });
});

describe('type-checked injected filters', () => {
  it('leaves out injected nodes whose field has another type, reading the type live', () => {
    const { fields, rowMetas, rows, viewFilters } = createFixture();
    const node = plainNode('gf', STATUS, 'done');
    const combined = combineFilters(viewFilters, [node], fields) as YDatabaseFilters;

    expect(combined.length).toBe(1);
    expect(ids(filterBy(rows, combined, fields, rowMetas))).toEqual(['row-a', 'row-c']);

    fields.get(STATUS).set(YjsDatabaseKey.type, FieldType.Number);
    expect(combined.length).toBe(0);
    expect(combined.toArray()).toEqual([]);
    expect(combined.get(0)).toBeUndefined();
    expect(combined.toJSON()).toEqual([]);
    expect(hasEffectiveFilters(combined, fields)).toBe(false);
    expect(ids(filterBy(rows, combined, fields, rowMetas))).toEqual(['row-a', 'row-b', 'row-c']);

    fields.get(STATUS).set(YjsDatabaseKey.type, FieldType.RichText);
    expect(combined.length).toBe(1);
    expect(combined.toJSON()).toEqual([node]);
  });

  it('keeps nodes for unknown fields and nodes without a type', () => {
    const { fields, viewFilters } = createFixture();
    const untyped = { id: 'untyped', filter_type: FilterType.Data, field_id: STATUS, condition: 2, content: 'x' };
    const combined = combineFilters(viewFilters, [plainNode('missing', 'no-such-field', 'x'), untyped], fields);

    expect(combined?.length).toBe(2);
  });
});

describe('date filters without a date', () => {
  const DUE = 'due-field';

  function createDateFixture() {
    const doc = new Y.Doc();
    const fields = doc.getMap('fields') as YDatabaseFields;
    const field = new Y.Map() as YDatabaseField;

    fields.set(DUE, field);
    field.set(YjsDatabaseKey.id, DUE);
    field.set(YjsDatabaseKey.type, FieldType.DateTime);

    const rowMetas: Record<string, YDoc> = {
      'row-dated': createRowDoc('row-dated', DATABASE_ID, { [DUE]: createCell(FieldType.DateTime, '1700000000') }),
      'row-undated': createRowDoc('row-undated', DATABASE_ID, { [TITLE]: createCell(FieldType.RichText, 'x') }),
    };
    const rows: Row[] = ['row-dated', 'row-undated'].map((id) => ({ id, height: 36 }));

    return { fields, rowMetas, rows };
  }

  function dateNode(id: string, condition: number, content: string) {
    return { id, filter_type: FilterType.Data, field_id: DUE, ty: FieldType.DateTime, condition, content };
  }

  // A cleared date picker used to store `null`, and `null.toString()` threw
  // inside the row selector for every widget the filter reached.
  it.each([
    ['a cleared single date', DateFilterCondition.DateStartsOn, JSON.stringify({ timestamp: null })],
    ['a cleared end date', DateFilterCondition.DateEndsBefore, JSON.stringify({ timestamp: null })],
    ['a cleared range', DateFilterCondition.DateStartsBetween, JSON.stringify({ start: null })],
    ['half a range', DateFilterCondition.DateStartsBetween, JSON.stringify({ start: 1700000000 })],
  ])('ignores %s without throwing', (_label, condition, content) => {
    const { fields, rowMetas, rows } = createDateFixture();
    const virtual = createVirtualFilters([dateNode('gf', condition, content)]);

    expect(() => filterBy(rows, virtual, fields, rowMetas)).not.toThrow();
    expect(ids(filterBy(rows, virtual, fields, rowMetas))).toEqual(['row-dated', 'row-undated']);
    expect(hasEffectiveFilters(virtual, fields)).toBe(false);
  });

  it('still applies a complete date and falls back to today for malformed content', () => {
    const { fields, rowMetas, rows } = createDateFixture();
    const onDay = createVirtualFilters([
      dateNode('gf', DateFilterCondition.DateStartsOn, JSON.stringify({ timestamp: 1700000000 })),
    ]);
    const malformed = createVirtualFilters([dateNode('gf', DateFilterCondition.DateStartsOn, 'not json')]);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(ids(filterBy(rows, onDay, fields, rowMetas))).toEqual(['row-dated']);
      expect(hasEffectiveFilters(malformed, fields)).toBe(true);
      expect(ids(filterBy(rows, malformed, fields, rowMetas))).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
