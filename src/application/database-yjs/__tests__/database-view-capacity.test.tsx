import * as Y from 'yjs';

import { createDatabaseViewInDoc, duplicateDatabaseViewInDoc } from '@/application/database-yjs/database-view-doc-ops';
import { DatabaseViewLayout, YDatabase, YDatabaseView, YDatabaseViews, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';

const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');

function setLimit(limit?: number) {
  updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, max_dashboard_widgets: limit } });
}

function fixture(count: number) {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map() as YDatabaseViews;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, 'database');
  database.set(YjsDatabaseKey.views, views);
  for (let i = 0; i < count; i += 1) {
    const view = new Y.Map() as YDatabaseView;

    view.set(YjsDatabaseKey.id, `view-${i}`);
    view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
    views.set(`view-${i}`, view);
  }

  const createDatabaseView = jest.fn().mockResolvedValue({ view_id: 'new-view', database_id: 'database' });
  const deps = { databaseDoc: doc, databasePageId: 'view-0', createDatabaseView };

  return { doc, database, views, createDatabaseView, deps };
}

beforeEach(() => setLimit());
afterEach(() => setLimit());

describe('legacy dashboard presentation hint', () => {
  it.each([undefined, 0, 2, 6])('does not restrict creating a seventh view when the hint is %s', async (hint) => {
    setLimit(hint);
    const { deps, createDatabaseView } = fixture(6);

    await expect(createDatabaseViewInDoc(deps, DatabaseViewLayout.Grid)).resolves.toBe('new-view');
    expect(createDatabaseView).toHaveBeenCalledTimes(1);
  });

  it('leaves duplicate admission to the server above the legacy hint', async () => {
    setLimit(2);
    const { doc, deps, createDatabaseView } = fixture(8);
    const before = Y.encodeStateAsUpdate(doc);
    const serverError = { code: 1090, message: 'Server refused creation' };
    const deletePage = jest.fn();

    createDatabaseView.mockRejectedValueOnce(serverError);
    await expect(duplicateDatabaseViewInDoc({ ...deps, deletePage }, 'view-0')).rejects.toBe(serverError);
    expect(createDatabaseView).toHaveBeenCalledTimes(1);
    expect(deletePage).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('does not turn a concurrent presentation-hint change into a creation failure', async () => {
    const { deps, views, createDatabaseView } = fixture(5);
    let finishMetadata!: (value: null) => void;
    const loadViewMeta = jest.fn(() => new Promise<null>((resolve) => { finishMetadata = resolve; }));
    const operation = createDatabaseViewInDoc({ ...deps, loadViewMeta }, DatabaseViewLayout.Grid);

    expect(loadViewMeta).toHaveBeenCalledTimes(1);
    views.set('arrived', new Y.Map() as YDatabaseView);
    setLimit(0);
    finishMetadata(null);
    await expect(operation).resolves.toBe('new-view');
    expect(createDatabaseView).toHaveBeenCalledTimes(1);
  });
});
