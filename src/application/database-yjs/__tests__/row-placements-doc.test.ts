import * as fs from 'fs';

import * as Y from 'yjs';

import {
  copyRowPlacements,
  isAnchoredView,
  moveRowInAnchoredView,
  placeRowInAnchoredView,
  readRowPlacements,
  repairAnchoredViewsBeforeRemoval,
  storageViewId,
  viewRowOrderEntries,
} from '@/application/database-yjs/row-placements-doc';
import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
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

const viewOf = (database: YDatabase, id: string) => database.get(YjsDatabaseKey.views).get(id) as YDatabaseView;
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
