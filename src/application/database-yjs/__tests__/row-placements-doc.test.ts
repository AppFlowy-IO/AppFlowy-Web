import * as fs from 'fs';

import * as Y from 'yjs';

import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import {
  convertAnchoredViewsToArray,
  copyRowPlacements,
  databaseOfView,
  fillDefaultOrder,
  isAnchoredView,
  moveRowInAnchoredView,
  observeViewRowOrders,
  placeRowInAnchoredView,
  readRowPlacements,
  reorderRowInAnchoredView,
  repairAnchoredViewsBeforeRemoval,
  setAnchoredViewOrder,
  showsDefaultOrder,
  storageRowOrders,
  storageViewId,
  viewMembershipRowOrders,
  viewRowOrderEntries,
  viewRowOrdersJSON,
} from '@/application/database-yjs/row-placements-doc';
import { YDatabase, YDatabaseView, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import documents from './__fixtures__/row_placement_documents.json';

// The documents were written by the server's implementation of anchored views
// (`libs/collab` in AppFlowy Cloud), with drags, a copied view, a row created at a position, a
// trashed row and a deleted row. Each lists the rows that implementation reads in every view.

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? []);

function open(state: string): { doc: Y.Doc; database: YDatabase } {
  const doc = new Y.Doc();

  Y.applyUpdate(doc, bytes(state));

  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  return { doc, database };
}

const viewOf = (database: YDatabase, id: string) => database.get(YjsDatabaseKey.views).get(id);
const ids = (rows: Array<{ id: string }> | undefined) => (rows ?? []).map((row) => row.id);

function shown(database: YDatabase, view: YDatabaseView): string[] {
  return ids(materializeVisibleRowOrders(viewRowOrderEntries(database, view), getInlineViewRowOrders(database)?.toArray()));
}

/** What a drag does to an order: forward lands right after the target, backward right before it. */
function arrayMove(order: string[], from: string, to: string): string[] {
  const moved = order.slice();
  const [row] = moved.splice(order.indexOf(from), 1);

  moved.splice(order.indexOf(to), 0, row);
  return moved;
}

function random(seed: number) {
  let state = seed;

  return (below: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % below;
  };
}

describe('anchored views in documents written by the server', () => {
  it('reads the rows of every view as the server does', () => {
    expect(documents.format).toBe(1);

    for (const item of documents.cases) {
      const { database } = open(item.state);

      expect(item.views[0].id).toBe(storageViewId(item.database_id));

      for (const expected of item.views) {
        const view = viewOf(database, expected.id);

        expect(isAnchoredView(view)).toBe(expected.anchored);
        expect(readRowPlacements(view).size).toBe(expected.placements);
        expect(ids(viewRowOrderEntries(database, view))).toEqual(expected.rows);
        expect(shown(database, view)).toEqual(expected.shown);
        // An anchored view lists no rows of its own.
        if (expected.anchored) expect(view.get(YjsDatabaseKey.row_orders).length).toBe(0);
      }
    }
  });
});

