import { act, renderHook } from '@testing-library/react';
import { v5 as uuidv5 } from 'uuid';
import * as Y from 'yjs';

import { assertDatabaseViewCapacity, getDatabaseViewCount } from '@/application/database-yjs/database-view-capacity';
import { createDatabaseViewInDoc, duplicateDatabaseViewInDoc } from '@/application/database-yjs/database-view-doc-ops';
import { DatabaseViewLayout, YDatabase, YDatabaseView, YDatabaseViews, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useDatabaseViewCapacity } from '@/components/database/hooks/useDatabaseViewCapacity';
import { getConfigValue } from '@/utils/runtime-config';
import { getMaxDatabaseViews, ServerInfoState, updateServerInfo } from '@/utils/server-info';

const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');

function setLimit(limit?: number) {
  updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, max_database_views: limit } });
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

describe('server database-view capacity', () => {
  it.each([undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'defaults absent or invalid unsigned limits (%s) to six',
    (limit) => {
      setLimit(limit);
      expect(getMaxDatabaseViews()).toBe(6);
    }
  );

  it.each<ServerInfoState['status']>(['loading', 'unavailable', 'unsupported'])('defaults %s info to six', (status) => {
    updateServerInfo(serverUrl, { status } as ServerInfoState);
    expect(getMaxDatabaseViews()).toBe(6);
  });

  it.each([0, 2, 9])('honors the advertised unsigned cap %s in both hosting modes', (limit) => {
    for (const self_hosted of [true, false]) {
      updateServerInfo(serverUrl, { status: 'available', info: { enable_page_history: true, self_hosted, max_database_views: limit } });
      expect(getMaxDatabaseViews()).toBe(limit);
    }
  });

  it('counts primary, embedded, and owned views even when no tab exposes them', () => {
    const { doc, views } = fixture(6);

    views.get('view-0').set(YjsDatabaseKey.is_inline, true);
    views.get('view-1').set(YjsDatabaseKey.embedded, true);
    views.get('view-2').set(YjsDatabaseKey.dashboard_owner, 'dashboard');
    expect(getDatabaseViewCount(doc)).toBe(6);
    expect(() => assertDatabaseViewCapacity(doc)).toThrow('limit of 6 views');
  });

  it('exempts only the canonical internal storage ID from six usable views', () => {
    const { doc, database, views } = fixture(6);
    const databaseId = '550e8400-e29b-41d4-a716-446655440000';
    const internalId = uuidv5('inline_view_id', databaseId);

    expect(internalId).toBe('d242f9fe-4942-5751-9e57-e9f33d055f2f');
    doc.object_id = databaseId;
    database.set(YjsDatabaseKey.id, databaseId);
    views.set(internalId, new Y.Map() as YDatabaseView);
    expect(views.size).toBe(7);
    expect(getDatabaseViewCount(doc)).toBe(6);
    expect(() => assertDatabaseViewCapacity(doc)).toThrow('limit of 6 views');
    views.delete('view-5');
    expect(getDatabaseViewCount(doc)).toBe(5);
    expect(() => assertDatabaseViewCapacity(doc)).not.toThrow();

    // A client-controlled database ID or inline flag cannot exempt a second view.
    database.set(YjsDatabaseKey.id, '6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    views.get('view-0').set(YjsDatabaseKey.is_inline, true);
    expect(getDatabaseViewCount(doc)).toBe(5);
    views.delete(internalId);
    expect(getDatabaseViewCount(doc)).toBe(5);
  });

  it.each([6, 8])('rejects creation at/above the default cap (%s) without a request or local write', async (count) => {
    const { doc, deps, createDatabaseView } = fixture(count);
    const before = Y.encodeStateAsUpdate(doc);

    await expect(createDatabaseViewInDoc(deps, DatabaseViewLayout.Grid)).rejects.toThrow('limit of 6 views');
    expect(createDatabaseView).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it('allows the sixth view and a custom higher limit', async () => {
    for (const [count, limit] of [[5, undefined], [7, 9]] as const) {
      setLimit(limit);
      const { deps, createDatabaseView } = fixture(count);

      await expect(createDatabaseViewInDoc(deps, DatabaseViewLayout.Grid)).resolves.toBe('new-view');
      expect(createDatabaseView).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects duplicate at capacity without copying, creating, or compensating an existing view', async () => {
    setLimit(2);
    const { doc, deps, createDatabaseView } = fixture(2);
    const before = Y.encodeStateAsUpdate(doc);
    const deletePage = jest.fn();

    await expect(duplicateDatabaseViewInDoc({ ...deps, deletePage }, 'view-0')).rejects.toThrow('limit of 2 views');
    expect(createDatabaseView).not.toHaveBeenCalled();
    expect(deletePage).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it.each(['another view', 'a smaller server cap'])('rechecks after metadata awaits when %s arrives', async (change) => {
    const { deps, views, createDatabaseView } = fixture(5);
    let finishMetadata!: (value: null) => void;
    const loadViewMeta = jest.fn(() => new Promise<null>((resolve) => { finishMetadata = resolve; }));
    const operation = createDatabaseViewInDoc({ ...deps, loadViewMeta }, DatabaseViewLayout.Grid);

    expect(loadViewMeta).toHaveBeenCalledTimes(1);
    if (change === 'another view') views.set('arrived', new Y.Map() as YDatabaseView);
    else setLimit(5);
    finishMetadata(null);
    await expect(operation).rejects.toThrow('views. Remove a view');
    expect(createDatabaseView).not.toHaveBeenCalled();
  });

  it('reacts to additions, removals, map replacement, and server-cap changes while allowing existing edits', () => {
    const { doc, database, views } = fixture(5);
    const { result, unmount } = renderHook(() => useDatabaseViewCapacity(doc));

    expect(result.current.disabledReason).toBeUndefined();
    act(() => { views.set('sixth', new Y.Map() as YDatabaseView); });
    expect(result.current.disabledReason).toContain('limit of 6 views');
    act(() => { views.get('view-0').set(YjsDatabaseKey.name, 'Still editable'); });
    expect(result.current.count).toBe(6);
    act(() => setLimit(8));
    expect(result.current.disabledReason).toBeUndefined();
    act(() => setLimit(6));
    act(() => views.delete('sixth'));
    expect(result.current.disabledReason).toBeUndefined();
    const replacement = new Y.Map() as YDatabaseViews;

    for (let i = 0; i < 8; i += 1) replacement.set(`replacement-${i}`, new Y.Map() as YDatabaseView);
    act(() => { database.set(YjsDatabaseKey.views, replacement); });
    expect(result.current.count).toBe(8);
    expect(result.current.disabledReason).toContain('limit of 6 views');
    unmount();
    doc.destroy();
  });
});
