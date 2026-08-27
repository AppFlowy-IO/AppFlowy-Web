import * as Y from 'yjs';

import { getInlineViewRowOrders, materializeVisibleRowOrders } from '@/application/database-yjs/row-order-visibility';
import {
  YDatabase,
  YDatabaseMetas,
  YDatabaseRowOrders,
  YDatabaseView,
  YDatabaseViews,
  YjsDatabaseKey,
} from '@/application/types';

describe('materializeVisibleRowOrders', () => {
  it('uses inline tombstones without intersecting linked-view membership', () => {
    const linkedRows = [
      { id: 'shared-row', height: 36 },
      { id: 'linked-only-row', height: 36 },
    ];
    const inlineRows = [{ id: 'shared-row', height: 36, is_deleted: true }];

    expect(materializeVisibleRowOrders(linkedRows, inlineRows)).toEqual([{ id: 'linked-only-row', height: 36 }]);
  });

  it('uses an active inline row to override a stale linked-view tombstone', () => {
    const linkedRows = [{ id: 'row-id', height: 36, is_deleted: true }];
    const inlineRows = [{ id: 'row-id', height: 36 }];

    expect(materializeVisibleRowOrders(linkedRows, inlineRows)).toEqual([
      { id: 'row-id', height: 36, is_deleted: false },
    ]);
  });

  it('collapses duplicate visible IDs while preserving first position and last value', () => {
    const linkedRows = [
      { id: 'row-a', height: 36 },
      { id: 'row-b', height: 36 },
      { id: 'row-a', height: 72 },
    ];

    expect(materializeVisibleRowOrders(linkedRows)).toEqual([
      { id: 'row-a', height: 72 },
      { id: 'row-b', height: 36 },
    ]);
  });
});

describe('getInlineViewRowOrders', () => {
  it('prefers the inline view ID stored in database metadata', () => {
    const doc = new Y.Doc();
    const database = new Y.Map() as YDatabase;
    const views = new Y.Map() as YDatabaseViews;
    const metas = new Y.Map() as YDatabaseMetas;
    const metadataView = new Y.Map() as YDatabaseView;
    const metadataRows = new Y.Array() as YDatabaseRowOrders;
    const flaggedView = new Y.Map() as YDatabaseView;
    const flaggedRows = new Y.Array() as YDatabaseRowOrders;

    metadataView.set(YjsDatabaseKey.row_orders, metadataRows);
    flaggedView.set(YjsDatabaseKey.is_inline, true);
    flaggedView.set(YjsDatabaseKey.row_orders, flaggedRows);
    views.set('metadata-inline-view', metadataView);
    views.set('flagged-inline-view', flaggedView);
    metas.set(YjsDatabaseKey.iid, 'metadata-inline-view');
    database.set(YjsDatabaseKey.views, views);
    database.set(YjsDatabaseKey.metas, metas);
    doc.getMap('root').set('database', database);

    expect(getInlineViewRowOrders(database)).toBe(metadataRows);
  });

  it('falls back to the inline flag when metadata is unavailable', () => {
    const doc = new Y.Doc();
    const database = new Y.Map() as YDatabase;
    const views = new Y.Map() as YDatabaseViews;
    const inlineView = new Y.Map() as YDatabaseView;
    const inlineRows = new Y.Array() as YDatabaseRowOrders;

    inlineView.set(YjsDatabaseKey.is_inline, true);
    inlineView.set(YjsDatabaseKey.row_orders, inlineRows);
    views.set('inline-view', inlineView);
    database.set(YjsDatabaseKey.views, views);
    doc.getMap('root').set('database', database);

    expect(getInlineViewRowOrders(database)).toBe(inlineRows);
  });
});