describe('writes to an anchored view', () => {
  const largest = documents.cases[documents.cases.length - 1];
  const [storage, array, anchored, copy] = largest.views;

  it('drags a row the way a drag in an array moves it', () => {
    const { doc, database } = open(largest.state);
    const view = viewOf(database, anchored.id);
    const next = random(7);
    let order = ids(viewRowOrderEntries(database, view));

    for (let step = 0; step < 80; step++) {
      const from = order[next(order.length)];
      const to = order[next(order.length)];

      doc.transact(() => {
        expect(moveRowInAnchoredView(database, view, from, to)).toBe(true);
      });
      order = arrayMove(order, from, to);
      expect(ids(viewRowOrderEntries(database, view))).toEqual(order);
    }

    // Nothing but placements was written: the view's own array is still empty, and the other
    // views are as they were.
    expect(view.get(YjsDatabaseKey.row_orders).length).toBe(0);
    expect(ids(viewRowOrderEntries(database, viewOf(database, array.id)))).toEqual(array.rows);
    expect(ids(viewRowOrderEntries(database, viewOf(database, copy.id)))).toEqual(copy.rows);
    doc.transact(() => {
      expect(moveRowInAnchoredView(database, view, order[0], 'not-a-row')).toBe(false);
    });
  });

  it('puts a row at a position', () => {
    const { doc, database } = open(largest.state);
    const view = viewOf(database, anchored.id);
    const order = ids(viewRowOrderEntries(database, view));
    const row = order[5];
    const others = order.filter((id) => id !== row);
    const place = (target: Parameters<typeof placeRowInAnchoredView>[3]) => {
      let written = false;

      doc.transact(() => {
        written = placeRowInAnchoredView(database, view, row, target);
      });
      return written;
    };

    place({ at: 'start' });
    expect(ids(viewRowOrderEntries(database, view))).toEqual([row, ...others]);
    place({ at: 'end' });
    expect(ids(viewRowOrderEntries(database, view))).toEqual([...others, row]);
    place({ at: 'before', row: others[3] });
    expect(ids(viewRowOrderEntries(database, view))).toEqual([...others.slice(0, 3), row, ...others.slice(3)]);
    place({ at: 'after', row: others[3] });
    expect(ids(viewRowOrderEntries(database, view))).toEqual([...others.slice(0, 4), row, ...others.slice(4)]);
    // Already there: nothing is written.
    expect(place({ at: 'after', row: others[3] })).toBe(false);
    // A target the view lacks means the end.
    place({ at: 'before', row: 'not-a-row' });
    expect(ids(viewRowOrderEntries(database, view))).toEqual([...others, row]);
  });

  it('keeps the other rows in place when rows are deleted for good', () => {
    const { doc, database } = open(largest.state);
    const view = viewOf(database, anchored.id);
    const before = ids(viewRowOrderEntries(database, view));
    // Rows that other rows are anchored at are the ones a repair matters for.
    const anchors = Array.from(readRowPlacements(view).values())
      .map((placement) => placement.anchor)
      .filter((anchor): anchor is string => anchor !== null);
    const removed = Array.from(new Set([...anchors.slice(0, 3), before[0]]));

    expect(removed.length).toBeGreaterThan(1);
    doc.transact(() => {
      repairAnchoredViewsBeforeRemoval(database, removed);
      [storage.id, array.id].forEach((id) => {
        const rows = viewOf(database, id).get(YjsDatabaseKey.row_orders);

        for (let index = rows.length - 1; index >= 0; index--) {
          if (removed.includes(rows.get(index).id)) rows.delete(index);
        }
      });
    });

    expect(ids(viewRowOrderEntries(database, view))).toEqual(before.filter((id) => !removed.includes(id)));
    removed.forEach((id) => expect(readRowPlacements(view).has(id)).toBe(false));
  });

  it('gives a copy of the view the same order', () => {
    const { doc, database } = open(largest.state);
    const source = viewOf(database, anchored.id);
    const target = new Y.Map() as YDatabaseView;

    doc.transact(() => {
      database.get(YjsDatabaseKey.views).set('copied-view', target);
      target.set(YjsDatabaseKey.database_id, largest.database_id);
      target.set(YjsDatabaseKey.row_orders, new Y.Array());
      copyRowPlacements(source, target);
    });

    expect(isAnchoredView(target)).toBe(true);
    expect(ids(viewRowOrderEntries(database, target))).toEqual(anchored.rows);
  });

  it('writes placements the server reads', () => {
    // Set ROW_PLACEMENT_INTEROP_OUT to a directory to export a document this client wrote,
    // with the order it shows, for the server's implementation to read.
    const { doc, database } = open(largest.state);
    const view = viewOf(database, anchored.id);
    const next = random(11);
    let order = ids(viewRowOrderEntries(database, view));

    for (let step = 0; step < 40; step++) {
      const from = order[next(order.length)];
      const to = order[next(order.length)];

      doc.transact(() => moveRowInAnchoredView(database, view, from, to));
      order = arrayMove(order, from, to);
    }

    doc.transact(() => placeRowInAnchoredView(database, view, order[2], { at: 'end' }));
    order = [...order.filter((id) => id !== order[2]), order[2]];
    expect(ids(viewRowOrderEntries(database, view))).toEqual(order);

    // The stored form is what the other implementations parse.
    view.get(YjsDatabaseKey.row_placements)?.forEach((value) => {
      expect(typeof value.a).toBe('string');
      expect(value.p).toBeInstanceOf(Uint8Array);
      expect(value.p[value.p.length - 1]).toBe(1);
    });

    const out = process.env.ROW_PLACEMENT_INTEROP_OUT;

    if (out) {
      fs.writeFileSync(`${out}/web-written.bin`, Y.encodeStateAsUpdate(doc));
      fs.writeFileSync(
        `${out}/web-written.json`,
        JSON.stringify({ database_id: largest.database_id, view_id: anchored.id, rows: order })
      );
    }
  });
});

