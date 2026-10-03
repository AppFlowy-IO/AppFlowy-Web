import type { DashboardLoadStatsBridge, DashboardLoadStatsSnapshot } from '../dashboard-load-stats';

let mockTestBuild = true;

jest.mock('@/utils/runtime-config', () => ({
  isDevelopmentOrTestEnvironment: () => mockTestBuild,
}));

type StatsModule = typeof import('../dashboard-load-stats');
type StatsWindow = Window & { __DASHBOARD_LOAD_STATS__?: DashboardLoadStatsBridge; Cypress?: unknown };

const statsWindow = window as StatsWindow;

const EMPTY: DashboardLoadStatsSnapshot = {
  sourceOpens: {},
  rowLoadPasses: {},
  rowsBound: {},
  derivedComputes: {},
  widgetStarts: [],
  widgetFirstData: {},
  widgetComplete: {},
  emptyStateSamples: {},
  sourceLoads: [],
  maxConcurrentSourceLoads: 0,
  sourcesReleased: [],
};

/** A fresh copy of the module, loaded as a build with (or without) the test flag. */
function loadStats(testBuild: boolean): StatsModule['dashboardLoadStats'] {
  let loaded: StatsModule | undefined;

  mockTestBuild = testBuild;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    loaded = require('../dashboard-load-stats') as StatsModule;
  });
  return (loaded as StatsModule).dashboardLoadStats;
}

/** Calls every recorder once. */
function recordEverything(stats: StatsModule['dashboardLoadStats']) {
  stats.recordSourceOpen('db');
  stats.recordRowLoadPass('db');
  stats.recordRowsBound('db', 3);
  stats.recordDerivedCompute('view:hash');
  stats.recordWidgetStart({ widgetId: 'w1', sourceId: 'db', visibleAtStart: true, at: 1 });
  stats.recordWidgetFirstData('w1', 2);
  stats.recordEmptyStateSample('w1');
  stats.recordWidgetComplete('w1', 3);
  stats.recordSourceLoadStart('db', 1);
  stats.recordSourceLoadEnd('db', 3);
  stats.recordSourceReleased('db', 'idle');
}

