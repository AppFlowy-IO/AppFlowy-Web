import { DashboardWidget } from '@/application/database-yjs/dashboard.type';

import { OWNED_VIEW_DELETION_DELAY_MS, OwnedViewDeletionQueue } from '../owned-views/OwnedViewDeletionQueue';

jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() } }));

const DASHBOARD = 'dash';

function widget(id: string, viewId: string, databaseId = 'db'): DashboardWidget {
  return { id, viewId, databaseId, width: 12 };
}

function setup(owners: Record<string, string | null> = {}) {
  let now = 1_000;
  const referenced = new Set<string>();
  const deleted: string[] = [];
  const deleteView = jest.fn(async (viewId: string) => {
    deleted.push(viewId);
  });
  const resolveOwner = jest.fn(async (viewId: string) => owners[viewId] ?? null);
  const queue = new OwnedViewDeletionQueue({
    dashboardViewId: DASHBOARD,
    isReferenced: (viewId) => referenced.has(viewId),
    ownerOfNow: (viewId) => owners[viewId] ?? null,
    resolveOwner,
    deleteView,
    now: () => now,
  });

  return {
    queue,
    referenced,
    deleted,
    deleteView,
    resolveOwner,
    advance: async (ms: number) => {
      now += ms;
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('OwnedViewDeletionQueue', () => {
  it('queues the owned views a rows change removed and keeps the shared ones', () => {
    const { queue } = setup({ owned: DASHBOARD, other: 'dash-2' });

    queue.reconcile([widget('w1', 'owned'), widget('w2', 'shared'), widget('w3', 'other')], [widget('w2', 'shared')]);
    expect(queue.viewIds).toEqual(['owned']);
  });

  it('takes a view out of the queue when a widget shows it again (redo, undo of a delete)', () => {
    const { queue } = setup({ owned: DASHBOARD });

    queue.reconcile([widget('w1', 'owned')], []);
    expect(queue.has('owned')).toBe(true);
    queue.reconcile([], [widget('w1', 'owned')]);
    expect(queue.has('owned')).toBe(false);
  });

  it('keeps a view that another widget still shows', () => {
    const { queue } = setup({ owned: DASHBOARD });

    queue.reconcile([widget('w1', 'owned'), widget('w2', 'owned')], [widget('w2', 'owned')]);
    expect(queue.viewIds).toEqual([]);
  });

  it('deletes on flush (Done, close), skipping referenced and re-owned views', async () => {
    const owners: Record<string, string | null> = { a: DASHBOARD, b: DASHBOARD, c: DASHBOARD };
    const { queue, referenced, deleted } = setup(owners);

    queue.reconcile([widget('w1', 'a'), widget('w2', 'b'), widget('w3', 'c')], []);
    referenced.add('b');
    owners.c = 'dash-2';
    await queue.flush();

    expect(deleted).toEqual(['a']);
    expect(queue.viewIds).toEqual([]);
  });

  it('deletes at the 60 s deadline with one timer on the earliest item', async () => {
    const { queue, deleted, advance } = setup({ a: DASHBOARD, b: DASHBOARD });

    queue.reconcile([widget('w1', 'a')], []);
    await advance(30_000);
    queue.reconcile([widget('w2', 'b')], []);
    await advance(OWNED_VIEW_DELETION_DELAY_MS - 30_000);
    expect(deleted).toEqual(['a']);
    expect(queue.viewIds).toEqual(['b']);
    await advance(30_000);
    expect(deleted).toEqual(['a', 'b']);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('logs and drops a failed deletion (gone, no access, offline)', async () => {
    const { queue, deleteView } = setup({ a: DASHBOARD, b: DASHBOARD });

    deleteView.mockRejectedValueOnce(new Error('offline'));
    queue.enqueue('a', 'db');
    queue.enqueue('b', 'db');
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(deleteView.mock.calls.map(([viewId]) => viewId)).toEqual(['a', 'b']);
    expect(queue.viewIds).toEqual([]);
  });

  it('leaves the views an open-time sweep queued to their deadline', async () => {
    const { queue, deleted, advance } = setup({ swept: DASHBOARD, removed: DASHBOARD });

    queue.enqueue('swept', 'db', { deadlineOnly: true });
    queue.reconcile([widget('w1', 'removed')], []);
    await queue.flush();
    expect(deleted).toEqual(['removed']);
    expect(queue.viewIds).toEqual(['swept']);
    await advance(OWNED_VIEW_DELETION_DELAY_MS);
    expect(deleted).toEqual(['removed', 'swept']);
  });

  it('never queues a view nobody owns (only owners are known to the reconcile)', () => {
    const { queue } = setup({});

    queue.reconcile([widget('w1', 'shared')], []);
    expect(queue.viewIds).toEqual([]);
  });

  it('stops after dispose', async () => {
    const { queue, deleted, advance } = setup({ a: DASHBOARD });

    queue.enqueue('a', 'db');
    queue.dispose();
    queue.enqueue('a', 'db');
    await advance(OWNED_VIEW_DELETION_DELAY_MS);
    expect(deleted).toEqual([]);
  });
});
