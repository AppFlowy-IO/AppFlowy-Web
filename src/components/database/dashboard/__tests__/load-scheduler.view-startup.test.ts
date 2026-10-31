import { DASHBOARD_LOADING } from '@/application/database-yjs/dashboard-loading';

import { createDashboardLoadScheduler } from '../load-scheduler';

describe('dashboard view startup admission', () => {
  afterEach(() => jest.useRealTimers());

  function dashboard(source: 'host' | 'resident' | 'cold' = 'host') {
    const scheduler = createDashboardLoadScheduler({
      hostSourceId: 'host',
      isSourceResident: (id) => id === 'resident',
    });
    const ids = Array.from({ length: 100 }, (_, index) => `w${index + 1}`);

    ids.forEach((id) => scheduler.register({ id, sourceId: source === 'cold' ? id : source }));
    scheduler.setOrder(ids);
    scheduler.setVisibility(ids.map((id, index) => [id, index < 6]));
    return { scheduler, ids };
  }

  it.each(['host', 'resident'] as const)('limits %s views to two unfinished startups, including after source open/first data', (source) => {
    const { scheduler } = dashboard(source);

    expect(scheduler.loadingWidgetIds()).toEqual(['w1', 'w2']);
    scheduler.report('w1', 'opened');
    scheduler.report('w1', 'first-data');
    expect(scheduler.loadingWidgetIds()).toEqual(['w1', 'w2']);
    scheduler.report('w1', 'complete');
    expect(scheduler.loadingWidgetIds()).toEqual(['w2', 'w3']);
    scheduler.close();
  });

  it.each(['host', 'resident'] as const)('never starts unseen %s views after first data or the background deadline', (source) => {
    jest.useFakeTimers();
    const { scheduler, ids } = dashboard(source);

    for (const id of ids.slice(0, 6)) scheduler.report(id, 'complete');
    jest.advanceTimersByTime(DASHBOARD_LOADING.deferredStartTimeoutMs * 3);
    expect(ids.filter(scheduler.isStarted)).toEqual(ids.slice(0, 6));
    expect(scheduler.loadingWidgetIds()).toEqual([]);

    scheduler.setVisibility([['w100', true]]);
    expect(scheduler.loadingWidgetIds()).toEqual(['w100']);
    expect(scheduler.isStarted('w1')).toBe(true);
    scheduler.close();
  });

  it.each(['host', 'resident'] as const)('cancels hidden unfinished %s views before admitting newly visible work', (source) => {
    const { scheduler, ids } = dashboard(source);
    const first = scheduler.loadGeneration('w1');
    const second = scheduler.loadGeneration('w2');

    scheduler.setVisibility(ids.map((id) => [id, id === 'w3' || id === 'w100']));
    expect(scheduler.isStarted('w1')).toBe(false);
    expect(scheduler.isStarted('w2')).toBe(false);
    expect(scheduler.loadingWidgetIds()).toEqual(['w1', 'w2']);
    expect(scheduler.isStarted('w3')).toBe(false);
    scheduler.report('w1', 'complete', first);
    expect(scheduler.isStarted('w3')).toBe(false);

    scheduler.report('w1', 'suspended', first);
    expect(scheduler.loadingWidgetIds()).toEqual(['w2', 'w3']);
    scheduler.report('w2', 'suspended', second);
    expect(scheduler.loadingWidgetIds()).toEqual(['w3', 'w100']);

    scheduler.report('w3', 'complete');
    scheduler.setVisibility([['w1', true]]);
    expect(scheduler.loadGeneration('w1')).toBeGreaterThan(first);
    scheduler.report('w1', 'complete', first);
    expect(scheduler.loadingWidgetIds()).toEqual(['w1', 'w100']);
    scheduler.close();
  });

  it('keeps completed/moved views without spending an unfinished view slot', () => {
    const { scheduler } = dashboard('cold');

    scheduler.report('w1', 'complete');
    scheduler.setVisibility([['w1', false]]);
    expect(scheduler.isStarted('w1')).toBe(true);
    scheduler.register({ id: 'w1', sourceId: 'w1', resume: true });
    expect(scheduler.isStarted('w1')).toBe(true);
    expect(scheduler.loadingWidgetIds()).toEqual(['w2', 'w3']);
    scheduler.register({ id: 'unknown-cached-view', sourceId: 'resident', resume: true });
    scheduler.setVisibility([['unknown-cached-view', true]]);
    expect(scheduler.isStarted('unknown-cached-view')).toBe(false);
    expect(scheduler.loadingWidgetIds()).toEqual(['w2', 'w3']);
    scheduler.close();
  });

  it('retains the source timeout but cancels pending work before reusing its view slot', () => {
    jest.useFakeTimers();
    const { scheduler } = dashboard('cold');
    const first = scheduler.loadGeneration('w1');
    const second = scheduler.loadGeneration('w2');

    jest.advanceTimersByTime(DASHBOARD_LOADING.sourceLoadTimeoutMs - 1);
    expect(scheduler.isStarted('w1')).toBe(true);
    jest.advanceTimersByTime(1);
    expect(scheduler.isStarted('w1')).toBe(false);
    expect(scheduler.isStarted('w2')).toBe(false);
    expect(scheduler.isStarted('w3')).toBe(false);
    expect(scheduler.loadingWidgetIds()).toEqual(['w1', 'w2']);

    scheduler.report('w1', 'suspended', first);
    expect(scheduler.loadingWidgetIds()).toEqual(['w2', 'w3']);
    scheduler.report('w2', 'suspended', second);
    expect(scheduler.loadingWidgetIds()).toEqual(['w3', 'w4']);
    scheduler.report('w1', 'complete', first);
    expect(scheduler.isStarted('w1')).toBe(false);

    // A later explicit viewport revisit can retry; a late old callback cannot finish it.
    scheduler.setVisibility([['w1', false]]);
    scheduler.setVisibility([['w1', true]]);
    scheduler.report('w3', 'complete');
    expect(scheduler.loadGeneration('w1')).toBeGreaterThan(first);
    scheduler.report('w1', 'complete', first);
    expect(scheduler.loadingWidgetIds()).toContain('w1');
    scheduler.close();
  });

  it('admits nothing after close, including cancellation and late completion callbacks', () => {
    jest.useFakeTimers();
    const { scheduler, ids } = dashboard();

    scheduler.setVisibility(ids.map((id) => [id, id === 'w100']));
    scheduler.close();
    scheduler.report('w1', 'suspended');
    scheduler.report('w2', 'suspended');
    scheduler.report('w1', 'complete');
    jest.advanceTimersByTime(DASHBOARD_LOADING.sourceLoadTimeoutMs * 2);
    expect(scheduler.isStarted('w100')).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
