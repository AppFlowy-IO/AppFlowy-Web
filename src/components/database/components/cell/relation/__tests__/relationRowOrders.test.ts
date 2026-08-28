import { describe, expect, it } from '@jest/globals';
import * as Y from 'yjs';

import { YDatabase, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { getLiveDatabaseRowIds, getLiveRelationRowIds } from '../relationRowOrders';

describe('getLiveRelationRowIds', () => {
  it('excludes tombstoned rows from relation picker candidates', () => {
    expect(
      getLiveRelationRowIds([{ id: 'row-1' }, { id: 'row-2', is_deleted: true }, { id: 'row-3', is_deleted: false }])
    ).toEqual(['row-1', 'row-3']);
  });

  it('unions live membership across database views', () => {
    const doc = new Y.Doc();
    const database = new Y.Map() as YDatabase;
    const views = new Y.Map();
    const firstView = new Y.Map();
    const secondView = new Y.Map();
    const firstRowOrders = new Y.Array<{ id: string; is_deleted?: boolean }>();
    const secondRowOrders = new Y.Array<{ id: string; is_deleted?: boolean }>();

    firstRowOrders.push([{ id: 'row-1' }, { id: 'row-2', is_deleted: true }]);
    secondRowOrders.push([{ id: 'row-2' }, { id: 'row-3' }]);
    firstView.set(YjsDatabaseKey.row_orders, firstRowOrders);
    secondView.set(YjsDatabaseKey.row_orders, secondRowOrders);
    views.set('view-1', firstView);
    views.set('view-2', secondView);
    database.set(YjsDatabaseKey.views, views);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

    expect(getLiveDatabaseRowIds(database)).toEqual(['row-1', 'row-2', 'row-3']);
  });

  it('uses inline tombstones canonically while retaining linked-only rows', () => {
    const doc = new Y.Doc();
    const database = new Y.Map() as YDatabase;
    const views = new Y.Map();
    const metas = new Y.Map();
    const inlineView = new Y.Map();
    const linkedView = new Y.Map();
    const inlineRowOrders = new Y.Array<{ id: string; is_deleted?: boolean }>();
    const linkedRowOrders = new Y.Array<{ id: string; is_deleted?: boolean }>();

    inlineRowOrders.push([{ id: 'row-live' }, { id: 'row-canonically-deleted', is_deleted: true }]);
    linkedRowOrders.push([
      { id: 'row-linked-only' },
      { id: 'row-canonically-deleted' },
      { id: 'row-live', is_deleted: true },
    ]);
    inlineView.set(YjsDatabaseKey.row_orders, inlineRowOrders);
    linkedView.set(YjsDatabaseKey.row_orders, linkedRowOrders);
    views.set('inline-view', inlineView);
    views.set('linked-view', linkedView);
    metas.set(YjsDatabaseKey.iid, 'inline-view');
    database.set(YjsDatabaseKey.metas, metas);
    database.set(YjsDatabaseKey.views, views);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

    expect(getLiveDatabaseRowIds(database)).toEqual(['row-linked-only', 'row-live']);
  });

  it('returns stable sorted membership regardless of view and row order', () => {
    const doc = new Y.Doc();
    const database = new Y.Map() as YDatabase;
    const views = new Y.Map();
    const firstView = new Y.Map();
    const secondView = new Y.Map();
    const firstRowOrders = new Y.Array<{ id: string }>();
    const secondRowOrders = new Y.Array<{ id: string }>();

    firstRowOrders.push([{ id: 'row-z' }, { id: 'row-a' }]);
    secondRowOrders.push([{ id: 'row-m' }, { id: 'row-a' }]);
    firstView.set(YjsDatabaseKey.row_orders, firstRowOrders);
    secondView.set(YjsDatabaseKey.row_orders, secondRowOrders);
    views.set('view-z', firstView);
    views.set('view-a', secondView);
    database.set(YjsDatabaseKey.views, views);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

    expect(getLiveDatabaseRowIds(database)).toEqual(['row-a', 'row-m', 'row-z']);
  });
});
