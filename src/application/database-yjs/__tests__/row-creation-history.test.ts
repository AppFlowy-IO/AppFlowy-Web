import * as Y from 'yjs';

import { getOrCreateDatabaseHistoryManager } from '../history';
import { recordCommittedRowCreation } from '../creation/row-creation-history';
import { YDoc } from '@/application/types';

function fixture() {
  const doc = new Y.Doc() as YDoc;
  const database = new Y.Map();
  const views = new Y.Map<Y.Map<unknown>>();
  const view = new Y.Map();
  const orders = new Y.Array<{ id: string; height: number }>();

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
