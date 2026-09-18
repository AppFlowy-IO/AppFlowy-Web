import * as Y from 'yjs';

import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { createViewConditionsOverlay, readOverlayConditions } from '@/application/database-yjs/view-conditions-overlay';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

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
  it('mirrors native Yrs maps without rewriting equivalent values and saves them with undo', () => {
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

    expect(firstFilter.toJSON()).toMatchObject({ condition: '1', ty: '10', filter_type: '2' });
    expect(firstSort.get(YjsDatabaseKey.condition)).toBe('1');
    expect(sourceFilters.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(1));
    expect(sourceSorts.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(1));
    expect(overlay.isDirty()).toBe(false);
    expect(updates).not.toHaveBeenCalled();

    // A clean reset compares the native BigInts with their cloned strings as equal.
    overlay.reset();
    expect(filters.get(0)).toBe(firstFilter);
    expect(sorts.get(0)).toBe(firstSort);

    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(viewConditionsYrsDelta, 'base64')), 'remote');
    expect(filters.get(0).get(YjsDatabaseKey.condition)).toBe('0');
    expect(sorts.get(0).get(YjsDatabaseKey.condition)).toBe('0');
    expect(overlay.isDirty()).toBe(false);

    filters.get(0).set(YjsDatabaseKey.condition, 1);
    overlay.reset();
    expect(filters.get(0).get(YjsDatabaseKey.condition)).toBe('0');
    expect(overlay.isDirty()).toBe(false);

    filters.get(0).set(YjsDatabaseKey.condition, 1);
    sorts.get(0).set(YjsDatabaseKey.condition, 1);
    expect(sourceFilters.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(0));
    expect(sourceSorts.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(0));
    overlay.commit();
    expect(sourceFilters.get(0).get(YjsDatabaseKey.condition)).toBe(1);
    expect(sourceSorts.get(0).get(YjsDatabaseKey.condition)).toBe(1);
    expect(overlay.isDirty()).toBe(false);

    getOrCreateDatabaseHistoryManager(doc).undo();
    expect(sourceFilters.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(0));
    expect(sourceSorts.get(0).get(YjsDatabaseKey.condition)).toBe(BigInt(0));
    expect(filters.get(0).get(YjsDatabaseKey.condition)).toBe('0');
    expect(sorts.get(0).get(YjsDatabaseKey.condition)).toBe('0');
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