beforeEach(() => {
  delete statsWindow.__DASHBOARD_LOAD_STATS__;
  delete statsWindow.Cypress;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('dashboardLoadStats in a development or test build', () => {
  it('starts empty and exposes snapshot() and reset() on window.__DASHBOARD_LOAD_STATS__', () => {
    const stats = loadStats(true);

    expect(stats.snapshot()).toEqual(EMPTY);
    expect(Object.keys(statsWindow.__DASHBOARD_LOAD_STATS__ ?? {}).sort()).toEqual(['reset', 'snapshot']);
    stats.recordSourceOpen('db');
    expect(statsWindow.__DASHBOARD_LOAD_STATS__?.snapshot()).toEqual(stats.snapshot());
    statsWindow.__DASHBOARD_LOAD_STATS__?.reset();
    expect(stats.snapshot()).toEqual(EMPTY);
  });

  it('counts source opens and row load passes per database', () => {
    const stats = loadStats(true);

    stats.recordSourceOpen('a');
    stats.recordSourceOpen('b');
    stats.recordSourceOpen('a');
    stats.recordRowLoadPass('a');
    stats.recordRowLoadPass('a');
    expect(stats.snapshot().sourceOpens).toEqual({ a: 2, b: 1 });
    expect(stats.snapshot().rowLoadPasses).toEqual({ a: 2 });
  });

  it('adds up the rows bound per database, one row by default', () => {
    const stats = loadStats(true);

    stats.recordRowsBound('a');
    stats.recordRowsBound('a', 49);
    stats.recordRowsBound('b', 7);
    expect(stats.snapshot().rowsBound).toEqual({ a: 50, b: 7 });
  });

  it('counts the full computations of each derived result', () => {
    const stats = loadStats(true);

    stats.recordDerivedCompute('view-1:hash-a');
    stats.recordDerivedCompute('view-1:hash-a');
    stats.recordDerivedCompute('view-2:hash-b');
    expect(stats.snapshot().derivedComputes).toEqual({ 'view-1:hash-a': 2, 'view-2:hash-b': 1 });
  });

  it('lists widget starts in start order, a resumed widget again, stamped with the clock by default', () => {
    const stats = loadStats(true);

    jest.spyOn(Date, 'now').mockReturnValue(5000);
    stats.recordWidgetStart({ widgetId: 'w2', sourceId: 'b', visibleAtStart: true, at: 10 });
    stats.recordWidgetStart({ widgetId: 'w1', sourceId: 'a', visibleAtStart: false });
    stats.recordWidgetStart({ widgetId: 'w2', sourceId: 'b', visibleAtStart: true, at: 30 });
    expect(stats.snapshot().widgetStarts).toEqual([
      { widgetId: 'w2', sourceId: 'b', visibleAtStart: true, at: 10 },
      { widgetId: 'w1', sourceId: 'a', visibleAtStart: false, at: 5000 },
      { widgetId: 'w2', sourceId: 'b', visibleAtStart: true, at: 30 },
    ]);
  });

  it('keeps the first first-data and the first complete time of a widget', () => {
    const stats = loadStats(true);

    jest.spyOn(Date, 'now').mockReturnValue(700);
    stats.recordWidgetFirstData('w1', 100);
    stats.recordWidgetFirstData('w1', 900);
    stats.recordWidgetFirstData('w2');
    stats.recordWidgetComplete('w1', 400);
    stats.recordWidgetComplete('w1', 950);
    stats.recordWidgetComplete('w2');
    expect(stats.snapshot().widgetFirstData).toEqual({ w1: 100, w2: 700 });
    expect(stats.snapshot().widgetComplete).toEqual({ w1: 400, w2: 700 });
  });

  it('counts an empty state only before the widget completed', () => {
    const stats = loadStats(true);

    stats.recordEmptyStateSample('w1');
    stats.recordEmptyStateSample('w1');
    stats.recordWidgetComplete('w1', 400);
    stats.recordEmptyStateSample('w1');
    stats.recordWidgetComplete('w2', 400);
    stats.recordEmptyStateSample('w2');
    expect(stats.snapshot().emptyStateSamples).toEqual({ w1: 2 });
  });

  it('records the interval each source holds a slot, open until it ends', () => {
    const stats = loadStats(true);

    stats.recordSourceLoadStart('a', 10);
    stats.recordSourceLoadStart('b', 20);
    stats.recordSourceLoadEnd('a', 30);
    stats.recordSourceLoadStart('a', 40);
    expect(stats.snapshot().sourceLoads).toEqual([
      { sourceId: 'a', start: 10, end: 30 },
      { sourceId: 'b', start: 20, end: null },
      { sourceId: 'a', start: 40, end: null },
    ]);
  });

  it('counts a source that already holds a slot once, and ignores an end without a start', () => {
    const stats = loadStats(true);

    stats.recordSourceLoadEnd('a', 5);
    stats.recordSourceLoadStart('a', 10);
    stats.recordSourceLoadStart('a', 15);
    expect(stats.snapshot().sourceLoads).toEqual([{ sourceId: 'a', start: 10, end: null }]);
    expect(stats.snapshot().maxConcurrentSourceLoads).toBe(1);
  });

  it('keeps the high-water mark of sources loading at the same time', () => {
    const stats = loadStats(true);

    expect(stats.snapshot().maxConcurrentSourceLoads).toBe(0);
    stats.recordSourceLoadStart('a', 10);
    expect(stats.snapshot().maxConcurrentSourceLoads).toBe(1);
    stats.recordSourceLoadStart('b', 20);
    expect(stats.snapshot().maxConcurrentSourceLoads).toBe(2);
    // One ends before the next starts: still two at a time.
    stats.recordSourceLoadEnd('a', 30);
    stats.recordSourceLoadStart('c', 40);
    expect(stats.snapshot().maxConcurrentSourceLoads).toBe(2);
    stats.recordSourceLoadStart('d', 50);
    expect(stats.snapshot().maxConcurrentSourceLoads).toBe(3);
    // The mark never drops.
    stats.recordSourceLoadEnd('b', 60);
    stats.recordSourceLoadEnd('c', 70);
    stats.recordSourceLoadEnd('d', 80);
    expect(stats.snapshot().maxConcurrentSourceLoads).toBe(3);
  });

  it('lists released sources with the reason', () => {
    const stats = loadStats(true);

    stats.recordSourceReleased('a', 'idle');
    stats.recordSourceReleased('b', 'row-budget');
    expect(stats.snapshot().sourcesReleased).toEqual([
      { sourceId: 'a', reason: 'idle' },
      { sourceId: 'b', reason: 'row-budget' },
    ]);
  });

  it('hands out a plain copy that later records and callers cannot change', () => {
    const stats = loadStats(true);

    recordEverything(stats);
    const first = stats.snapshot();

    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    first.sourceOpens.db = 99;
    first.widgetStarts[0].widgetId = 'changed';
    first.sourceLoads[0].end = -1;
    first.sourcesReleased.length = 0;
    stats.recordSourceOpen('db');
    expect(stats.snapshot()).toEqual({
      sourceOpens: { db: 2 },
      rowLoadPasses: { db: 1 },
      rowsBound: { db: 3 },
      derivedComputes: { 'view:hash': 1 },
      widgetStarts: [{ widgetId: 'w1', sourceId: 'db', visibleAtStart: true, at: 1 }],
      widgetFirstData: { w1: 2 },
      widgetComplete: { w1: 3 },
      emptyStateSamples: { w1: 1 },
      sourceLoads: [{ sourceId: 'db', start: 1, end: 3 }],
      maxConcurrentSourceLoads: 1,
      sourcesReleased: [{ sourceId: 'db', reason: 'idle' }],
    });
  });

  it('reset() clears every counter, the high-water mark included, and keeps recording', () => {
    const stats = loadStats(true);

    recordEverything(stats);
    stats.recordSourceLoadStart('open', 4);
    stats.reset();
    expect(stats.snapshot()).toEqual(EMPTY);
    // An interval left open by the reset no longer counts.
    stats.recordSourceLoadStart('db', 5);
    stats.recordEmptyStateSample('w1');
    expect(stats.snapshot()).toEqual({
      ...EMPTY,
      emptyStateSamples: { w1: 1 },
      sourceLoads: [{ sourceId: 'db', start: 5, end: null }],
      maxConcurrentSourceLoads: 1,
    });
  });
});

describe('dashboardLoadStats in a production build', () => {
  it('records nothing and exposes nothing', () => {
    const stats = loadStats(false);

    recordEverything(stats);
    stats.recordWidgetStart({ widgetId: 'w2', sourceId: 'db', visibleAtStart: false });
    stats.recordRowsBound('db');
    stats.recordSourceLoadStart('other');
    expect(stats.snapshot()).toEqual(EMPTY);
    expect(statsWindow.__DASHBOARD_LOAD_STATS__).toBeUndefined();
    expect('__DASHBOARD_LOAD_STATS__' in statsWindow).toBe(false);
  });

  it('records again, and exposes the bridge, once Cypress is on the window', () => {
    const stats = loadStats(false);

    stats.recordSourceOpen('db');
    expect(stats.snapshot()).toEqual(EMPTY);
    statsWindow.Cypress = {};
    stats.recordSourceOpen('db');
    expect(stats.snapshot()).toEqual({ ...EMPTY, sourceOpens: { db: 1 } });
    expect(statsWindow.__DASHBOARD_LOAD_STATS__?.snapshot()).toEqual({ ...EMPTY, sourceOpens: { db: 1 } });
  });
});
