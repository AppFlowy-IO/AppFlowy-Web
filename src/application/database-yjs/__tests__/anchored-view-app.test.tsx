import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, useRowOrdersSelector } from '@/application/database-yjs';
import { copyDatabaseViewConfiguration } from '@/application/database-yjs/database-view-doc-ops';
import { useBulkDeleteRowDispatch, useDeleteRowDispatch, useReorderRowDispatch } from '@/application/database-yjs/dispatch';
import {
  useBulkDeleteRowDispatch as useBulkDeleteRowDispatchModule,
  useReorderRowDispatch as useReorderRowDispatchModule,
} from '@/application/database-yjs/dispatch/row';
import { isRowOrderTombstoned, removeRowsFromDatabase } from '@/application/database-yjs/dispatch/row-lifecycle';
import { getRelationRowOrders } from '@/application/database-yjs/relation/row-orders';
import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import {
  databaseOfView,
  isAnchoredView,
  readRowPlacements,
  showsDefaultOrder,
  viewRowOrderEntries,
} from '@/application/database-yjs/row-placements-doc';
import { hasCurrentRowDocumentSource } from '@/application/row-document/row-source-readiness';
import { YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import { useRowPeekRowDeletion } from '@/components/database/row-peek/useRowPeekRowDeletion';

import documents from './__fixtures__/row_placement_documents.json';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/application/sync-outbox', () => ({
  deleteOutboxByObjectId: jest.fn().mockResolvedValue(undefined),
}));

// The documents were written by the server's implementation of anchored views. The largest has
// a storage view, a view in array mode, an anchored view with dragged rows and a copy of it.
const largest = documents.cases[documents.cases.length - 1];
const [storage, array, anchored, copy] = largest.views;

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? []);
const ids = (rows: Array<{ id: string }> | undefined) => (rows ?? []).map((row) => row.id);

function open() {
  const doc = new Y.Doc() as unknown as YDoc;

  Y.applyUpdate(doc, bytes(largest.state));

  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = sharedRoot.get(YjsEditorKey.database);
  const viewOf = (id: string) => database.get(YjsDatabaseKey.views).get(id);
  const shown = (id: string) =>
    ids(materializeVisibleRowOrders(viewRowOrderEntries(database, viewOf(id)), getInlineViewRowOrders(database)?.toArray()));

  return { doc, sharedRoot, database, viewOf, shown };
}

