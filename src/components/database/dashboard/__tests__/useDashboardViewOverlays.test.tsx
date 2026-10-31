import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { PrivateWidgetEntry } from '@/application/database-yjs/dashboard-private';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { useDashboardViewOverlays } from '../hooks/useDashboardViewOverlays';

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
  const fields = new Y.Map<Y.Map<unknown>>();

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.fields, fields);
  for (const [id, type] of [
    ['stage', FieldType.SingleSelect],
    ['points', FieldType.Number],
  ] as const) {
    const field = new Y.Map<unknown>();

    field.set(YjsDatabaseKey.type, type);
    fields.set(id, field);
  }

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

function addPrivateSort(view: YDatabaseView | undefined, id: string) {
  act(() => {
    (view?.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push([{ id, field_id: 'points', condition: 1 }]);
  });
}

function render(rows = ROWS, initialWidgets?: Record<string, PrivateWidgetEntry>) {
  return renderHook(({ current }) => useDashboardViewOverlays('dashboard', current, initialWidgets), {
    initialProps: { current: rows },
  });
}

const STAGE_FILTER = {
  id: 'f1',
  filter_type: FilterType.Data,
  field_id: 'stage',
  ty: FieldType.SingleSelect,
  condition: 0,
  content: 'o-done',
};

describe('useDashboardViewOverlays', () => {
  it('creates an overlay on first use and returns the same one after', () => {
    const { view } = createViews();
    const { result } = render();
    const first = result.current.getViewOverlay(W1, view('v1'));

    expect(first).toBeDefined();
    expect(result.current.getViewOverlay(W1, view('v1'))).toBe(first);
    expect(result.current.summary.dirtyWidgets).toBe(0);
  });

  it('keeps private conditions through a view that is briefly missing', () => {
    const { view } = createViews();
    const { result } = render();

    addPrivateFilter(result.current.getViewOverlay(W1, view('v1')), 'mine');
    expect(result.current.summary.dirtyWidgets).toBe(1);
    expect(result.current.getViewOverlay(W1, undefined)).toBeUndefined();
    expect(result.current.summary.dirtyWidgets).toBe(1);
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
    expect(result.current.summary.dirtyWidgets).toBe(1);

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
    expect(result.current.summary.dirtyWidgets).toBe(0);
  });

  it('saves only the widgets whose source the viewer can write', () => {
    const { view } = createViews();
    const { result } = render();

    addPrivateFilter(result.current.getViewOverlay(W1, view('v1')), 'writable');
    addPrivateFilter(result.current.getViewOverlay(W2, view('v2')), 'read-only');
    // Unknown permissions fail closed.
    expect(result.current.summary).toEqual({ dirtyWidgets: 2, savableWidgets: 0 });

    act(() => {
      result.current.setViewOverlayWritable(W1, true);
      result.current.setViewOverlayWritable(W2, false);
    });
    expect(result.current.summary).toEqual({ dirtyWidgets: 2, savableWidgets: 1 });

    act(() => result.current.commitViewOverlays());
    expect(view('v1').get(YjsDatabaseKey.filters).toJSON()).toEqual([{ id: 'writable', content: 'writable' }]);
    expect(view('v2').get(YjsDatabaseKey.filters).toJSON()).toEqual([]);
    // The read-only widget keeps its private filter, which only Reset drops.
    expect(result.current.summary).toEqual({ dirtyWidgets: 1, savableWidgets: 0 });

    act(() => result.current.resetViewOverlays());
    expect(result.current.summary).toEqual({ dirtyWidgets: 0, savableWidgets: 0 });
  });

  it('resets and commits one widget only', () => {
    const { view } = createViews();
    const { result } = render();

    addPrivateFilter(result.current.getViewOverlay(W1, view('v1')), 'first');
    addPrivateFilter(result.current.getViewOverlay(W2, view('v2')), 'second');
    act(() => {
      result.current.setViewOverlayWritable(W1, true);
      result.current.setViewOverlayWritable(W2, true);
    });

    act(() => result.current.commitViewOverlays(W1));
    expect(view('v1').get(YjsDatabaseKey.filters).toJSON()).toEqual([{ id: 'first', content: 'first' }]);
    expect(view('v2').get(YjsDatabaseKey.filters).toJSON()).toEqual([]);
    expect(result.current.summary).toEqual({ dirtyWidgets: 1, savableWidgets: 1 });

    addPrivateFilter(result.current.getViewOverlay(W1, view('v1')), 'again');
    act(() => result.current.resetViewOverlays(W2));
    expect(result.current.getViewOverlay(W2, view('v2'))?.get(YjsDatabaseKey.filters).length).toBe(0);
    // W1's newer private filter is untouched.
    expect(result.current.getViewOverlay(W1, view('v1'))?.get(YjsDatabaseKey.filters).length).toBe(2);
    expect(result.current.summary).toEqual({ dirtyWidgets: 1, savableWidgets: 1 });
  });

  it('a pending entry is sanitized against the source fields and applied at overlay creation', async () => {
    const { view } = createViews();
    const { result } = render(ROWS, {
      v1: {
        filters: [
          STAGE_FILTER,
          { id: 'f2', filter_type: FilterType.Data, field_id: 'gone', ty: 0, condition: 2, content: 'x' },
        ],
        sorts: [{ id: 's1', field_id: 'points', condition: 1 }],
      },
    });
    const overlay = result.current.getViewOverlay(W1, view('v1'));

    expect(overlay?.get(YjsDatabaseKey.filters).toJSON()).toEqual([STAGE_FILTER]);
    expect(overlay?.get(YjsDatabaseKey.sorts).toJSON()).toEqual([{ id: 's1', field_id: 'points', condition: 1 }]);
    // The counts follow once the render is over.
    await act(async () => Promise.resolve());
    expect(result.current.summary.dirtyWidgets).toBe(1);
    expect(result.current.exportPrivateWidgets()).toEqual({
      v1: { filters: [STAGE_FILTER], sorts: [{ id: 's1', field_id: 'points', condition: 1 }] },
    });
  });

  it('pending entries of unmounted widgets survive exportPrivateWidgets', () => {
    const { view } = createViews();
    const pending = { v2: { sorts: [{ id: 's1', field_id: 'points', condition: 1 }] } };
    const { result } = render(ROWS, pending);

    addPrivateFilter(result.current.getViewOverlay(W1, view('v1')), 'mine');
    // W2 never mounted: its stored sort is still written back.
    expect(result.current.exportPrivateWidgets()).toEqual({
      v1: { filters: [{ id: 'mine', content: 'mine' }] },
      v2: pending.v2,
    });
  });

  it('pending entries for removed views are dropped on retain', () => {
    const pending = { v2: { sorts: [{ id: 's1', field_id: 'points', condition: 1 }] }, gone: { sorts: [] } };
    const { result, rerender } = render(ROWS, pending);

    expect(Object.keys(result.current.exportPrivateWidgets()).sort()).toEqual(['v2']);
    rerender({ current: [{ ...ROWS[0], widgets: [{ ...W1, width: 12 }] }] });
    expect(result.current.exportPrivateWidgets()).toEqual({});
  });

  it('the widget handle snapshot is stable until a part changes', () => {
    const { view } = createViews();
    const { result } = render();
    const handle = result.current.getWidgetPrivateHandle(W1);
    const listener = jest.fn();

    handle.subscribe(listener);
    const clean = handle.getSnapshot();
    const overlay = result.current.getViewOverlay(W1, view('v1'));

    expect(result.current.getWidgetPrivateHandle(W1)).toBe(handle);
    expect(handle.getSnapshot()).toBe(clean);
    addPrivateSort(overlay, 'mine');
    const sorted = handle.getSnapshot();

    expect(sorted).toEqual({ filters: false, sorts: true, writable: false });
    expect(listener).toHaveBeenCalledTimes(1);
    // Another private sort keeps the part dirty: same snapshot, no notification.
    addPrivateSort(overlay, 'more');
    expect(handle.getSnapshot()).toBe(sorted);
    expect(listener).toHaveBeenCalledTimes(1);
    act(() => result.current.setViewOverlayWritable(W1, true));
    expect(handle.getSnapshot()).toEqual({ filters: false, sorts: true, writable: true });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
