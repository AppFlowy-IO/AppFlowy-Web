/**
 * Edit mode suspends a widget's conditions overlay instead of taking it away
 * (PERFORMANCE-REPORT W12, theme 7 of 3.4): the proxy and its arrays stay the
 * same objects, so nothing that reads the view renders again; the private
 * parts are set aside, the arrays show the real view, and a write goes to the
 * real view as part of the same action (one undo step).
 */
import * as Y from 'yjs';

import { FilterType } from '@/application/database-yjs/database.type';
import { executeDatabaseOperations, getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import {
  createViewConditionsOverlay,
  observeOverlayConditions,
  readOverlayConditions,
  setOverlaySuspended,
} from '@/application/database-yjs/view-conditions-overlay';
import { YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createRealView() {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map() as YDatabaseView;
  const filters = new Y.Array();
  const sorts = new Y.Array();

  sharedRoot.set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.views, views);
  views.set('view-1', view);
  view.set(YjsDatabaseKey.id, 'view-1');
  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);
  getOrCreateDatabaseHistoryManager(doc);
  return { doc, sharedRoot, view, filters, sorts };
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

const filterContents = (array: Y.Array<unknown>) =>
  (array.toJSON() as { content: string }[]).map((filter) => filter.content);

describe('a suspended (Edit mode) conditions overlay', () => {
  it('keeps the proxy and its arrays, and notifies nothing, when nothing is private', () => {
    const { view, filters } = createRealView();

    filters.push([filterMap('saved', 'todo')]);
    const overlay = createViewConditionsOverlay(view);
    const proxy = overlay.view;
    const localFilters = proxy.get(YjsDatabaseKey.filters);
    const observer = jest.fn();
    const dirty = jest.fn();

    observeOverlayConditions(proxy, observer);
    overlay.subscribe(dirty);

    setOverlaySuspended(proxy, true);
    expect(overlay.isSuspended()).toBe(true);
    expect(overlay.view).toBe(proxy);
    expect(proxy.get(YjsDatabaseKey.filters)).toBe(localFilters);
    expect(filterContents(localFilters)).toEqual(['todo']);

    setOverlaySuspended(proxy, false);
    expect(overlay.isSuspended()).toBe(false);
    expect(proxy.get(YjsDatabaseKey.filters)).toBe(localFilters);
    expect(observer).not.toHaveBeenCalled();
    expect(dirty).not.toHaveBeenCalled();
    overlay.destroy();
  });

  it('writes an edit to the real view in the same action, one undo step, and keeps it shared', () => {
    const { doc, sharedRoot, view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const localFilters = overlay.view.get(YjsDatabaseKey.filters);
    const privateChange = jest.fn();
    const history = getOrCreateDatabaseHistoryManager(doc);

    overlay.onPrivateChange(privateChange);
    overlay.setSuspended(true);
    // A dispatcher writes through the view it is given: the proxy.
    executeDatabaseOperations(sharedRoot, [() => localFilters.push([filterMap('edit', 'doing')])], 'addFilter');

    expect(filterContents(filters)).toEqual(['doing']);
    expect(filterContents(localFilters)).toEqual(['doing']);
    expect(overlay.isDirty()).toBe(false);
    expect(privateChange).not.toHaveBeenCalled();
    expect(history.canUndo()).toBe(true);

    // Done: the edit is the shared view's, which the overlay follows.
    overlay.setSuspended(false);
    expect(overlay.isDirty()).toBe(false);
    expect(readOverlayConditions(overlay).filters.map((filter) => filter.content)).toEqual(['doing']);

    history.undo();
    expect(filters.length).toBe(0);
    expect(localFilters.length).toBe(0);
    overlay.destroy();
  });

  it('sets a private part aside while suspended and brings it back on resume', () => {
    const { view, filters } = createRealView();

    filters.push([filterMap('saved', 'todo')]);
    const overlay = createViewConditionsOverlay(view);
    const localFilters = overlay.view.get(YjsDatabaseKey.filters);
    const observer = jest.fn();

    // The viewer's own filter (View mode).
    localFilters.push([filterMap('mine', 'done')]);
    expect(overlay.isDirty()).toBe(true);
    observeOverlayConditions(overlay.view, observer);

    overlay.setSuspended(true);
    // Edit mode shows the saved view; the private part is kept.
    expect(filterContents(localFilters)).toEqual(['todo']);
    expect(observer).toHaveBeenCalled();
    expect(overlay.isDirty()).toBe(true);
    expect(overlay.exportPrivate()?.filters?.map((filter) => filter.content)).toEqual(['todo', 'done']);

    overlay.setSuspended(false);
    expect(filterContents(localFilters)).toEqual(['todo', 'done']);
    expect(overlay.isDirty()).toBe(true);
    expect(filters.length).toBe(1);
    overlay.destroy();
  });

  it('follows the real view again when an edit made in Edit mode matches the private part', () => {
    const { sharedRoot, view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const localFilters = overlay.view.get(YjsDatabaseKey.filters);

    localFilters.push([filterMap('mine', 'done')]);
    overlay.setSuspended(true);
    // The editor adds the same filter to the shared view.
    executeDatabaseOperations(sharedRoot, [() => localFilters.push([filterMap('shared', 'done')])], 'addFilter');
    expect(filterContents(filters)).toEqual(['done']);
    expect(overlay.isDirty()).toBe(false);

    overlay.setSuspended(false);
    expect(overlay.isDirty()).toBe(false);
    expect(filterContents(localFilters)).toEqual(['done']);
    overlay.destroy();
  });

  it('saves and resets the set-aside part while suspended', () => {
    const { view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const localFilters = overlay.view.get(YjsDatabaseKey.filters);

    localFilters.push([filterMap('mine', 'done')]);
    overlay.setSuspended(true);
    overlay.commit();
    expect(filterContents(filters)).toEqual(['done']);
    expect(overlay.isDirty()).toBe(false);
    overlay.setSuspended(false);
    expect(filterContents(localFilters)).toEqual(['done']);

    localFilters.push([filterMap('mine-2', 'todo')]);
    overlay.setSuspended(true);
    overlay.reset();
    overlay.setSuspended(false);
    expect(overlay.isDirty()).toBe(false);
    expect(filterContents(localFilters)).toEqual(['done']);
    overlay.destroy();
  });

  it('keeps a part restored from this device while suspended until resume', () => {
    const { view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const localFilters = overlay.view.get(YjsDatabaseKey.filters);

    overlay.setSuspended(true);
    overlay.restore({
      filters: [{ id: 'restored', field_id: 'status', filter_type: FilterType.Data, condition: 0, content: 'done' }],
    });
    expect(overlay.isDirty()).toBe(true);
    expect(localFilters.length).toBe(0);

    overlay.setSuspended(false);
    expect(filterContents(localFilters)).toEqual(['done']);
    expect(filters.length).toBe(0);
    overlay.destroy();
  });
});