describe('what the app reads and writes through the mode-aware helpers', () => {
  const largest = documents.cases[documents.cases.length - 1];
  const [storage, array, anchored, copy] = largest.views;

  it('reads a view in array mode exactly as its own array', () => {
    for (const item of documents.cases) {
      const { database } = open(item.state);

      for (const expected of item.views.filter((view) => !view.anchored)) {
        const view = viewOf(database, expected.id);
        const own = view.get(YjsDatabaseKey.row_orders);

        expect(viewRowOrdersJSON(database, view)).toEqual(own.toJSON());
        expect(viewRowOrderEntries(database, view)).toEqual(own.toArray());
        // Compared as a boolean: a failed comparison of two Yjs types cannot be printed.
        expect(viewMembershipRowOrders(database, view) === own).toBe(true);
      }
    }
  });

  it('names the rows of an anchored view by the storage view', () => {
    const { database } = open(largest.state);
    const view = viewOf(database, anchored.id);
    const stored = viewOf(database, storage.id).get(YjsDatabaseKey.row_orders);

    expect(databaseOfView(view) === database).toBe(true);
    expect(storageRowOrders(database, view) === stored).toBe(true);
    expect(viewMembershipRowOrders(database, view) === stored).toBe(true);
    expect(ids(viewRowOrdersJSON(database, view))).toEqual(anchored.rows);
    expect(ids(viewRowOrdersJSON(database, view)).slice().sort()).toEqual(ids(stored.toArray()).sort());
  });

  it('moves a row after another row the way the array move of a drag does', () => {
    const { doc, database } = open(largest.state);
    const view = viewOf(database, anchored.id);
    const next = random(23);
    let order = ids(viewRowOrderEntries(database, view));

    for (let step = 0; step < 80; step++) {
      const row = order[next(order.length)];
      const others = order.filter((id) => id !== row);
      // Every third move goes to the start, as a drop above the first row does.
      const previous = step % 3 === 0 ? undefined : others[next(others.length)];

      doc.transact(() => {
        expect(reorderRowInAnchoredView(database, view, row, previous)).toBe(true);
      });
      order =
        previous === undefined
          ? [row, ...others]
          : [...others.slice(0, others.indexOf(previous) + 1), row, ...others.slice(others.indexOf(previous) + 1)];
      expect(ids(viewRowOrderEntries(database, view))).toEqual(order);
    }

    expect(view.get(YjsDatabaseKey.row_orders).length).toBe(0);
    // A row the Database lacks before it means the start, as in the array move.
    doc.transact(() => reorderRowInAnchoredView(database, view, order[4], 'not-a-row'));
    expect(ids(viewRowOrderEntries(database, view))[0]).toBe(order[4]);
    doc.transact(() => {
      expect(reorderRowInAnchoredView(database, view, 'not-a-row', order[0])).toBe(false);
    });
  });

  it('gives an anchored view a whole order', () => {
    const { doc, database } = open(largest.state);
    const view = viewOf(database, anchored.id);
    const canonical = ids(viewOf(database, storage.id).get(YjsDatabaseKey.row_orders).toArray());
    const next = random(5);

    for (let round = 0; round < 40; round++) {
      const target = canonical.slice();

      for (let swap = 0; swap < 1 + next(30); swap++) {
        const left = next(target.length);
        const right = next(target.length);

        [target[left], target[right]] = [target[right], target[left]];
      }

      doc.transact(() => {
        expect(setAnchoredViewOrder(database, view, target)).toBe(true);
      });
      expect(ids(viewRowOrderEntries(database, view))).toEqual(target);
    }

    // Rows that are left out keep their canonical place; unknown and repeated ids are ignored.
    const listed = [canonical[6], canonical[2], 'not-a-row', canonical[6], canonical[4]];
    const expected = canonical.slice();

    expected[2] = canonical[6];
    expected[4] = canonical[2];
    expected[6] = canonical[4];
    doc.transact(() => setAnchoredViewOrder(database, view, listed));
    expect(ids(viewRowOrderEntries(database, view))).toEqual(expected);
    doc.transact(() => setAnchoredViewOrder(database, view, []));
    expect(ids(viewRowOrderEntries(database, view))).toEqual(canonical);
    expect(readRowPlacements(view).size).toBe(0);
    expect(view.get(YjsDatabaseKey.row_orders).length).toBe(0);
  });

  it('shows a row of an anchored view once when the storage view lists it twice', () => {
    const { doc, database } = open(largest.state);
    const view = viewOf(database, anchored.id);
    const stored = viewOf(database, storage.id).get(YjsDatabaseKey.row_orders);
    const repeated = (stored.toArray() as Array<{ id: string; height: number }>).slice(0, 2);

    doc.transact(() => {
      stored.push(repeated.map((row) => ({ ...row })));
    });

    expect(ids(stored.toArray())).toHaveLength(storage.rows.length + 2);
    // The first entry of an id is the row's place; the repeated entries add nothing.
    expect(ids(viewRowOrderEntries(database, view))).toEqual(anchored.rows);
    expect(ids(viewRowOrdersJSON(database, view))).toEqual(anchored.rows);
  });

  it('reads a storage view without a row list as a Database without rows', () => {
    const { doc, database } = open(largest.state);
    const view = viewOf(database, anchored.id);
    const anchoredViews = largest.views.filter((item) => item.anchored).length;

    doc.transact(() => {
      (viewOf(database, storage.id) as unknown as Y.Map<unknown>).delete(YjsDatabaseKey.row_orders);
      // What a client that knows nothing of placements writes when it creates a row.
      view.get(YjsDatabaseKey.row_orders).push([{ id: 'left-by-an-older-client', height: 60 }]);
    });

    expect(storageRowOrders(database, view)).toBeUndefined();
    expect(viewMembershipRowOrders(database, view)).toBeUndefined();
    expect(viewRowOrderEntries(database, view)).toEqual([]);
    expect(viewRowOrdersJSON(database, view)).toEqual([]);

    doc.transact(() => {
      expect(convertAnchoredViewsToArray(database)).toBe(anchoredViews);
    });
    expect(isAnchoredView(view)).toBe(false);
    expect(view.get(YjsDatabaseKey.row_orders).toArray()).toEqual([]);
  });

  it('rewrites a copy of the Database in array mode with the same rows in every view', () => {
    for (const item of documents.cases) {
      const { doc, database } = open(item.state);
      const anchoredViews = item.views.filter((view) => view.anchored).length;

      doc.transact(() => {
        expect(convertAnchoredViewsToArray(database)).toBe(anchoredViews);
      });

      for (const expected of item.views) {
        const view = viewOf(database, expected.id);

        expect(isAnchoredView(view)).toBe(false);
        expect(view.has(YjsDatabaseKey.row_placements)).toBe(false);
        // What a client that knows nothing of placements reads.
        expect(ids(view.get(YjsDatabaseKey.row_orders).toArray())).toEqual(expected.rows);
        expect(shown(database, view)).toEqual(expected.shown);
      }

      doc.transact(() => {
        expect(convertAnchoredViewsToArray(database)).toBe(0);
      });
    }
  });

  it('reports each change of an anchored view once, and follows a change of mode', () => {
    const { doc, database } = open(largest.state);
    const view = viewOf(database, anchored.id);
    const stored = viewOf(database, storage.id).get(YjsDatabaseKey.row_orders);
    const order = ids(viewRowOrderEntries(database, view));
    let calls = 0;
    const stop = observeViewRowOrders(database, view, () => {
      calls += 1;
    });
    const expectCalls = (expected: number, change: () => void) => {
      calls = 0;
      doc.transact(change);
      expect(calls).toBe(expected);
    };

    // A drag in the view.
    expectCalls(1, () => moveRowInAnchoredView(database, view, order[0], order[5]));
    // A row that joins the Database, and a delete with its repair, in one transaction each.
    expectCalls(1, () => stored.push([{ id: 'ffffffff-0000-4000-8000-000000000001', height: 60 }]));
    expectCalls(1, () => {
      repairAnchoredViewsBeforeRemoval(database, [order[5]]);
      stored.delete(
        ids(stored.toArray()).indexOf(order[5]),
        1
      );
    });
    // A change of another view, or of this view's name, is not a row change.
    expectCalls(0, () => viewOf(database, array.id).get(YjsDatabaseKey.row_orders).delete(0, 1));
    expectCalls(0, () => view.set(YjsDatabaseKey.name, 'renamed'));
    // The view turns into an array view: one call, and from then on its own array counts.
    expectCalls(1, () => convertAnchoredViewsToArray(database));
    expectCalls(1, () => view.get(YjsDatabaseKey.row_orders).delete(0, 1));
    expectCalls(0, () => stored.push([{ id: 'ffffffff-0000-4000-8000-000000000002', height: 60 }]));

    stop();
    expectCalls(0, () => view.get(YjsDatabaseKey.row_orders).delete(0, 1));
    expect(copy.anchored).toBe(true);
  });
});

