import * as Y from 'yjs';

import {
  getSearchableFields,
  normalizeSearchQuery,
  rowMatchesSearch,
  SEARCH_RULES,
  searchRows,
} from '@/application/database-yjs/database-search';
import { FieldType, FieldVisibility } from '@/application/database-yjs/database.type';
import { RowId, YDatabaseField, YDatabaseFields, YDatabaseView, YDoc, YjsDatabaseKey } from '@/application/types';

import { loadParityFixture } from './dashboard-parity-helpers';
import { createCell, createField, createRowDoc } from './test-helpers';

jest.mock('@/application/database-yjs/fields/select-option/parse', () => {
  const actual = jest.requireActual<typeof import('@/application/database-yjs/fields/select-option/parse')>(
    '@/application/database-yjs/fields/select-option/parse'
  );

  return { ...actual, parseSelectOptionTypeOptions: jest.fn(actual.parseSelectOptionTypeOptions) };
});

const parseSelectOptionsMock = jest.requireMock('@/application/database-yjs/fields/select-option/parse')
  .parseSelectOptionTypeOptions as jest.Mock;

interface SearchFixtureField {
  id: string;
  name: string;
  type: number;
  primary?: boolean;
  visibility?: number;
  options?: [string, string][];
}

interface SearchFixture {
  fields: SearchFixtureField[];
  rows: Record<string, unknown>[];
  queries: { q: string; ids: string[] }[];
  known_divergences: { q: string; web: string[]; desktop: string[] }[];
}

const fixture = loadParityFixture<SearchFixture>('layouts/search.json');

function buildDatabase() {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as unknown as YDatabaseFields;
  const view = doc.getMap('view') as unknown as YDatabaseView;
  const fieldSettings = new Y.Map();

  view.set(YjsDatabaseKey.field_settings, fieldSettings as never);
  fixture.fields.forEach((spec) => {
    const typeOption = spec.options
      ? { options: spec.options.map(([id, name]) => ({ id, name, color: 'Purple' })), disable_color: false }
      : undefined;
    const field = createField(spec.id, spec.type as FieldType, typeOption);
    const copy = new Y.Map() as YDatabaseField;

    // A field must live in the fields map; copy the detached test field into it.
    fields.set(spec.id, copy);
    field.forEach((value, key) => {
      if (value instanceof Y.Map) {
        const nested = new Y.Map();

        copy.set(key as never, nested as never);
        value.forEach((inner: unknown, innerKey: string) => {
          if (inner instanceof Y.Map) {
            const leaf = new Y.Map();

            nested.set(innerKey, leaf);
            inner.forEach((leafValue: unknown, leafKey: string) => leaf.set(leafKey, leafValue));
          } else {
            nested.set(innerKey, inner);
          }
        });
      } else {
        copy.set(key as never, value as never);
      }
    });
    copy.set(YjsDatabaseKey.name, spec.name);
    if (spec.primary) copy.set(YjsDatabaseKey.is_primary, true);
    if (spec.visibility !== undefined) {
      const setting = new Y.Map();

      setting.set(YjsDatabaseKey.visibility, spec.visibility);
      fieldSettings.set(spec.id, setting);
    }
  });

  const rowDocs: Record<RowId, YDoc> = {};

  fixture.rows.forEach((row) => {
    const cells: Record<string, ReturnType<typeof createCell>> = {};

    fixture.fields.forEach((spec) => {
      const value = row[spec.id];

      if (value === undefined) return;
      const data = Array.isArray(value) ? value.join(',') : String(value);

      cells[spec.id] = createCell(spec.type as FieldType, data);
    });
    rowDocs[String(row.id)] = createRowDoc(String(row.id), 'search-db', cells);
  });

  return { fields, view, fieldSettings, rowDocs, rows: fixture.rows.map((row) => ({ id: String(row.id), height: 36 })) };
}

describe('database search (layouts/search.json)', () => {
  const db = buildDatabase();

  it.each(fixture.queries.map((query) => [JSON.stringify(query.q), query] as const))(
    'query %s returns exactly the fixture rows in row order',
    (_, { q, ids }) => {
      expect(searchRows(db.rows, q, db.fields, db.view, db.rowDocs).map((row) => row.id)).toEqual(ids);
    }
  );

  it.each(fixture.known_divergences.map((query) => [query.q, query] as const))(
    'keeps the web side of the known divergence %s',
    (_, { q, web }) => {
      expect(searchRows(db.rows, q, db.fields, db.view, db.rowDocs).map((row) => row.id)).toEqual(web);
    }
  );

  it('never searches a field the view always hides, but always searches the primary field', () => {
    const searchable = getSearchableFields(db.fields, db.view).map((field) => field.id);

    expect(searchable[0]).toBe('f_name');
    expect(searchable).not.toContain('f_hidden');
    expect(searchable).toEqual(expect.arrayContaining(['f_stage', 'f_tags', 'f_site', 'f_notes', 'f_amount']));
  });

  it('keeps the primary field searchable even when the view hides it', () => {
    const setting = new Y.Map();

    setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysHidden);
    db.fieldSettings.set('f_name', setting);
    try {
      expect(searchRows(db.rows, 'globex', db.fields, db.view, db.rowDocs).map((row) => row.id)).toEqual(['r2']);
    } finally {
      db.fieldSettings.delete('f_name');
    }
  });

  it('matches inside one field only, never across concatenated fields', () => {
    expect(searchRows(db.rows, 'corp globex', db.fields, db.view, db.rowDocs)).toEqual([]);
    expect(searchRows(db.rows, 'acme corp lead', db.fields, db.view, db.rowDocs)).toEqual([]);
  });

  it('reads a multi-select cell as its option names joined with a comma and a space', () => {
    expect(SEARCH_RULES.multiSelectSeparator).toBe(', ');
    expect(searchRows(db.rows, 'urgent, q3', db.fields, db.view, db.rowDocs).map((row) => row.id)).toEqual(['r4']);
  });

  it('normalizes the query by trimming and lower-casing it', () => {
    expect(normalizeSearchQuery('  ACME  ')).toBe('acme');
    expect(normalizeSearchQuery(undefined)).toBe('');
    expect(normalizeSearchQuery('   ')).toBe('');
  });

  it('does not match a row whose data is not read yet, and matches everything without a query', () => {
    const searchable = getSearchableFields(db.fields, db.view);

    expect(rowMatchesSearch('missing', undefined, searchable, 'acme')).toBe(false);
    expect(rowMatchesSearch('missing', undefined, searchable, '')).toBe(true);
  });

  it('parses the options of a select field once per search pass, not once per cell', () => {
    const selectFields = fixture.fields.filter((field) => field.options).length;

    expect(selectFields).toBeGreaterThan(0);
    expect(db.rows.length).toBeGreaterThan(1);
    parseSelectOptionsMock.mockClear();
    // A query no field matches reads every searchable cell of every row.
    expect(searchRows(db.rows, 'no such text anywhere', db.fields, db.view, db.rowDocs)).toEqual([]);
    expect(parseSelectOptionsMock).toHaveBeenCalledTimes(selectFields);

    // A later pass starts from fresh fields, so an edited type option is read again.
    parseSelectOptionsMock.mockClear();
    expect(searchRows(db.rows, 'urgent, q3', db.fields, db.view, db.rowDocs).map((row) => row.id)).toEqual(['r4']);
    expect(parseSelectOptionsMock).toHaveBeenCalled();
  });
});
