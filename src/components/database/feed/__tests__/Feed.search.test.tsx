import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FieldVisibility,
  useRowMetaSelector,
} from '@/application/database-yjs';
import { createField, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import {
  DatabaseViewLayout,
  RowCoverType,
  YDatabase,
  YDatabaseFieldOrders,
  YDatabaseFields,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import {
  DatabaseSearchProvider,
  useDatabaseSearch,
} from '@/components/database/components/conditions/DatabaseSearchContext';
import { getImageUrl } from '@/utils/authenticated-image';

import { Feed } from '../Feed';
import { useFeedRowData } from '../useFeedRowOrders';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs'),
  useRowMetaSelector: jest.fn(),
}));
jest.mock('@/utils/authenticated-image', () => ({
  getImageUrl: jest.fn(() => new Promise(() => undefined)),
  revokeBlobUrl: jest.fn(),
}));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock('../FeedCardActions', () => ({ FeedCardActions: () => null }));
jest.mock('../FeedControls', () => ({
  FeedEmptyState: () => null,
  FeedLoadingIndicator: () => null,
  FeedLoadMore: () => null,
  FeedNewRow: () => null,
}));
jest.mock('../useFeedRowOrders', () => ({ useFeedRowData: jest.fn() }));
jest.mock('../FeedMembersContext', () => ({
  FeedMembersProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFeedMembers: () => ({
    resolveMember: () => undefined,
    canComment: true,
    currentCommentAuthorId: 'me',
    currentUser: { name: 'Me' },
    currentUid: null,
    mentionableUsers: [],
  }),
}));
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => {
  const users = [{ uid: '42', person_id: 'alice', name: 'Alice', email: 'alice@example.com', avatar_url: null }];

  return { useMentionableUsersWithAutoFetch: () => ({ users, usersByUid: new Map([['42', users[0]]]) }) };
});

function Search() {
  const { setQuery } = useDatabaseSearch();

  return (
    <>
      <button onClick={() => setQuery('missing')}>Search missing</button>
      <button onClick={() => setQuery('alice')}>Search Alice</button>
      <button onClick={() => setQuery('')}>Clear search</button>
    </>
  );
}

function fixture(count: number, showCreatedBy = false) {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const fieldOrders = new Y.Array() as YDatabaseFieldOrders;

  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  fields.set('title', createField('title', FieldType.RichText).clone());
  fields.get('title').set(YjsDatabaseKey.is_primary, true);
  if (showCreatedBy) fields.set('created-by', createField('created-by', FieldType.CreatedBy).clone());
  views.set('feed', view);
  view.set(YjsDatabaseKey.id, 'feed');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Feed);
  fieldOrders.push([...fields.keys()].map((id) => ({ id })));
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  const settings = new Y.Map();

  for (const id of fields.keys()) {
    const setting = new Y.Map();

    setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
    settings.set(id, setting);
  }

  view.set(YjsDatabaseKey.field_settings, settings as never);
  const rows = Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, height: 36 }));
  const rowMap = Object.fromEntries(
    rows.map(({ id }) => {
      const doc = createRowDoc(id, 'database', { title: { fieldType: FieldType.RichText, data: 'Post' } });

      doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)!.set(YjsDatabaseKey.created_by, '42');
      return [id, doc];
    })
  );
  const bindRowSync = jest.fn();
  const ensureRow = jest.fn();
  const context = {
    databaseDoc,
    activeViewId: 'feed',
    databasePageId: 'database',
    workspaceId: '',
    rowMap,
    bindRowSync,
    ensureRow,
    readOnly: false,
  } as unknown as DatabaseContextState;

  (useFeedRowData as jest.Mock).mockReturnValue({ rowOrders: rows, cachedRowDocs: {} });
  (useRowMetaSelector as jest.Mock).mockImplementation((rowId: string) => ({
    cover: showCreatedBy
      ? null
      : {
          cover_type: RowCoverType.FileCover,
          data: `https://example.test/api/file_storage/workspace/blob/${rowId}.png`,
        },
    isEmptyDocument: true,
    documentId: '',
    icon: '',
  }));
  const rendered = render(
    <DatabaseContext.Provider value={context}>
      <DatabaseSearchProvider activeViewId='feed'>
        <Search />
        <Feed />
      </DatabaseSearchProvider>
    </DatabaseContext.Provider>
  );

  return { ...rendered, bindRowSync, ensureRow };
}

beforeEach(() => jest.clearAllMocks());

it('does not hydrate hidden card covers, composers and sync on a no-results search', () => {
  const { bindRowSync } = fixture(1000);

  expect(getImageUrl).toHaveBeenCalledTimes(20);
  expect(bindRowSync).toHaveBeenCalledTimes(20);
  expect(screen.getAllByTestId(/^feed-add-comment-collapsed-/)).toHaveLength(20);
  fireEvent.click(screen.getByText('Search missing'));
  expect(bindRowSync).toHaveBeenCalledTimes(20);
  expect(screen.queryAllByTestId(/^feed-add-comment-collapsed-/)).toHaveLength(0);
  expect(document.querySelectorAll('article')).toHaveLength(0);
  expect(getImageUrl).toHaveBeenCalledTimes(20);
});

it('finds the visible CreatedBy property label', async () => {
  fixture(1, true);
  expect(screen.getByTestId('attribution-cell-row-0-created-by').textContent).toContain('Alice');
  fireEvent.click(screen.getByText('Search Alice'));
  await act(async () => undefined);
  expect(screen.getByTestId('attribution-cell-row-0-created-by').textContent).toContain('Alice');
  expect(screen.getByTestId('feed-card-row-0').hidden).toBe(false);
});

it('preserves only active drafts while repeated searches release other cards', async () => {
  fixture(35);
  fireEvent.click(screen.getByTestId('feed-add-comment-collapsed-row-0'));
  fireEvent.change(screen.getByTestId('feed-add-comment-input-row-0'), { target: { value: 'Keep this draft' } });
  fireEvent.click(screen.getByText('Search missing'));
  expect(screen.getByTestId('feed-card-row-0').hidden).toBe(true);
  expect(document.querySelectorAll('article')).toHaveLength(1);
  fireEvent.click(screen.getByText('Clear search'));
  await waitFor(() => expect(screen.getByTestId('feed-card-row-0').hidden).toBe(false));
  expect((screen.getByTestId('feed-add-comment-input-row-0')).value).toBe('Keep this draft');
  fireEvent.click(screen.getByText('Search Alice'));
  expect(document.querySelectorAll('article')).toHaveLength(1);
});
