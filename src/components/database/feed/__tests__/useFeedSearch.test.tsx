import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import * as decode from '@/application/database-yjs/decode';
import { createField, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { MentionablePerson, YDatabase, YDatabaseFields, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { useFeedSearch } from '../useFeedSearch';

let mockUsers: MentionablePerson[] = [];

jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => ({
  useMentionableUsersWithAutoFetch: () => ({ users: mockUsers }),
}));

beforeEach(() => {
  mockUsers = [];
});

function fixture(count = 1, history = false) {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;

  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.fields, fields);
  fields.set('title', createField('title', FieldType.RichText).clone());
  const rows = Array.from({ length: count }, (_, index) => ({ id: String(index), height: 36 }));
  const docs = Object.fromEntries(
    rows.map(({ id }) => [id, createRowDoc(id, 'db', { title: { fieldType: FieldType.RichText, data: 'Post' } })])
  );
  const context = {
    databaseDoc,
    activeViewId: 'active-view',
    databasePageId: 'page',
    rowMap: docs,
    workspaceId: '',
    readOnly: true,
    dataSource: history ? { type: 'history', id: 'history' } : undefined,
  } as DatabaseContextState;
  const columns = [{ fieldId: 'title', isPrimary: true }] as never;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );
  const hook = renderHook(
    ({ query }) => useFeedSearch({ rows, fields: columns, primaryFieldId: 'title', cachedRowDocs: docs, query }),
    { wrapper, initialProps: { query: 'p' } }
  );

  return { ...hook, database, fields, rows, docs, context, databaseDoc };
}

it.each([false, true])('reuses unchanged row text across query-only changes (history=%s)', (history) => {
  const decodeCell = jest.spyOn(decode, 'decodeCellToText');
  const { result, rerender, unmount } = fixture(1_000, history);

  expect(result.current).toHaveLength(1_000);
  decodeCell.mockClear();
  rerender({ query: 'po' });
  expect(result.current).toHaveLength(1_000);
  expect(decodeCell).not.toHaveBeenCalled();
  rerender({ query: 'missing' });
  expect(result.current).toHaveLength(0);
  expect(decodeCell).not.toHaveBeenCalled();
  rerender({ query: '' });
  expect(result.current).toHaveLength(1_000);
  rerender({ query: 'post' });
  expect(result.current).toHaveLength(1_000);
  expect(decodeCell).toHaveBeenCalled();
  unmount();
  decodeCell.mockRestore();
});

it('keeps active results fresh after a row edit and an in-place option rename', async () => {
  const { result, rerender, fields, docs } = fixture();

  rerender({ query: 'changed' });
  expect(result.current).toHaveLength(0);
  act(() => {
    docs['0']
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row)!
      .get(YjsDatabaseKey.cells)
      .get('title')!
      .set(YjsDatabaseKey.data, 'Changed');
  });
  await waitFor(() => expect(result.current).toHaveLength(1));

  act(() => {
    fields.set(
      'title',
      createField('title', FieldType.SingleSelect, { options: [{ id: 'Changed', name: 'Before' }] }).clone()
    );
    docs['0']
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row)!
      .get(YjsDatabaseKey.cells)
      .get('title')!
      .set(YjsDatabaseKey.field_type, FieldType.SingleSelect);
  });
  rerender({ query: 'after' });
  expect(result.current).toHaveLength(0);
  act(() => {
    fields
      .get('title')
      .get(YjsDatabaseKey.type_option)
      .get(String(FieldType.SingleSelect))
      .set(YjsDatabaseKey.content, JSON.stringify({ options: [{ id: 'Changed', name: 'After' }] }));
  });
  await waitFor(() => expect(result.current).toHaveLength(1));
});

it('refreshes member labels when the shared member snapshot changes', () => {
  const { result, rerender, fields, docs } = fixture();

  act(() => {
    fields.get('title').set(YjsDatabaseKey.type, FieldType.CreatedBy);
    docs['0'].getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)!.set(YjsDatabaseKey.created_by, '42');
  });
  rerender({ query: 'alice' });
  expect(result.current).toHaveLength(0);
  mockUsers = [{ uid: '42', person_id: 'alice', name: 'Alice', email: 'alice@example.test', avatar_url: null }];
  rerender({ query: 'alice' });
  expect(result.current).toHaveLength(1);
});

it('rebuilds after the fields map is replaced without changing the query or columns', () => {
  const { result, database } = fixture();
  const replacement = new Y.Map() as YDatabaseFields;

  expect(result.current).toHaveLength(1);
  replacement.set('title', createField('title', FieldType.Number).clone());
  act(() => {
    database.set(YjsDatabaseKey.fields, replacement);
  });
  expect(result.current).toHaveLength(0);
});
