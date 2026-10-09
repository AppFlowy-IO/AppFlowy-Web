import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType, FieldVisibility } from '@/application/database-yjs';
import { createField, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { createRowOrdersStore } from '@/application/database-yjs/row-orders-store';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseFieldOrders,
  YDatabaseFields,
  YDatabaseRowOrders,
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

import { Gallery } from '../Gallery';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@atlaskit/pragmatic-drag-and-drop/reorder', () => ({ reorder: jest.fn() }));
jest.mock('@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index', () => ({
  getReorderDestinationIndex: jest.fn(),
}));
jest.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable: jest.fn(),
  dropTargetForElements: jest.fn(),
}));
jest.mock('@/components/database/components/cell/Cell', () => ({ Cell: () => <span>Post</span> }));
jest.mock('@/components/database/list/ListCell', () => ({ ListCell: () => <span>Author</span> }));
jest.mock('../GalleryNewRow', () => () => null);
jest.mock('../GalleryCardToolbar', () => () => null);
jest.mock('../GalleryPreview', () => () => <div data-testid='mounted-preview' />);
jest.mock('@/components/database/components/cell/person/useMentionableUsers', () => {
  const users = [{ uid: '42', person_id: 'alice', name: 'Alice', email: 'alice@example.com', avatar_url: null }];

  return { useMentionableUsersWithAutoFetch: () => ({ users }) };
});

function Search() {
  const { setQuery } = useDatabaseSearch();

  return <input aria-label='Search Gallery' onChange={(event) => setQuery(event.target.value)} />;
}

function fixture(fieldType: FieldType) {
  const databaseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const fieldOrders = new Y.Array() as YDatabaseFieldOrders;
  const rowOrders = new Y.Array() as YDatabaseRowOrders;
  const actorKey = fieldType === FieldType.CreatedBy ? YjsDatabaseKey.created_by : YjsDatabaseKey.last_edited_by;

  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  fields.set('title', createField('title', FieldType.RichText).clone());
  fields.get('title').set(YjsDatabaseKey.is_primary, true);
  fields.set('author', createField('author', fieldType).clone());
  views.set('gallery', view);
  view.set(YjsDatabaseKey.id, 'gallery');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Gallery);
  fieldOrders.push([{ id: 'title' }, { id: 'author' }]);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  const settings = new Y.Map();

  for (const id of fields.keys()) {
    const setting = new Y.Map();

    setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
    settings.set(id, setting);
  }

  view.set(YjsDatabaseKey.field_settings, settings as never);
  const rows = ['matching', 'other'].map((id) => ({ id, height: 36 }));
  const rowMap = Object.fromEntries(
    rows.map(({ id }) => {
      const doc = createRowDoc(id, 'database', { title: { fieldType: FieldType.RichText, data: 'Post' } });

      doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)!.set(actorKey, id === 'matching' ? '42' : '13');
      return [id, doc];
    })
  );

  rowOrders.push(rows);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  const store = createRowOrdersStore();
  const context: DatabaseContextState = {
    databaseDoc,
    activeViewId: 'gallery',
    databasePageId: 'database',
    workspaceId: '',
    rowMap,
    rowOrdersStore: store,
    ensureRow: jest.fn(async (rowId: string) => rowMap[rowId]),
    readOnly: true,
  };
  const rendered = render(
    <DatabaseContext.Provider value={context}>
      <DatabaseSearchProvider activeViewId='gallery'>
        <Search />
        <Gallery />
      </DatabaseSearchProvider>
    </DatabaseContext.Provider>
  );

  return { ...rendered, actorKey, databaseDoc, rowMap, source: store.get(databaseDoc, 'gallery') };
}

it.each([FieldType.CreatedBy, FieldType.LastEditedBy])(
  'keeps visible cards and peek navigation in sync for attribution field type %s, including live edits',
  async (fieldType) => {
    const { actorKey, databaseDoc, rowMap, source, unmount } = fixture(fieldType);
    const visibleRowIds = () =>
      screen.queryAllByTestId(/^gallery-tile-/).filter((tile) => !tile.hidden).map((tile) => tile.dataset.rowId);
    const expectMatchingRows = async (ids: string[]) => {
      await waitFor(() => expect(visibleRowIds()).toEqual(ids));
      expect(source.getSnapshot()?.rows?.map(({ id }) => id)).toEqual(ids);
    };

    await expectMatchingRows(['matching', 'other']);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'alice' } });
    await expectMatchingRows(['matching']);
    expect(screen.queryAllByTestId('mounted-preview')).toHaveLength(1);

    act(() => {
      rowMap.matching.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)!.set(actorKey, '13');
      rowMap.other.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row)!.set(actorKey, '42');
    });
    await expectMatchingRows(['other']);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } });
    await expectMatchingRows([]);
    expect(screen.queryAllByTestId('mounted-preview')).toHaveLength(0);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    await expectMatchingRows(['matching', 'other']);
    expect(screen.queryAllByTestId('mounted-preview')).toHaveLength(2);

    unmount();
    [databaseDoc, ...Object.values(rowMap)].forEach((doc) => doc.destroy());
  }
);
