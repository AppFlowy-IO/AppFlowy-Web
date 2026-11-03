import { act, renderHook } from '@testing-library/react';
import { createElement, ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, DatabaseViewOverlayContext } from '@/application/database-yjs/context';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { useMoveFilter } from '@/application/database-yjs/dispatch/sort-filter';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import { createViewConditionsOverlay } from '@/application/database-yjs/view-conditions-overlay';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function filterMap(id: string, content: string) {
  const map = new Y.Map<unknown>();

  map.set(YjsDatabaseKey.id, id);
  map.set(YjsDatabaseKey.filter_type, FilterType.Data);
  map.set(YjsDatabaseKey.field_id, 'stage');
  map.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  // Native clients store enums as bigints; the copy must still insert.
  map.set(YjsDatabaseKey.condition, 0);
  map.set(YjsDatabaseKey.content, content);
  return map;
}

function createDatabase() {
  const doc = new Y.Doc({ guid: 'db' }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const filters = new Y.Array<unknown>();

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.id, 'db');
  database.set(YjsDatabaseKey.fields, new Y.Map() as never);
  database.set(YjsDatabaseKey.views, views as never);
  views.set('v1', view);
  view.set(YjsDatabaseKey.filters, filters as never);
  view.set(YjsDatabaseKey.sorts, new Y.Array() as never);
  filters.push([filterMap('a', 'one'), filterMap('b', 'two'), filterMap('c', 'three')]);
  getOrCreateDatabaseHistoryManager(doc);
  return { doc, view, filters };
}

function wrapper(doc: YDoc, overlayView?: YDatabaseView) {
  const context: DatabaseContextState = {
    databaseDoc: doc,
    databasePageId: 'v1',
    activeViewId: 'v1',
    readOnly: false,
    rowMap: {},
    workspaceId: 'workspace',
  };

  return ({ children }: { children: ReactNode }) =>
    createElement(
      DatabaseContext.Provider,
      { value: context },
      createElement(DatabaseViewOverlayContext.Provider, { value: overlayView }, children)
    );
}

const ids = (array: Y.Array<unknown>) => (array.toJSON() as { id: string }[]).map((filter) => filter.id);

describe('useMoveFilter (WP07 R7)', () => {
  it('useMoveFilter reorders top-level filters in the overlay and in the real view', () => {
    const { doc, view, filters } = createDatabase();
    const overlay = createViewConditionsOverlay(view);
    const { result: privateMove } = renderHook(() => useMoveFilter(), { wrapper: wrapper(doc, overlay.view) });
    const local = overlay.view.get(YjsDatabaseKey.filters) as Y.Array<unknown>;

    act(() => privateMove.current('a', 2));
    expect(ids(local)).toEqual(['b', 'c', 'a']);
    // The real view is untouched, and a pure reorder is not a private change.
    expect(ids(filters)).toEqual(['a', 'b', 'c']);
    expect(overlay.isDirty()).toBe(false);

    const { result: savedMove } = renderHook(() => useMoveFilter(), { wrapper: wrapper(doc) });

    act(() => savedMove.current('c', 0));
    expect(ids(filters)).toEqual(['c', 'a', 'b']);
    expect((filters.get(0) as Y.Map<unknown>).get(YjsDatabaseKey.content)).toBe('three');
    // One undoable step.
    act(() => {
      getOrCreateDatabaseHistoryManager(doc).undo();
    });
    expect(ids(filters)).toEqual(['a', 'b', 'c']);
    overlay.destroy();
  });

  it('clamps the target index and ignores an unknown filter or a no-op move', () => {
    const { doc, filters } = createDatabase();
    const { result } = renderHook(() => useMoveFilter(), { wrapper: wrapper(doc) });
    const updates = jest.fn();

    doc.on('update', updates);
    act(() => result.current('missing', 0));
    act(() => result.current('b', 1));
    expect(updates).not.toHaveBeenCalled();
    act(() => result.current('a', 99));
    expect(ids(filters)).toEqual(['b', 'c', 'a']);
  });
});
