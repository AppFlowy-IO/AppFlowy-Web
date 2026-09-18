import * as Y from 'yjs';

import { FilterType } from '@/application/database-yjs/database.type';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { createViewConditionsOverlay, readOverlayConditions } from '@/application/database-yjs/view-conditions-overlay';
import { YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createRealView() {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map() as YDatabaseView;
  const filters = new Y.Array();
  const sorts = new Y.Array();
  const rowOrders = new Y.Array();

  sharedRoot.set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.views, views);
  views.set('view-1', view);
  view.set(YjsDatabaseKey.id, 'view-1');
  view.set(YjsDatabaseKey.name, 'Grid');
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  rowOrders.push([{ id: 'r1', height: 36 }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  getOrCreateDatabaseHistoryManager(doc);
  return { doc, view, filters, sorts };
}

function filterMap(id: string, content = 'done') {
  const map = new Y.Map();

  map.set(YjsDatabaseKey.id, id);
  map.set(YjsDatabaseKey.field_id, 'status');
  map.set(YjsDatabaseKey.filter_type, FilterType.Data);
  map.set(YjsDatabaseKey.condition, 0);
  map.set(YjsDatabaseKey.content, content);
  return map;
}

function sortMap(id: string, fieldId = 'name') {
  const map = new Y.Map();

  map.set(YjsDatabaseKey.id, id);
  map.set(YjsDatabaseKey.field_id, fieldId);
  map.set(YjsDatabaseKey.condition, 0);
  return map;
}

describe('createViewConditionsOverlay', () => {
  it('starts as a copy of the real filters and sorts and forwards every other key', () => {
    const { view, filters, sorts } = createRealView();

    filters.push([filterMap('f1')]);
    sorts.push([sortMap('s1')]);
    const overlay = createViewConditionsOverlay(view);

    expect(readOverlayConditions(overlay).filters.map((filter) => filter.id)).toEqual(['f1']);
    expect(readOverlayConditions(overlay).sorts.map((sort) => sort.id)).toEqual(['s1']);
    expect(overlay.view.get(YjsDatabaseKey.filters)).not.toBe(filters);
    expect(overlay.view.get(YjsDatabaseKey.name)).toBe('Grid');
    expect(overlay.view.get(YjsDatabaseKey.row_orders)).toBe(view.get(YjsDatabaseKey.row_orders));
    expect(overlay.isDirty()).toBe(false);
    overlay.destroy();
  });

  it('follows the real view while clean, then keeps the local version once edited', () => {
    const { view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const listener = jest.fn();

    overlay.subscribe(listener);
    filters.push([filterMap('f1')]);
    expect(readOverlayConditions(overlay).filters.map((filter) => filter.id)).toEqual(['f1']);
    expect(listener).not.toHaveBeenCalled();

    // The viewer removes the filter locally: the real view is untouched.
    (overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>).delete(0, 1);
    expect(overlay.isDirty()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(filters.length).toBe(1);

    // A collaborator's change no longer overwrites the viewer's copy.
    filters.push([filterMap('f2')]);
    expect(readOverlayConditions(overlay).filters).toEqual([]);

    overlay.reset();
    expect(overlay.isDirty()).toBe(false);
    expect(readOverlayConditions(overlay).filters.map((filter) => filter.id)).toEqual(['f1', 'f2']);
    overlay.destroy();
  });

  it('commits the local filters and sorts to the real view as one undo step', () => {
    const { doc, view, filters, sorts } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const updates = jest.fn();

    doc.on('update', updates);
    (overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>).push([filterMap('local-filter', 'todo')]);
    (overlay.view.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push([sortMap('local-sort')]);
    expect(updates).not.toHaveBeenCalled();

    overlay.commit();

    expect(filters.toJSON().map((filter: { id: string }) => filter.id)).toEqual(['local-filter']);
    expect(sorts.toJSON().map((sort: { id: string }) => sort.id)).toEqual(['local-sort']);
    expect(overlay.isDirty()).toBe(false);
    expect(updates).toHaveBeenCalled();

    getOrCreateDatabaseHistoryManager(doc).undo();
    expect(filters.length).toBe(0);
    // Undoing the save is a real-view change; the clean overlay follows it.
    expect(readOverlayConditions(overlay).filters).toEqual([]);
    overlay.destroy();
  });

  it('follows the real view when its filters array is replaced', () => {
    const { view } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const replacement = new Y.Array();

    view.set(YjsDatabaseKey.filters, replacement);
    replacement.push([filterMap('f9')]);
    expect(readOverlayConditions(overlay).filters.map((filter) => filter.id)).toEqual(['f9']);
    overlay.destroy();
  });

  it('writes a whole-array set through the proxy to the local copy only', () => {
    const { view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const next = new Y.Array();

    next.push([filterMap('f1')]);
    overlay.view.set(YjsDatabaseKey.filters, next);
    expect(readOverlayConditions(overlay).filters.map((filter) => filter.id)).toEqual(['f1']);
    expect(filters.length).toBe(0);
    expect(overlay.isDirty()).toBe(true);
    overlay.destroy();
  });
});
