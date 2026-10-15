import * as Y from 'yjs';

import { getOrCreateDatabaseHistoryManager } from '../history';
import { recordCommittedRowCreation } from '../creation/row-creation-history';
import { YDoc } from '@/application/types';

function fixture() {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map();
  const views = new Y.Map<Y.Map<unknown>>();
  const view = new Y.Map();
  const orders = new Y.Array<{ id: string; height: number; is_deleted?: boolean }>();

  doc.getMap('data').set('database', database);
  database.set('views', views);
  views.set('view', view);
  view.set('row_orders', orders);
  orders.push(['before', 'created', 'after'].map((id) => ({ id, height: 36 })));
  const history = getOrCreateDatabaseHistoryManager(doc);

  recordCommittedRowCreation(doc, 'created');
  return { doc, orders, history, ids: () => orders.toArray().map((row) => row.id) };
}

it('undo/redo touches only the creator row and preserves interleaved peer membership and settings', () => {
  const f = fixture();

  try {
    f.doc.transact(() => {
      f.orders.insert(1, [{ id: 'peer', height: 72 }]);
      (f.doc.getMap('data').get('database') as Y.Map<unknown>).set('peerSetting', 'retained');
    }, 'remote');
    f.history.undo();
    expect(f.ids()).toEqual(['before', 'peer', 'after']);
    f.history.redo();
    expect(f.ids()).toEqual(['before', 'peer', 'created', 'after']);
    expect((f.doc.getMap('data').get('database') as Y.Map<unknown>).get('peerSetting')).toBe('retained');
    expect(f.orders.get(1).height).toBe(72);
  } finally {
    f.doc.destroy();
  }
});

it('remote removal prevents a stale creation undo from manufacturing a redo resurrection', () => {
  const f = fixture();

  try {
    f.doc.transact(() => f.orders.delete(1, 1), 'remote');
    f.history.undo();
    expect(f.history.canRedo()).toBe(false);
    expect(f.ids()).toEqual(['before', 'after']);
  } finally {
    f.doc.destroy();
  }
});

it('preserves a collaborator trash tombstone through creation undo and redo', () => {
  const f = fixture();

  try {
    f.doc.transact(() => {
      f.orders.delete(1, 1);
      f.orders.insert(1, [{ id: 'created', height: 36, is_deleted: true }]);
    }, 'remote');
    f.history.undo();
    expect(f.history.canRedo()).toBe(false);
    f.history.redo();
    expect(f.orders.get(1)).toEqual({ id: 'created', height: 36, is_deleted: true });
  } finally {
    f.doc.destroy();
  }
});

it.each(['removed', 'trashed'])('redo restores only views actually undone when a peer has %s membership', (state) => {
  const f = fixture();

  try {
    const views = (f.doc.getMap('data').get('database') as Y.Map<Y.Map<Y.Map<unknown>>>).get('views')!;
    const view = new Y.Map<unknown>();
    const orders = new Y.Array<{ id: string; height: number; is_deleted?: boolean }>();

    views.set('second', view);
    view.set('row_orders', orders);
    orders.push([{ id: 'created', height: 36 }]);
    f.history.clear();
    recordCommittedRowCreation(f.doc, 'created');
    f.doc.transact(() => {
      orders.delete(0, 1);
      if (state === 'trashed') orders.push([{ id: 'created', height: 36, is_deleted: true }]);
    }, 'remote');
    f.history.undo();
    f.history.redo();
    expect(f.ids()).toEqual(['before', 'created', 'after']);
    expect(orders.toArray()).toEqual(state === 'removed' ? [] : [{ id: 'created', height: 36, is_deleted: true }]);
  } finally {
    f.doc.destroy();
  }
});

it.each(['version', 'databaseRestoreId'])('does not replay membership after the %s branch changes', (key) => {
  const f = fixture();

  try {
    f.doc[key as 'version' | 'databaseRestoreId'] = 'new-branch';
    expect(f.history.canUndo()).toBe(false);
    f.history.undo();
    expect(f.ids()).toEqual(['before', 'created', 'after']);
  } finally {
    f.doc.destroy();
  }
});
