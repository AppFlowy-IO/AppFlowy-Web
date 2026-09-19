import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { useDashboardViewOverlays } from '../hooks/useDashboardViewOverlays';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: (_key: string, fallback: string) => fallback }));

const W1 = { id: 'w1', databaseId: 'db', viewId: 'v1' };
const W2 = { id: 'w2', databaseId: 'db', viewId: 'v2' };
const ROWS: DashboardRow[] = [
  {
    id: 'r1',
    height: 360,
    widgets: [
      { ...W1, width: 6 },
      { ...W2, width: 6 },
    ],
  },
];

function createViews() {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map();
  const views = new Y.Map<YDatabaseView>();

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.views, views);
  for (const id of ['v1', 'v2', 'v3']) {
    const view = new Y.Map() as YDatabaseView;

    views.set(id, view);
    view.set(YjsDatabaseKey.filters, new Y.Array());
    view.set(YjsDatabaseKey.sorts, new Y.Array());
  }

  getOrCreateDatabaseHistoryManager(doc);
  return { doc, view: (id: string) => views.get(id) as YDatabaseView };
}

function addPrivateFilter(view: YDatabaseView | undefined, id: string) {
  act(() => {
    (view?.get(YjsDatabaseKey.filters) as Y.Array<unknown>).push([{ id, content: id }]);
  });
}

function render(rows = ROWS) {
  return renderHook(({ current }) => useDashboardViewOverlays('dashboard', current), {
    initialProps: { current: rows },
  });
}

describe('useDashboardViewOverlays', () => {
  it('creates an overlay on first use and returns the same one after', () => {
    const { view } = createViews();
    const { result } = render();
    const first = result.current.getViewOverlay(W1, view('v1'));

    expect(first).toBeDefined();
    expect(result.current.getViewOverlay(W1, view('v1'))).toBe(first);
    expect(result.current.unsaved).toBe(0);
  });

  it('keeps private conditions through a view that is briefly missing', () => {
    const { view } = createViews();
    const { result } = render();

    addPrivateFilter(result.current.getViewOverlay(W1, view('v1')), 'mine');
    expect(result.current.unsaved).toBe(1);
    expect(result.current.getViewOverlay(W1, undefined)).toBeUndefined();
    expect(result.current.unsaved).toBe(1);
    expect(result.current.getViewOverlay(W1, view('v1'))?.get(YjsDatabaseKey.filters).toJSON()).toEqual([
      { id: 'mine', content: 'mine' },
    ]);
  });

  it('releases a re-pointed widget once its new rows are committed, not while it renders', () => {
    const { view } = createViews();
    const { result, rerender } = render();

    addPrivateFilter(result.current.getViewOverlay(W1, view('v1')), 'mine');
    const repointed = { ...W1, viewId: 'v3' };

    // The widget renders against its new source first: nothing is released yet.
    expect(result.current.getViewOverlay(repointed, view('v3'))?.get(YjsDatabaseKey.filters).length).toBe(0);
    expect(result.current.unsaved).toBe(1);

    rerender({
      current: [
        {
          ...ROWS[0],
          widgets: [
            { ...repointed, width: 6 },
            { ...W2, width: 6 },
          ],
        },
      ],
    });
    expect(result.current.unsaved).toBe(0);
  });

  it('saves only the widgets whose source the viewer can write', () => {
    const { view } = createViews();
    const { result } = render();

    addPrivateFilter(result.current.getViewOverlay(W1, view('v1')), 'writable');
    addPrivateFilter(result.current.getViewOverlay(W2, view('v2')), 'read-only');
    // Unknown permissions fail closed.
    expect(result.current).toMatchObject({ unsaved: 2, savable: 0 });

    act(() => {
      result.current.setViewOverlayWritable(W1, true);
      result.current.setViewOverlayWritable(W2, false);
    });
    expect(result.current).toMatchObject({ unsaved: 2, savable: 1 });

    act(() => result.current.commitViewOverlays());
    expect(view('v1').get(YjsDatabaseKey.filters).toJSON()).toEqual([{ id: 'writable', content: 'writable' }]);
    expect(view('v2').get(YjsDatabaseKey.filters).toJSON()).toEqual([]);
    // The read-only widget keeps its private filter, which only Reset drops.
    expect(result.current).toMatchObject({ unsaved: 1, savable: 0 });

    act(() => result.current.resetViewOverlays());
    expect(result.current).toMatchObject({ unsaved: 0, savable: 0 });
  });
});
