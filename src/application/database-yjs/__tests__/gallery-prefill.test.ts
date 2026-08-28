import * as Y from 'yjs';

import { collectNewRowPrefillFilters } from '@/application/database-yjs/dispatch/row';
import { FilterType } from '@/application/database-yjs/database.type';
import { YDatabaseFilter, YDatabaseFilters, YjsDatabaseKey } from '@/application/types';

function leaf(id: string): YDatabaseFilter {
  const filter = new Y.Map() as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, id);
  filter.set(YjsDatabaseKey.field_id, `${id}-field`);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  return filter;
}

function group(id: string, type: FilterType.And | FilterType.Or, children: YDatabaseFilter[]): YDatabaseFilter {
  const filter = new Y.Map() as YDatabaseFilter;
  const childArray = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;

  childArray.push(children);
  filter.set(YjsDatabaseKey.id, id);
  filter.set(YjsDatabaseKey.filter_type, type);
  filter.set(YjsDatabaseKey.children, childArray);
  return filter;
}

describe('Gallery advanced-filter new-row prefill', () => {
  it('collects every AND branch but only the first OR branch in persisted order', () => {
    const filters = new Y.Doc().getArray<YDatabaseFilter>('filters') as YDatabaseFilters;
    const relation = leaf('relation');
    const select = leaf('select');
    const date = leaf('date');

    filters.push([group('root', FilterType.And, [relation, group('nested', FilterType.Or, [select, date])])]);

    expect(collectNewRowPrefillFilters(filters).map((filter) => filter.get(YjsDatabaseKey.id))).toEqual([
      'relation',
      'select',
    ]);
  });

  it('recurses through the first OR branch when that branch is an AND group', () => {
    const filters = new Y.Doc().getArray<YDatabaseFilter>('filters') as YDatabaseFilters;
    const first = leaf('first');
    const second = leaf('second');
    const ignored = leaf('ignored');

    filters.push([group('root', FilterType.Or, [group('first-branch', FilterType.And, [first, second]), ignored])]);

    expect(collectNewRowPrefillFilters(filters).map((filter) => filter.get(YjsDatabaseKey.id))).toEqual([
      'first',
      'second',
    ]);
  });

  it('supports plain-object roots and nested children synced by Desktop', () => {
    const filters = new Y.Doc().getArray<YDatabaseFilter>('filters') as YDatabaseFilters;
    const plainRoot = {
      [YjsDatabaseKey.id]: 'root',
      [YjsDatabaseKey.filter_type]: FilterType.And,
      [YjsDatabaseKey.children]: [
        {
          [YjsDatabaseKey.id]: 'plain-leaf',
          [YjsDatabaseKey.field_id]: 'plain-field',
          [YjsDatabaseKey.filter_type]: FilterType.Data,
        },
        {
          [YjsDatabaseKey.id]: 'plain-or',
          [YjsDatabaseKey.filter_type]: FilterType.Or,
          [YjsDatabaseKey.children]: [
            {
              [YjsDatabaseKey.id]: 'first-or-leaf',
              [YjsDatabaseKey.field_id]: 'first-or-field',
              [YjsDatabaseKey.filter_type]: FilterType.Data,
            },
            {
              [YjsDatabaseKey.id]: 'ignored-or-leaf',
              [YjsDatabaseKey.field_id]: 'ignored-or-field',
              [YjsDatabaseKey.filter_type]: FilterType.Data,
            },
          ],
        },
      ],
    } as unknown as YDatabaseFilter;

    filters.push([plainRoot]);

    expect(collectNewRowPrefillFilters(filters).map((filter) => filter.get(YjsDatabaseKey.id))).toEqual([
      'plain-leaf',
      'first-or-leaf',
    ]);
  });

  it('keeps ordinary filters and handles absent filters', () => {
    const filters = new Y.Doc().getArray<YDatabaseFilter>('filters') as YDatabaseFilters;
    const first = leaf('first');
    const second = leaf('second');

    filters.push([first, second]);
    expect(collectNewRowPrefillFilters(filters)).toEqual([first, second]);
    expect(collectNewRowPrefillFilters(undefined)).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['missing', undefined],
    ['null', null],
    ['non-numeric', 'not-a-filter-type'],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('treats a %s filter type as a legacy data leaf', (_description, persistedType) => {
    const filters = new Y.Doc().getArray<YDatabaseFilter>('filters') as YDatabaseFilters;
    const filter = new Y.Map() as YDatabaseFilter;

    filter.set(YjsDatabaseKey.id, 'legacy-leaf');
    filter.set(YjsDatabaseKey.field_id, 'legacy-field');
    if (persistedType !== undefined) filter.set(YjsDatabaseKey.filter_type, persistedType);
    filters.push([filter]);

    expect(collectNewRowPrefillFilters(filters)).toEqual([filter]);
  });
});