function wrapperFor(doc: YDoc, viewId: string) {
  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc: doc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap: {},
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('an anchored view in the app', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is the fixture this test expects', () => {
    expect(storage.anchored).toBe(false);
    expect(array.anchored).toBe(false);
    expect(anchored.anchored).toBe(true);
    expect(anchored.placements).toBeGreaterThan(0);
    expect(anchored.shown).not.toEqual(storage.shown);
  });

  it('shows its rows in placement order and follows drags, new rows and deletes', () => {
    const { doc, database, viewOf, shown } = open();
    const view = renderHook(
      () => ({
        rows: useRowOrdersSelector(),
        reorder: useReorderRowDispatch(),
        reorderModule: useReorderRowDispatchModule(),
        remove: useDeleteRowDispatch(),
        removeMany: useBulkDeleteRowDispatch(),
        removeManyModule: useBulkDeleteRowDispatchModule(),
      }),
      { wrapper: wrapperFor(doc, anchored.id) }
    );
    const rows = () => ids(view.result.current.rows);
    const settle = () => act(() => void jest.advanceTimersByTime(500));

    settle();
    expect(rows()).toEqual(anchored.shown);

    // A drag below another row, through both copies of the hook the app has.
    let expected = anchored.shown.slice();
    const drag = (reorder: (rowId: string, beforeRowId?: string) => void, row: string, previous?: string) => {
      act(() => reorder(row, previous));
      settle();

      const others = expected.filter((id) => id !== row);

      expected =
        previous === undefined
          ? [row, ...others]
          : [...others.slice(0, others.indexOf(previous) + 1), row, ...others.slice(others.indexOf(previous) + 1)];
      expect(rows()).toEqual(expected);
    };

    drag(view.result.current.reorder, expected[0], expected[7]);
    drag(view.result.current.reorderModule, expected[12], expected[2]);
    drag(view.result.current.reorder, expected[9]);
    // Nothing but placements was written.
    expect(viewOf(anchored.id).get(YjsDatabaseKey.row_orders).length).toBe(0);
    expect(shown(array.id)).toEqual(array.shown);
    expect(shown(copy.id)).toEqual(copy.shown);

    // A row another client adds to the Database shows at its canonical place: the end.
    const added = 'ffffffff-0000-4000-8000-0000000000aa';

    act(() => {
      doc.transact(() => {
        [storage.id, array.id].forEach((id) =>
          viewOf(id)
            .get(YjsDatabaseKey.row_orders)
            .push([{ id: added, height: 60 }])
        );
      }, 'remote');
    });
    settle();
    expected = [...expected, added];
    expect(rows()).toEqual(expected);

    // Deleting rows for good, among them rows that other rows were dragged next to, keeps
    // every other row where it is.
    const anchors = Array.from(readRowPlacements(viewOf(anchored.id)).values())
      .map((placement) => placement.anchor)
      .filter((anchor): anchor is string => anchor !== null && expected.includes(anchor));

    expect(anchors.length).toBeGreaterThan(2);

    const removeAndCheck = (remove: () => void, removed: string[]) => {
      act(remove);
      settle();
      expected = expected.filter((id) => !removed.includes(id));
      expect(rows()).toEqual(expected);
      removed.forEach((id) => expect(readRowPlacements(viewOf(anchored.id)).has(id)).toBe(false));
      expect(shown(array.id)).toEqual(array.shown.filter((id) => expected.includes(id)).concat(added));
    };

    removeAndCheck(() => view.result.current.remove(anchors[0]), [anchors[0]]);
    removeAndCheck(() => view.result.current.removeMany([anchors[1], expected[0]]), [anchors[1], expected[0]]);
    removeAndCheck(() => view.result.current.removeManyModule([anchors[2]]), [anchors[2]]);
    expect(isAnchoredView(viewOf(anchored.id))).toBe(true);
    expect(database.get(YjsDatabaseKey.views).size).toBe(largest.views.length);
  });

  // The app has two copies of the drag hook. Each has to give the view its list, so each gets
  // the first drag once.
  it.each([
    ['the hook of dispatch.ts', false],
    ['the hook of dispatch/row.ts', true],
  ])('shows the rows of the Database in a view that lost its own, and moves a row there with %s', (_name, moduleFirst) => {
    const { doc, viewOf, shown } = open();

    // The view in array mode loses the rows of its own, as damage or a race leaves it.
    doc.transact(() => {
      const own = viewOf(array.id).get(YjsDatabaseKey.row_orders);

      own.delete(0, own.length);
    });

    const view = renderHook(
      () => ({
        rows: useRowOrdersSelector(),
        reorder: useReorderRowDispatch(),
        reorderModule: useReorderRowDispatchModule(),
      }),
      { wrapper: wrapperFor(doc, array.id) }
    );
    const rows = () => ids(view.result.current.rows);
    const settle = () => act(() => void jest.advanceTimersByTime(500));

    settle();
    // The default order: the storage view's rows, without the one in the trash.
    expect(rows()).toEqual(storage.shown);
    expect(showsDefaultOrder(databaseOfView(viewOf(array.id)), viewOf(array.id))).toBe(true);

    // A row that joins the Database shows in the view, which still lists nothing.
    const added = 'ffffffff-0000-4000-8000-0000000000bb';
    let expected = [...storage.shown, added];

    act(() => {
      doc.transact(() => {
        viewOf(storage.id)
          .get(YjsDatabaseKey.row_orders)
          .push([{ id: added, height: 60 }]);
      }, 'remote');
    });
    settle();
    expect(rows()).toEqual(expected);
    expect(viewOf(array.id).get(YjsDatabaseKey.row_orders).length).toBe(0);

    // A drag writes the default order into the view, then moves the row, through both copies of
    // the hook the app has.
    const drag = (reorder: (rowId: string, beforeRowId?: string) => void, row: string, previous?: string) => {
      act(() => reorder(row, previous));
      settle();

      const others = expected.filter((id) => id !== row);

      expected =
        previous === undefined
          ? [row, ...others]
          : [...others.slice(0, others.indexOf(previous) + 1), row, ...others.slice(others.indexOf(previous) + 1)];
      expect(rows()).toEqual(expected);
    };

    const [first, second] = moduleFirst
      ? [view.result.current.reorderModule, view.result.current.reorder]
      : [view.result.current.reorder, view.result.current.reorderModule];

    drag(first, expected[6], expected[1]);
    // The view lists every row of the Database itself now, the trashed one included, so a client
    // that knows nothing of the default order reads the same.
    expect(viewOf(array.id).get(YjsDatabaseKey.row_orders).length).toBe(storage.rows.length + 1);
    expect(shown(array.id)).toEqual(expected);
    drag(second, expected[10]);
    expect(viewOf(array.id).get(YjsDatabaseKey.row_orders).length).toBe(storage.rows.length + 1);
    // No other view changed.
    expect(shown(anchored.id)).toEqual([...anchored.shown, added]);
    expect(shown(storage.id)).toEqual([...storage.shown, added]);
  });

  it('deletes rows from the trash flow and reads the trash flag of a row', () => {
    const { sharedRoot, database, viewOf, shown } = open();
    const trashed = anchored.rows.find((id) => !anchored.shown.includes(id));
    const anchors = Array.from(readRowPlacements(viewOf(anchored.id)).values())
      .map((placement) => placement.anchor)
      .filter((anchor): anchor is string => anchor !== null);

    expect(trashed).toBeDefined();
    expect(isRowOrderTombstoned(database, anchored.id, trashed as string)).toBe(true);
    expect(isRowOrderTombstoned(database, anchored.id, anchored.shown[0])).toBe(false);
    expect(isRowOrderTombstoned(database, array.id, trashed as string)).toBe(
      Boolean(
        viewOf(array.id)
          .get(YjsDatabaseKey.row_orders)
          .toArray()
          .find((row) => row.id === trashed)?.is_deleted
      )
    );

    removeRowsFromDatabase(sharedRoot, database, [anchors[0], trashed as string], { cleanupLocalCollab: false });
    expect(shown(anchored.id)).toEqual(anchored.shown.filter((id) => id !== anchors[0]));
    expect(ids(viewRowOrderEntries(database, viewOf(anchored.id)))).not.toContain(trashed);
  });

  it('copies the order of a view into an anchored view and into an array view', () => {
    const { doc, database, viewOf, shown } = open();
    const canonical = getInlineViewRowOrders(database);
    const addView = (id: string, isAnchored: boolean) => {
      const view = new Y.Map() as YDatabaseView;

      doc.transact(() => {
        database.get(YjsDatabaseKey.views).set(id, view);
        view.set(YjsDatabaseKey.id, id);
        view.set(YjsDatabaseKey.database_id, largest.database_id);
        view.set(YjsDatabaseKey.row_orders, new Y.Array());
        if (isAnchored) (view as unknown as Y.Map<unknown>).set(YjsDatabaseKey.row_placements, new Y.Map());
      });
      return view;
    };

    // The four pairs a duplicate can meet while a workspace holds views of both modes.
    const pairs: Array<[string, boolean]> = [
      [anchored.id, true],
      [anchored.id, false],
      [array.id, true],
      [array.id, false],
    ];

    pairs.forEach(([sourceId, targetAnchored], index) => {
      const target = addView(`copy-${index}`, targetAnchored);

      doc.transact(() => copyDatabaseViewConfiguration(viewOf(sourceId), target, canonical));
      expect(isAnchoredView(target)).toBe(targetAnchored);
      expect(shown(`copy-${index}`)).toEqual(shown(sourceId));
      // An anchored copy lists no rows of its own.
      if (targetAnchored) expect(target.get(YjsDatabaseKey.row_orders).length).toBe(0);
    });
  });

  it('closes a row peek opened from an anchored view when its row is deleted', () => {
    const { doc, database, viewOf } = open();
    const open_ = anchored.shown[3];
    const onDeleted = jest.fn();

    renderHook(() => useRowPeekRowDeletion(database, viewOf(anchored.id), open_, onDeleted));
    // Another row leaving, or a drag, does not close it.
    act(() => removeRowsFromDatabase(doc.getMap(YjsEditorKey.data_section) as YSharedRoot, database, [anchored.shown[8]], {
      cleanupLocalCollab: false,
    }));
    expect(onDeleted).not.toHaveBeenCalled();
    act(() => removeRowsFromDatabase(doc.getMap(YjsEditorKey.data_section) as YSharedRoot, database, [open_], {
      cleanupLocalCollab: false,
    }));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('finds the source of a row page that was opened from an anchored view', () => {
    const { database } = open();
    const root = database as unknown as Y.Map<unknown>;
    const trashed = anchored.rows.find((id) => !anchored.shown.includes(id)) as string;

    expect(hasCurrentRowDocumentSource(root, anchored.id, anchored.shown[2])).toBe(true);
    expect(hasCurrentRowDocumentSource(root, array.id, array.shown[2])).toBe(true);
    // A trashed row and a row the Database lacks have no current source.
    expect(hasCurrentRowDocumentSource(root, anchored.id, trashed)).toBe(false);
    expect(hasCurrentRowDocumentSource(root, anchored.id, 'ffffffff-0000-4000-8000-0000000000bb')).toBe(false);
  });

  it('offers the rows of the Database to a relation that names an anchored view', () => {
    const { database, viewOf } = open();
    const stored = viewOf(storage.id).get(YjsDatabaseKey.row_orders);

    // Compared as booleans: a failed comparison of two Yjs types cannot be printed.
    expect(getRelationRowOrders(database, anchored.id) === stored).toBe(true);
    expect(getRelationRowOrders(database, array.id) === viewOf(array.id).get(YjsDatabaseKey.row_orders)).toBe(true);
  });
});