describe('a view in array mode without rows of its own', () => {
  const largest = documents.cases[documents.cases.length - 1];
  const [storage, array, anchored] = largest.views;

  /** Opens the largest document and takes the rows of its view in array mode away. */
  function openWithoutRows(kind: 'an empty list' | 'no list') {
    const { doc, database } = open(largest.state);
    const view = viewOf(database, array.id);

    doc.transact(() => {
      const own = view.get(YjsDatabaseKey.row_orders);

      if (kind === 'an empty list') own.delete(0, own.length);
      else (view as unknown as Y.Map<unknown>).delete(YjsDatabaseKey.row_orders);
    });

    return { doc, database, view, stored: viewOf(database, storage.id).get(YjsDatabaseKey.row_orders) };
  }

  it.each(['an empty list', 'no list'] as const)('shows the default order with %s', (kind) => {
    const { database, view, stored } = openWithoutRows(kind);

    expect(showsDefaultOrder(database, view)).toBe(true);
    expect(isAnchoredView(view)).toBe(false);
    // The rows of the storage view, in its order, with its trash flags.
    expect(ids(viewRowOrderEntries(database, view))).toEqual(storage.rows);
    expect(ids(viewRowOrdersJSON(database, view))).toEqual(storage.rows);
    expect(shown(database, view)).toEqual(storage.shown);
    expect(viewMembershipRowOrders(database, view) === stored).toBe(true);

    // Only a view in array mode that lists nothing is read this way.
    expect(showsDefaultOrder(database, viewOf(database, storage.id))).toBe(false);
    expect(showsDefaultOrder(database, viewOf(database, anchored.id))).toBe(false);
    expect(ids(viewRowOrderEntries(database, viewOf(database, anchored.id)))).toEqual(anchored.rows);
  });

  it('is not the default order while the view lists rows', () => {
    for (const item of documents.cases) {
      const { database } = open(item.state);

      for (const expected of item.views) {
        const view = viewOf(database, expected.id);
        const own = view.get(YjsDatabaseKey.row_orders);

        expect(showsDefaultOrder(database, view)).toBe(
          !expected.anchored && expected.id !== storageViewId(item.database_id) && own.length === 0
        );
      }
    }
  });

  it('never reads the storage view this way, also when its flag is gone', () => {
    const { doc, database } = open(largest.state);
    const view = viewOf(database, storage.id);

    // The storage view is told by its id. A damaged one can lack the flag and the rows.
    doc.transact(() => {
      const own = view.get(YjsDatabaseKey.row_orders);

      own.delete(0, own.length);
      (view as unknown as Y.Map<unknown>).delete(YjsDatabaseKey.is_inline);
    });

    expect(showsDefaultOrder(database, view)).toBe(false);
    expect(viewRowOrderEntries(database, view)).toEqual([]);
    doc.transact(() => {
      expect(fillDefaultOrder(database, view)).toBe(0);
    });
  });

  it('stays as it is in a legacy Database, which has no storage view', () => {
    const doc = new Y.Doc();
    const views = new Y.Map<YDatabaseView>();
    const databaseId = '9d8a1b3e-0c1f-4a2b-8c3d-1e2f3a4b5c6d';
    const view = (id: string, rows: string[], inline: boolean) => {
      const created = new Y.Map<unknown>();
      const orders = new Y.Array<unknown>();

      orders.push(rows.map((rowId) => ({ id: rowId, height: 60 })));
      created.set(YjsDatabaseKey.id, id);
      created.set(YjsDatabaseKey.database_id, databaseId);
      created.set(YjsDatabaseKey.is_inline, inline);
      created.set(YjsDatabaseKey.row_orders, orders);
      views.set(id, created as unknown as YDatabaseView);
    };
    const database = new Y.Map<unknown>();

    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.views, views);
    // The canonical view of a legacy Database is one of its tabs, under an id of its own.
    view('11111111-1111-4111-8111-111111111111', ['a', 'b', 'c'], true);
    view('22222222-2222-4222-8222-222222222222', [], false);

    const typed = database as unknown as YDatabase;
    const empty = viewOf(typed, '22222222-2222-4222-8222-222222222222');

    expect(showsDefaultOrder(typed, empty)).toBe(false);
    expect(viewRowOrderEntries(typed, empty)).toEqual([]);
    expect(viewRowOrdersJSON(typed, empty)).toEqual([]);
    expect(viewMembershipRowOrders(typed, empty) === empty.get(YjsDatabaseKey.row_orders)).toBe(true);
  });

  it.each(['an empty list', 'no list'] as const)('gets its list before a drag, starting with %s', (kind) => {
    const { doc, database, view } = openWithoutRows(kind);

    doc.transact(() => {
      // Above the limit nothing is written.
      expect(fillDefaultOrder(database, view, storage.rows.length - 1)).toBe(0);
    });
    expect(showsDefaultOrder(database, view)).toBe(true);

    doc.transact(() => {
      expect(fillDefaultOrder(database, view)).toBe(storage.rows.length);
    });
    expect(showsDefaultOrder(database, view)).toBe(false);
    // What a client that knows nothing of this reads: every row, in the default order.
    expect(ids(view.get(YjsDatabaseKey.row_orders).toArray())).toEqual(storage.rows);
    expect(shown(database, view)).toEqual(storage.shown);

    doc.transact(() => {
      expect(fillDefaultOrder(database, view)).toBe(0);
      expect(fillDefaultOrder(database, viewOf(database, anchored.id))).toBe(0);
      expect(fillDefaultOrder(database, viewOf(database, storage.id))).toBe(0);
    });
    expect(view.get(YjsDatabaseKey.row_orders).length).toBe(storage.rows.length);
  });

  it('gets its list in a copy of the Database for readers of any age', () => {
    const { doc, database, view } = openWithoutRows('an empty list');
    const anchoredViews = largest.views.filter((item) => item.anchored).length;

    doc.transact(() => {
      expect(convertAnchoredViewsToArray(database)).toBe(anchoredViews + 1);
    });
    expect(ids(view.get(YjsDatabaseKey.row_orders).toArray())).toEqual(storage.rows);
    doc.transact(() => {
      expect(convertAnchoredViewsToArray(database)).toBe(0);
    });
  });

  it('follows the storage view while it shows the default order', () => {
    const { doc, database, view, stored } = openWithoutRows('an empty list');
    let calls = 0;
    const stop = observeViewRowOrders(database, view, () => {
      calls += 1;
    });
    const expectCalls = (expected: number, change: () => void) => {
      calls = 0;
      doc.transact(change);
      expect(calls).toBe(expected);
    };
    const row = (n: number) => ({ id: `ffffffff-0000-4000-8000-00000000000${n}`, height: 60 });

    // A row that joins the Database shows in the view.
    expectCalls(1, () => stored.push([row(1)]));
    expect(ids(viewRowOrderEntries(database, view))).toEqual([...storage.rows, row(1).id]);
    // The view gets its list: one call, and from then on its own list counts.
    expectCalls(1, () => fillDefaultOrder(database, view));
    expectCalls(0, () => stored.push([row(2)]));
    expectCalls(1, () => view.get(YjsDatabaseKey.row_orders).push([row(2)]));
    // It loses its rows again, and follows the storage view again.
    expectCalls(1, () => {
      const own = view.get(YjsDatabaseKey.row_orders);

      own.delete(0, own.length);
    });
    expectCalls(1, () => stored.push([row(3)]));
    expect(ids(viewRowOrderEntries(database, view))).toEqual([...storage.rows, row(1).id, row(2).id, row(3).id]);

    stop();
    expectCalls(0, () => stored.push([row(4)]));
  });
});
