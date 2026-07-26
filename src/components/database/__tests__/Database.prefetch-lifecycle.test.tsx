import { act, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { peekDatabaseRowDocSeed, prefetchDatabaseBlobDiff } from '@/application/database-blob';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import Database, { Database2Props } from '@/components/database/Database';

jest.mock('@/application/database-blob', () => ({
  getDatabaseRowDocFromSeed: jest.fn(),
  peekDatabaseRowDocSeed: jest.fn(),
  prefetchDatabaseBlobDiff: jest.fn(),
  releaseDatabaseRowDocSeedCache: jest.fn(),
  retainDatabaseRowDocSeedCache: jest.fn(),
}));

jest.mock('@/components/database/DatabaseRow', () => ({
  DatabaseRow: () => null,
}));

jest.mock('@/components/database/DatabaseRowModal', () => () => null);
jest.mock('@/components/database/DatabaseViews', () => () => null);
jest.mock('@/components/database/DatabaseContext', () => ({
  DatabaseContextProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const mockedPrefetch = prefetchDatabaseBlobDiff as jest.MockedFunction<typeof prefetchDatabaseBlobDiff>;
const mockedPeekSeed = peekDatabaseRowDocSeed as jest.MockedFunction<typeof peekDatabaseRowDocSeed>;

function createDatabaseDoc(guid: string) {
  const doc = new Y.Doc({ guid }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const rowOrders = new Y.Array();

  rowOrders.push([{ id: 'row-id' }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set('view-id', view);
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function databaseProps(doc: YDoc): Database2Props {
  return {
    workspaceId: 'workspace-id',
    doc,
    readOnly: false,
    activeViewId: 'view-id',
    databaseName: '',
    databasePageId: '',
    onChangeView: jest.fn(),
  };
}

describe('Database blob prefetch lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrefetch.mockImplementation(() => new Promise(() => undefined));
  });

  it('starts a new prefetch when the Y.Doc instance changes but its guid stays the same', async () => {
    const firstDoc = createDatabaseDoc('database-id');
    const secondDoc = createDatabaseDoc('database-id');
    const { rerender, unmount } = render(<Database {...databaseProps(firstDoc)} />);

    await waitFor(() => {
      expect(mockedPrefetch).toHaveBeenCalledTimes(1);
    });

    rerender(<Database {...databaseProps(secondDoc)} />);

    await waitFor(() => {
      expect(mockedPrefetch).toHaveBeenCalledTimes(2);
    });

    act(() => {
      mockedPrefetch.mock.calls[0][2]?.onSeedsReady?.();
    });

    expect(mockedPeekSeed).not.toHaveBeenCalled();

    act(() => {
      mockedPrefetch.mock.calls[1][2]?.onSeedsReady?.();
    });

    expect(mockedPeekSeed).toHaveBeenCalledWith('database-id_rows_row-id');

    unmount();
    firstDoc.destroy();
    secondDoc.destroy();
  });
});
