import {
  appendViewId,
  insertViewIdAfter,
  readStoredViewOrder,
  reconcileOrderedViewIds,
  selectHydratingViewOrder,
  selectStableViewOrder,
  writeStoredViewOrder,
} from '@/utils/database-view-order';

describe('database view ordering helpers', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('preserves previous tab order and appends unseen ids', () => {
    expect(reconcileOrderedViewIds(['grid', 'board'], ['calendar', 'grid', 'board'])).toEqual([
      'grid',
      'board',
      'calendar',
    ]);
  });

  it('inserts a new view immediately after the active tab', () => {
    expect(insertViewIdAfter(['grid', 'board'], 'grid', 'calendar')).toEqual(['grid', 'calendar', 'board']);
  });

  it('appends a new view to the end', () => {
    expect(appendViewId(['grid', 'board'], 'calendar')).toEqual(['grid', 'board', 'calendar']);
  });

  it('moves an existing view to the end when appending', () => {
    expect(appendViewId(['grid', 'calendar', 'board'], 'calendar')).toEqual(['grid', 'board', 'calendar']);
  });

  it('persists and restores stored view order', () => {
    writeStoredViewOrder('db-1', ['grid', 'calendar', 'board']);

    expect(readStoredViewOrder('db-1')).toEqual(['grid', 'calendar', 'board']);
  });

  it('falls back to the stable order when previous and stored orders collapse to the new view', () => {
    expect(
      selectStableViewOrder({
        previousViewIds: ['new-board'],
        storedViewIds: ['new-board'],
        fallbackViewIds: ['grid', 'board', 'calendar'],
        pendingViewId: 'new-board',
      })
    ).toEqual(['grid', 'board', 'calendar']);
  });

  it('preserves stored order while view ids are still hydrating', () => {
    expect(
      selectHydratingViewOrder({
        incomingViewIds: [],
        previousViewIds: [],
        storedViewIds: ['grid', 'board'],
        isNewDatabase: true,
      })
    ).toEqual(['grid', 'board']);
  });

  it('keeps previous order during same-database hydration without leaking it to a new database', () => {
    expect(
      selectHydratingViewOrder({
        incomingViewIds: [],
        previousViewIds: ['grid', 'board'],
        storedViewIds: undefined,
        isNewDatabase: false,
      })
    ).toEqual(['grid', 'board']);

    expect(
      selectHydratingViewOrder({
        incomingViewIds: [],
        previousViewIds: ['grid', 'board'],
        storedViewIds: undefined,
        isNewDatabase: true,
      })
    ).toBeUndefined();
  });

  it('ignores invalid stored data', () => {
    window.localStorage.setItem('database_view_order:db-1', JSON.stringify({ order: ['grid'] }));

    expect(readStoredViewOrder('db-1')).toBeUndefined();
  });
});
