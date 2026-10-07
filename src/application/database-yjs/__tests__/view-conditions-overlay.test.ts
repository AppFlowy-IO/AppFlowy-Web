import * as Y from 'yjs';

import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { executeDatabaseOperations, getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import {
  createViewConditionsOverlay,
  getOverlayTarget,
  observeOverlayConditions,
  readOverlayConditions,
} from '@/application/database-yjs/view-conditions-overlay';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

import { viewConditionsYrsDelta, viewConditionsYrsInitial } from './fixtures/view-conditions-yrs';

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
  it('mirrors native Yrs maps as numbers without rewriting equivalent values and saves them with undo', () => {
    const doc = new Y.Doc() as YDoc;

    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(viewConditionsYrsInitial, 'base64')), 'remote');
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const view = database.get(YjsDatabaseKey.views).get('view-1');
    const sourceFilters = view.get(YjsDatabaseKey.filters);
    const sourceSorts = view.get(YjsDatabaseKey.sorts);
    const updates = jest.fn();

    getOrCreateDatabaseHistoryManager(doc);
    doc.on('update', updates);
    const overlay = createViewConditionsOverlay(view);
    const filters = overlay.view.get(YjsDatabaseKey.filters);
    const sorts = overlay.view.get(YjsDatabaseKey.sorts);
    const firstFilter = filters.get(0);
    const firstSort = sorts.get(0);

    expect(firstFilter.toJSON()).toMatchObject({ condition: 1, ty: 10, filter_type: 2 });
    expect(firstSort.get(YjsDatabaseKey.condition)).toBe(1);
    expect(sourceFilters.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(1));
    expect(sourceSorts.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(1));
    expect(overlay.isDirty()).toBe(false);
    expect(updates).not.toHaveBeenCalled();

    // A clean reset compares the native BigInts with their cloned numbers as equal.
    overlay.reset();
    expect(filters.get(0)).toBe(firstFilter);
    expect(sorts.get(0)).toBe(firstSort);

    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(viewConditionsYrsDelta, 'base64')), 'remote');
    expect(filters.get(0).get(YjsDatabaseKey.condition)).toBe(0);
    expect(sorts.get(0).get(YjsDatabaseKey.condition)).toBe(0);
    // Followed in place: the condition maps keep their identity.
    expect(filters.get(0)).toBe(firstFilter);
    expect(sorts.get(0)).toBe(firstSort);
    expect(overlay.isDirty()).toBe(false);

    filters.get(0).set(YjsDatabaseKey.condition, 1);
    overlay.reset();
    expect(filters.get(0).get(YjsDatabaseKey.condition)).toBe(0);
    expect(overlay.isDirty()).toBe(false);

    filters.get(0).set(YjsDatabaseKey.condition, 1);
    sorts.get(0).set(YjsDatabaseKey.condition, 1);
    expect(sourceFilters.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(0));
    expect(sourceSorts.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(0));
    overlay.commit();
    expect(sourceFilters.get(0).get(YjsDatabaseKey.condition)).toBe(1);
    expect(sourceSorts.get(0).get(YjsDatabaseKey.condition)).toBe(1);
    // Only the changed key is written: the unchanged enums stay native.
    expect(sourceFilters.get(0).get(YjsDatabaseKey.type)).toBe(BigInt(10));
    expect(overlay.isDirty()).toBe(false);

    getOrCreateDatabaseHistoryManager(doc).undo();
    expect(sourceFilters.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(0));
    expect(sourceSorts.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(0));
    expect(filters.get(0).get(YjsDatabaseKey.condition)).toBe(0);
    expect(sorts.get(0).get(YjsDatabaseKey.condition)).toBe(0);
    overlay.destroy();
    doc.destroy();
  });

  it.each([YjsDatabaseKey.filters, YjsDatabaseKey.sorts])(
    'preserves BigInt %s in plain records through mirroring, reset, save, and undo',
    (key) => {
      const { doc, view } = createRealView();
      const source = view.get(key) as Y.Array<Record<string, unknown>>;
      // Yrs stores these entries as plain Any maps with BigInt enum values.
      const condition = {
        id: 'native-condition',
        field_id: 'status',
        condition: BigInt(1),
        ...(key === YjsDatabaseKey.filters
          ? { filter_type: BigInt(FilterType.Data), ty: BigInt(FieldType.SingleSelect), content: '[]' }
          : {}),
      };
      const replaceCondition = (target: Y.Array<Record<string, unknown>>, value: typeof condition) => {
        target.doc!.transact(() => {
          target.delete(0, target.length);
          target.push([value]);
        });
      };

      source.push([condition]);
      const overlay = createViewConditionsOverlay(view);
      const local = overlay.view.get(key) as Y.Array<Record<string, unknown>>;
      const listener = jest.fn();

      overlay.subscribe(listener);
      expect(local.toJSON()).toEqual(source.toJSON());
      expect(local.get(0).condition).toBe(BigInt(1));
      expect(overlay.isDirty()).toBe(false);

      // A synced native update is mirrored without becoming a viewer edit.
      replaceCondition(source, { ...condition, condition: BigInt(0) });
      expect(local.get(0).condition).toBe(BigInt(0));
      expect(listener).not.toHaveBeenCalled();

      replaceCondition(local, condition);
      expect(overlay.isDirty()).toBe(true);
      expect(source.get(0).condition).toBe(BigInt(0));

      overlay.reset();
      expect(overlay.isDirty()).toBe(false);
      expect(local.toJSON()).toEqual(source.toJSON());

      replaceCondition(local, condition);
      overlay.commit();
      expect(overlay.isDirty()).toBe(false);
      expect(source.get(0).condition).toBe(BigInt(1));
      expect(local.toJSON()).toEqual(source.toJSON());

      getOrCreateDatabaseHistoryManager(doc).undo();
      expect(source.get(0).condition).toBe(BigInt(0));
      expect(local.toJSON()).toEqual(source.toJSON());

      overlay.destroy();
      doc.destroy();
    }
  );

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
    expect([...overlay.dirtyParts()]).toEqual([YjsDatabaseKey.filters]);

    // Per part (WP07 decision 1): a sort saved by a collaborator still reaches the viewer.
    (view.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push([sortMap('shared-sort')]);
    expect(readOverlayConditions(overlay).sorts.map((sort) => sort.id)).toEqual(['shared-sort']);
    expect([...overlay.dirtyParts()]).toEqual([YjsDatabaseKey.filters]);

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

  it('follows the real view again once the viewer undoes their change by hand', () => {
    const { view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const local = overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>;
    const listener = jest.fn();

    overlay.subscribe(listener);
    local.push([filterMap('mine')]);
    expect(overlay.isDirty()).toBe(true);
    local.delete(0, 1);
    expect(overlay.isDirty()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    // Clean again, so a collaborator's filter reaches the viewer.
    filters.push([filterMap('shared')]);
    expect(readOverlayConditions(overlay).filters.map((filter) => filter.id)).toEqual(['shared']);
    overlay.destroy();
  });

  it('gets clean when a collaborator saves the same conditions', () => {
    const { view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);

    (overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>).push([filterMap('same')]);
    expect(overlay.isDirty()).toBe(true);
    filters.push([filterMap('same')]);
    expect(overlay.isDirty()).toBe(false);
    overlay.destroy();
  });

  it('names its real view and reports private condition changes', () => {
    const { view } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const listener = jest.fn();
    const stop = observeOverlayConditions(overlay.view, listener);

    expect(getOverlayTarget(overlay.view)).toBe(view);
    expect(getOverlayTarget(view)).toBe(view);
    expect(observeOverlayConditions(view, listener)).toEqual(expect.any(Function));

    (overlay.view.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push([sortMap('mine')]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(overlay.isDirty()).toBe(true);
    expect([...overlay.dirtyParts()]).toEqual([YjsDatabaseKey.sorts]);
    stop();
    (overlay.view.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).delete(0, 1);
    expect(listener).toHaveBeenCalledTimes(1);

    const replacement = createRealView().view;

    overlay.rebind(replacement);
    expect(getOverlayTarget(overlay.view)).toBe(replacement);
    overlay.destroy();
  });

  it('follows a hand-reverted desktop-authored condition again', () => {
    const doc = new Y.Doc() as YDoc;

    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(viewConditionsYrsInitial, 'base64')), 'remote');
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const overlay = createViewConditionsOverlay(database.get(YjsDatabaseKey.views).get('view-1'));
    const sort = overlay.view.get(YjsDatabaseKey.sorts).get(0);

    // The real sort holds BigInt(1); the dispatchers write plain numbers.
    sort.set(YjsDatabaseKey.condition, 0);
    expect(overlay.isDirty()).toBe(true);
    sort.set(YjsDatabaseKey.condition, 1);
    expect(overlay.isDirty()).toBe(false);
    overlay.destroy();
    doc.destroy();
  });

  it('compares enum values stored as numeric strings with numbers', () => {
    const { view, sorts } = createRealView();
    const stringified = sortMap('s1');

    // An earlier reorder of a desktop-authored sort stored its enum as a string.
    stringified.set(YjsDatabaseKey.condition, '1');
    sorts.push([stringified]);
    const overlay = createViewConditionsOverlay(view);
    const local = overlay.view.get(YjsDatabaseKey.sorts).get(0);

    local.set(YjsDatabaseKey.condition, 0);
    expect(overlay.isDirty()).toBe(true);
    local.set(YjsDatabaseKey.condition, 1);
    expect(overlay.isDirty()).toBe(false);
    overlay.destroy();
  });

  it('saves and resets by patching the condition maps in place', () => {
    const { doc, view, filters, sorts } = createRealView();

    filters.push([filterMap('f1')]);
    sorts.push([sortMap('s1'), sortMap('s2', 'status')]);
    const overlay = createViewConditionsOverlay(view);
    const localSorts = overlay.view.get(YjsDatabaseKey.sorts);
    const localFirst = localSorts.get(0);
    const realFirst = sorts.get(0);
    const realSecond = sorts.get(1);
    const realEvents = jest.fn();

    localFirst.set(YjsDatabaseKey.condition, 1);
    expect([...overlay.dirtyParts()]).toEqual([YjsDatabaseKey.sorts]);
    sorts.observeDeep(realEvents);
    overlay.commit();
    expect(overlay.dirtyParts().size).toBe(0);

    expect(sorts.get(0)).toBe(realFirst);
    expect(sorts.get(1)).toBe(realSecond);
    expect(realFirst.get(YjsDatabaseKey.condition)).toBe(1);
    // One key changed on one map, and nothing else.
    expect(realEvents).toHaveBeenCalledTimes(1);
    expect(realEvents.mock.calls[0][0]).toHaveLength(1);
    expect(realEvents.mock.calls[0][0][0].target).toBe(realFirst);
    expect([...realEvents.mock.calls[0][0][0].keysChanged]).toEqual([YjsDatabaseKey.condition]);
    sorts.unobserveDeep(realEvents);

    // A local reorder moves the maps out of place; a reset puts copies of the real ones back.
    localSorts.delete(0, 1);
    localSorts.push([sortMap('s1')]);
    expect(overlay.isDirty()).toBe(true);
    expect([...overlay.dirtyParts()]).toEqual([YjsDatabaseKey.sorts]);
    overlay.reset();
    expect(overlay.dirtyParts().size).toBe(0);
    expect(readOverlayConditions(overlay).sorts).toEqual(sorts.toJSON());
    expect(overlay.isDirty()).toBe(false);

    getOrCreateDatabaseHistoryManager(doc).undo();
    expect(realFirst.get(YjsDatabaseKey.condition)).toBe(0);
    expect(readOverlayConditions(overlay).sorts).toEqual(sorts.toJSON());
    overlay.destroy();
  });

  it("batches a dispatcher's private writes into one local change without an undo step", () => {
    const { doc, view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const localSorts = overlay.view.get(YjsDatabaseKey.sorts);
    const localChanges = jest.fn();
    const dirtyChanges = jest.fn();
    const history = getOrCreateDatabaseHistoryManager(doc);

    observeOverlayConditions(overlay.view, localChanges);
    overlay.subscribe(dirtyChanges);
    executeDatabaseOperations(
      sharedRoot,
      [
        () => {
          localSorts.push([sortMap('s1')]);
          localSorts.push([sortMap('s2', 'status')]);
          localSorts.get(0).set(YjsDatabaseKey.condition, 1);
        },
      ],
      'addSorts'
    );

    expect(localChanges).toHaveBeenCalledTimes(1);
    expect(dirtyChanges).toHaveBeenCalledTimes(1);
    expect(overlay.isDirty()).toBe(true);
    expect(readOverlayConditions(overlay).sorts.map((sort) => sort.id)).toEqual(['s1', 's2']);
    // Private writes never enter the shared doc's history.
    expect(history.canUndo()).toBe(false);

    // A clear-and-rebuild that ends where it started notifies local observers once and leaves the dirty state alone.
    executeDatabaseOperations(
      sharedRoot,
      [
        () => {
          localSorts.delete(0, localSorts.length);
          localSorts.push([sortMap('s1'), sortMap('s2', 'status')]);
          localSorts.get(0).set(YjsDatabaseKey.condition, 1);
        },
      ],
      'rebuildSorts'
    );
    expect(localChanges).toHaveBeenCalledTimes(2);
    expect(dirtyChanges).toHaveBeenCalledTimes(1);

    // A shared write in the same action is still one undo step of its own.
    executeDatabaseOperations(
      sharedRoot,
      [
        () => {
          localSorts.delete(0, localSorts.length);
          filters.push([filterMap('shared')]);
        },
      ],
      'mixed'
    );
    expect(localChanges).toHaveBeenCalledTimes(3);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(filters.length).toBe(0);
    expect(readOverlayConditions(overlay).sorts).toEqual([]);

    // Once destroyed, the overlay's doc is no longer part of the database's actions.
    overlay.destroy();
    expect(() => executeDatabaseOperations(sharedRoot, [() => filters.push([filterMap('after')])], 'after')).not.toThrow();
    expect(filters.length).toBe(1);
  });

  it('moves the batching to the doc of a rebound view', () => {
    const first = createRealView();
    const second = createRealView();
    const overlay = createViewConditionsOverlay(first.view);
    const localSorts = overlay.view.get(YjsDatabaseKey.sorts);
    const localChanges = jest.fn();
    const twoPushes = (doc: YDoc) =>
      executeDatabaseOperations(
        doc.getMap(YjsEditorKey.data_section) as YSharedRoot,
        [
          () => {
            localSorts.push([sortMap('a')]);
            localSorts.push([sortMap('b')]);
          },
        ],
        'twoPushes'
      );

    overlay.rebind(second.view);
    observeOverlayConditions(overlay.view, localChanges);
    twoPushes(second.doc);
    expect(localChanges).toHaveBeenCalledTimes(1);
    // The previous doc's actions no longer open a local transaction.
    twoPushes(first.doc);
    expect(localChanges).toHaveBeenCalledTimes(3);
    overlay.destroy();
  });
});

describe('per-part private conditions (WP07)', () => {
  const dataFilter = (id: string, content = 'done') => {
    const map = filterMap(id, content);

    map.set(YjsDatabaseKey.type, FieldType.SingleSelect);
    return map;
  };

  it('a private filter edit freezes filters only; sorts keep following the real view', () => {
    const { view, sorts } = createRealView();
    const overlay = createViewConditionsOverlay(view);

    (overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>).push([dataFilter('mine')]);
    sorts.push([sortMap('saved')]);
    expect([...overlay.dirtyParts()]).toEqual([YjsDatabaseKey.filters]);
    expect(readOverlayConditions(overlay).sorts.map((sort) => sort.id)).toEqual(['saved']);
    overlay.destroy();
  });

  it('the Sort part alone is dirty after a private sort', () => {
    const { view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);

    (overlay.view.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push([sortMap('mine')]);
    filters.push([dataFilter('saved')]);
    expect([...overlay.dirtyParts()]).toEqual([YjsDatabaseKey.sorts]);
    expect(readOverlayConditions(overlay).filters.map((filter) => filter.id)).toEqual(['saved']);
    overlay.destroy();
  });

  it('filter ids and top-level filter order do not make the overlay dirty', () => {
    const { view, filters } = createRealView();

    filters.push([dataFilter('a', 'one'), dataFilter('b', 'two')]);
    const overlay = createViewConditionsOverlay(view);
    const local = overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>;
    const listener = jest.fn();

    overlay.onPrivateChange(listener);
    // Reorder with fresh ids: the same rows pass.
    local.doc!.transact(() => {
      local.delete(0, 2);
      local.push([dataFilter('y', 'two'), dataFilter('x', 'one')]);
    });
    expect(overlay.isDirty()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    overlay.destroy();
  });

  it('sort order makes the overlay dirty', () => {
    const { view, sorts } = createRealView();

    sorts.push([sortMap('a', 'name'), sortMap('b', 'status')]);
    const overlay = createViewConditionsOverlay(view);
    const local = overlay.view.get(YjsDatabaseKey.sorts) as Y.Array<unknown>;

    local.doc!.transact(() => {
      local.delete(0, 2);
      local.push([sortMap('b', 'status'), sortMap('a', 'name')]);
    });
    expect([...overlay.dirtyParts()]).toEqual([YjsDatabaseKey.sorts]);
    overlay.destroy();
  });

  it('commit writes only dirty parts and leaves the clean part\'s maps untouched', () => {
    const { doc, view, filters, sorts } = createRealView();

    filters.push([dataFilter('saved-filter')]);
    sorts.push([sortMap('saved-sort')]);
    const realFilter = filters.get(0);
    const realSort = sorts.get(0);
    const overlay = createViewConditionsOverlay(view);

    (overlay.view.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push([sortMap('mine', 'status')]);
    const filterEvents = jest.fn();

    filters.observeDeep(filterEvents);
    overlay.commit();
    expect(filterEvents).not.toHaveBeenCalled();
    expect(filters.get(0)).toBe(realFilter);
    expect(sorts.get(0)).toBe(realSort);
    expect(sorts.toJSON().map((sort: { id: string }) => sort.id)).toEqual(['saved-sort', 'mine']);
    expect(overlay.isDirty()).toBe(false);

    getOrCreateDatabaseHistoryManager(doc).undo();
    expect(sorts.toJSON().map((sort: { id: string }) => sort.id)).toEqual(['saved-sort']);
    filters.unobserveDeep(filterEvents);
    overlay.destroy();
  });

  it('initial restores dirty parts without notifying and reports dirtyParts', () => {
    const { view, sorts } = createRealView();

    sorts.push([sortMap('saved')]);
    const overlay = createViewConditionsOverlay(view, {
      initial: {
        filters: [
          { id: 'f1', filter_type: FilterType.Data, field_id: 'status', ty: FieldType.SingleSelect, condition: 0, content: 'done' },
        ],
        // Equal to the saved sort: follows the real view.
        sorts: [{ id: 'other', field_id: 'name', condition: 0 }],
      },
    });
    const listener = jest.fn();

    overlay.subscribe(listener);
    expect([...overlay.dirtyParts()]).toEqual([YjsDatabaseKey.filters]);
    expect(readOverlayConditions(overlay).filters.map((filter) => filter.id)).toEqual(['f1']);
    expect(readOverlayConditions(overlay).sorts.map((sort) => sort.id)).toEqual(['saved']);
    expect(listener).not.toHaveBeenCalled();
    overlay.destroy();
  });

  it('exportPrivate returns dirty parts only', () => {
    const { view } = createRealView();
    const overlay = createViewConditionsOverlay(view);

    expect(overlay.exportPrivate()).toBeNull();
    (overlay.view.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push([sortMap('mine')]);
    expect(overlay.exportPrivate()).toEqual({ sorts: [{ id: 'mine', field_id: 'name', condition: 0 }] });
    overlay.destroy();
  });

  it('onPrivateChange fires on every private edit, not on mirror', () => {
    const { view, filters } = createRealView();
    const overlay = createViewConditionsOverlay(view);
    const listener = jest.fn();
    const local = overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>;

    overlay.onPrivateChange(listener);
    filters.push([dataFilter('shared')]);
    expect(listener).not.toHaveBeenCalled();
    local.push([dataFilter('mine', 'todo')]);
    (local.get(1) as Y.Map<unknown>).set(YjsDatabaseKey.content, 'later');
    expect(listener).toHaveBeenCalledTimes(2);
    overlay.reset();
    expect(listener).toHaveBeenCalledTimes(2);
    overlay.destroy();
  });

  it('restore never overrides a part the viewer already changed', () => {
    const { view } = createRealView();
    const overlay = createViewConditionsOverlay(view);

    (overlay.view.get(YjsDatabaseKey.sorts) as Y.Array<unknown>).push([sortMap('typed')]);
    overlay.restore({
      sorts: [{ id: 'stored', field_id: 'status', condition: 1 }],
      filters: [{ id: 'f1', filter_type: FilterType.Data, field_id: 'status', ty: FieldType.SingleSelect, content: 'x' }],
    });
    expect(readOverlayConditions(overlay).sorts.map((sort) => sort.id)).toEqual(['typed']);
    expect(readOverlayConditions(overlay).filters.map((filter) => filter.id)).toEqual(['f1']);
    expect([...overlay.dirtyParts()].sort()).toEqual([YjsDatabaseKey.filters, YjsDatabaseKey.sorts]);
    overlay.destroy();
  });
});
