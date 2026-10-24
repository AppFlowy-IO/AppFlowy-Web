import { act, render, screen } from '@testing-library/react';
import { RefObject, StrictMode, useEffect, useRef, useState } from 'react';

import { dashboardLoadStats } from '@/application/database-yjs/dashboard-load-stats';
import { DASHBOARD_LOADING } from '@/application/database-yjs/dashboard-loading';

import { DashboardLoadSchedulerProvider, useWidgetLoadStart } from '../DashboardLoadScheduler';
import { createDashboardLoadScheduler, WidgetLoadReport } from '../load-scheduler';

/** The databases whose rows the tab holds (see `isDatabaseSourceResident`); none unless a test adds one. */
const mockResidentSources = new Set<string>();
const mockResidencyListeners = new Set<() => void>();

jest.mock('@/application/database-blob', () => ({
  isDatabaseSourceResident: (databaseId: string) => mockResidentSources.has(databaseId),
  subscribeToDatabaseSourceResidency: (listener: () => void) => {
    mockResidencyListeners.add(listener);
    return () => mockResidencyListeners.delete(listener);
  },
}));

/** A walk settled (`resident`) or its seeds were released: the residency listeners hear of it. */
function setResident(sourceId: string, resident: boolean) {
  if (resident) mockResidentSources.add(sourceId);
  else mockResidentSources.delete(sourceId);
  act(() => mockResidencyListeners.forEach((listener) => listener()));
}

/** Stands in for the browser's observer: the test decides which boxes intersect the scroller. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  takeRecords() {
    return [];
  }

  /** Reports every observed box, as the browser does once after `observe`. */
  report(isVisible: (widgetId: string) => boolean) {
    const records = Array.from(this.targets, (target) => {
      const widgetId = (target as HTMLElement).dataset.widgetId ?? '';

      return { target, isIntersecting: isVisible(widgetId) } as unknown as IntersectionObserverEntry;
    });

    act(() => this.callback(records, this as unknown as IntersectionObserver));
  }
}

interface TestWidgetSpec {
  id: string;
  sourceId: string;
}

/** The widgets whose stand-in database is mounted, with their source and whether their load ended. */
const mountedDatabases = new Map<string, { sourceId: string; done: boolean }>();
const reporters = new Map<string, (report: WidgetLoadReport) => void>();

/** Stands in for `WidgetDatabaseHost`: mounting it is what loads the source. */
function FakeDatabase({
  widgetId,
  sourceId,
  report,
}: {
  widgetId: string;
  sourceId: string;
  report: (report: WidgetLoadReport) => void;
}) {
  useEffect(() => {
    mountedDatabases.set(widgetId, { sourceId, done: false });
    reporters.set(widgetId, report);
    return () => {
      mountedDatabases.delete(widgetId);
      reporters.delete(widgetId);
    };
  }, [report, sourceId, widgetId]);
  return <div data-testid={`database-${widgetId}`} />;
}

/** The part of a widget inside its box that waits for its turn (`WidgetSource` in the app). */
function WidgetContent({ id, sourceId, boxRef }: TestWidgetSpec & { boxRef: RefObject<HTMLDivElement> }) {
  const { started, report } = useWidgetLoadStart({ widgetId: id, sourceId, boxRef, resume: false });

  return started ? <FakeDatabase report={report} sourceId={sourceId} widgetId={id} /> : <Placeholder widgetId={id} />;
}

/**
 * A widget box with its content inside, as `DashboardWidget` renders it: the
 * box's ref is attached only after the layout effects of the content, and a
 * new source remounts the content inside the same box.
 */
function TestWidget({ id, sourceId }: TestWidgetSpec) {
  const boxRef = useRef<HTMLDivElement>(null);

  return (
    <div data-widget-id={id} ref={boxRef}>
      <WidgetContent boxRef={boxRef} id={id} key={sourceId} sourceId={sourceId} />
    </div>
  );
}

function TestDashboard({ widgets }: { widgets: TestWidgetSpec[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <DashboardLoadSchedulerProvider hostSourceId='host' order={widgets.map((widget) => widget.id)} scrollRef={scrollRef}>
      <div data-testid='scroller' ref={scrollRef}>
        {widgets.map((widget) => (
          <TestWidget key={widget.id} {...widget} />
        ))}
      </div>
    </DashboardLoadSchedulerProvider>
  );
}

/** `count` widgets over `count` sources, laid out 4 per row. */
function widgetsOverDistinctSources(count: number): TestWidgetSpec[] {
  return Array.from({ length: count }, (_, index) => ({ id: `w${index + 1}`, sourceId: `S${index + 1}` }));
}

function observer() {
  const instance = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];

  if (!instance) throw new Error('The dashboard observes no widget');
  return instance;
}

/** The distinct sources (the host aside) with a mounted database whose load has not ended. */
function loadingSources() {
  const sources = new Set<string>();

  mountedDatabases.forEach(({ sourceId, done }) => {
    if (!done && sourceId !== 'host') sources.add(sourceId);
  });
  return sources;
}

function report(widgetId: string, next: WidgetLoadReport) {
  const reporter = reporters.get(widgetId);

  if (!reporter) throw new Error(`${widgetId} has no mounted database`);
  act(() => reporter(next));
  if (next !== 'first-data') {
    const mounted = mountedDatabases.get(widgetId);

    if (mounted) mounted.done = true;
  }
}

function startedWidgetIds() {
  return dashboardLoadStats.snapshot().widgetStarts.map((start) => start.widgetId);
}

/**
 * The widget boxes the browser would lay out on screen, by widget id: jsdom
 * lays nothing out, so every other box has no area (it is never on screen).
 */
const onScreenBoxes = new Set<string>();

/** A box inside jsdom's 1024 x 768 viewport, or one far below it. */
function layOutBox(element: HTMLElement): DOMRect {
  const widgetId = element.dataset.widgetId;
  const top = widgetId !== undefined && onScreenBoxes.has(widgetId) ? 40 : 4000;

  return { x: 0, y: top, top, left: 0, width: 300, height: 200, right: 300, bottom: top + 200 } as DOMRect;
}

/**
 * Records every widget that rendered its placeholder, by id: a widget that
 * starts before the first paint renders its placeholder only in the commit it
 * replaces at once, never in one the browser paints.
 */
const placeholderRenders = new Map<string, number>();

function Placeholder({ widgetId }: { widgetId: string }) {
  placeholderRenders.set(widgetId, (placeholderRenders.get(widgetId) ?? 0) + 1);
  return <div data-testid={`placeholder-${widgetId}`} />;
}

const originalIntersectionObserver = window.IntersectionObserver;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  mountedDatabases.clear();
  reporters.clear();
  mockResidentSources.clear();
  onScreenBoxes.clear();
  placeholderRenders.clear();
  dashboardLoadStats.reset();
  window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
    return this.dataset.widgetId === undefined ? originalGetBoundingClientRect.call(this) : layOutBox(this);
  };
});

afterEach(() => {
  window.IntersectionObserver = originalIntersectionObserver;
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  jest.useRealTimers();
});

describe('the dashboard load queue', () => {
  it('watches every box with one observer on the viewport and starts nothing before it reports', () => {
    render(<TestDashboard widgets={widgetsOverDistinctSources(8)} />);

    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    // The viewport clips a box by every scrolling ancestor: in the app the page scroller, not the dashboard, scrolls.
    expect(observer().options?.root ?? null).toBeNull();
    expect(observer().targets.size).toBe(8);
    // Visibility is not known yet: a box that is off-screen must not take a slot first.
    expect(mountedDatabases.size).toBe(0);
    expect(screen.getAllByTestId(/^placeholder-/)).toHaveLength(8);
  });

  it('never has more than 2 distinct sources loading while 8 widgets over 8 sources load, visible ones first', () => {
    const widgets = widgetsOverDistinctSources(8);
    const visible = new Set(['w1', 'w2', 'w3', 'w4']);
    let mostLoading = 0;
    const check = () => {
      mostLoading = Math.max(mostLoading, loadingSources().size);
      expect(loadingSources().size).toBeLessThanOrEqual(DASHBOARD_LOADING.maxConcurrentSources);
    };

    render(<TestDashboard widgets={widgets} />);
    observer().report((id) => visible.has(id));
    check();
    expect(Array.from(mountedDatabases.keys())).toEqual(['w1', 'w2']);
    // A queued widget shows its placeholder and mounts no database.
    expect(screen.getByTestId('placeholder-w3')).toBeTruthy();
    expect(screen.queryByTestId('database-w3')).toBeNull();

    // Each widget shows its first rows, then completes; the next one in layout order takes the freed slot.
    widgets.forEach(() => {
      const loading = Array.from(mountedDatabases.entries()).find(([, entry]) => !entry.done);

      if (!loading) return;
      report(loading[0], 'first-data');
      check();
      report(loading[0], 'complete');
      check();
    });

    expect(mountedDatabases.size).toBe(8);
    expect(mostLoading).toBe(2);
    const stats = dashboardLoadStats.snapshot();

    expect(stats.maxConcurrentSourceLoads).toBeLessThanOrEqual(2);
    expect(stats.maxConcurrentSourceLoads).toBe(2);
    expect(startedWidgetIds()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8']);
    expect(stats.widgetStarts.map((start) => start.visibleAtStart)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    // Every slot was given back.
    expect(stats.sourceLoads.every((load) => load.end !== null)).toBe(true);
    expect(Object.keys(stats.widgetComplete).sort()).toEqual(widgets.map((widget) => widget.id).sort());
  });

  it.each(['failed', 'unavailable'] as const)(
    'gives the slot of a widget whose load is %s to the next one',
    (ending) => {
      render(<TestDashboard widgets={widgetsOverDistinctSources(4)} />);
      observer().report(() => true);
      expect(Array.from(mountedDatabases.keys())).toEqual(['w1', 'w2']);

      report('w1', ending);

      expect(mountedDatabases.has('w3')).toBe(true);
      expect(loadingSources()).toEqual(new Set(['S2', 'S3']));
      expect(dashboardLoadStats.snapshot().maxConcurrentSourceLoads).toBe(2);
      // A failure is not a completion.
      expect(dashboardLoadStats.snapshot().widgetComplete).toEqual({});
    }
  );

  it('gives the slot of a widget that unmounts to the next one', () => {
    const widgets = widgetsOverDistinctSources(4);
    const { rerender } = render(<TestDashboard widgets={widgets} />);

    observer().report(() => true);
    rerender(<TestDashboard widgets={widgets.filter((widget) => widget.id !== 'w1')} />);

    expect(Array.from(mountedDatabases.keys()).sort()).toEqual(['w2', 'w3']);
    expect(dashboardLoadStats.snapshot().sourceLoads.find((load) => load.sourceId === 'S1')?.end).not.toBeNull();
  });

  it('starts nothing after the dashboard is left, and leaves no timer behind', () => {
    jest.useFakeTimers();
    const { unmount } = render(<TestDashboard widgets={widgetsOverDistinctSources(8)} />);
    const visible = new Set(['w1', 'w2', 'w3', 'w4']);

    observer().report((id) => visible.has(id));
    const reportLate = reporters.get('w1');

    expect(startedWidgetIds()).toEqual(['w1', 'w2']);
    unmount();

    // A late report of a database that was loading when the dashboard was left changes nothing.
    act(() => reportLate?.('complete'));
    act(() => {
      jest.advanceTimersByTime(DASHBOARD_LOADING.deferredStartTimeoutMs * 2);
    });

    expect(startedWidgetIds()).toEqual(['w1', 'w2']);
    expect(jest.getTimerCount()).toBe(0);
    // Both slots were given back when the widgets unmounted.
    expect(dashboardLoadStats.snapshot().sourceLoads.every((load) => load.end !== null)).toBe(true);
  });

  it('starts a widget scrolled into view before the widgets above it in the queue', () => {
    render(<TestDashboard widgets={widgetsOverDistinctSources(8)} />);
    const visible = new Set(['w1', 'w2', 'w3', 'w4']);

    observer().report((id) => visible.has(id));
    expect(startedWidgetIds()).toEqual(['w1', 'w2']);

    // Scrolled to the second row: w7 is visible now, w3 and w4 are not.
    observer().report((id) => id === 'w1' || id === 'w2' || id === 'w7');
    report('w1', 'complete');

    expect(startedWidgetIds()).toEqual(['w1', 'w2', 'w7']);
    expect(screen.getByTestId('placeholder-w3')).toBeTruthy();
  });

  it('starts a visible widget of the host database before the first paint, without a slot', () => {
    const widgets = [
      { id: 'w1', sourceId: 'S1' },
      { id: 'w2', sourceId: 'S2' },
      { id: 'w3', sourceId: 'S3' },
      { id: 'w4', sourceId: 'host' },
    ];

    widgets.forEach((widget) => onScreenBoxes.add(widget.id));
    render(<TestDashboard widgets={widgets} />);

    // No observer report and no timer yet: the host widget started in the
    // commit of its first render (from its box, read before the paint), and
    // the placeholder it rendered there was replaced in the same task.
    expect(Array.from(mountedDatabases.keys())).toEqual(['w4']);
    expect(screen.queryByTestId('placeholder-w4')).toBeNull();
    expect(placeholderRenders.get('w4')).toBe(1);
    // The cold widgets wait for the observer: their visibility is not known yet.
    expect(screen.getAllByTestId(/^placeholder-w[123]$/)).toHaveLength(3);

    observer().report(() => true);

    // The host takes no slot: two cold sources load beside it.
    expect(Array.from(mountedDatabases.keys()).sort()).toEqual(['w1', 'w2', 'w4']);
    expect(loadingSources()).toEqual(new Set(['S1', 'S2']));
    expect(dashboardLoadStats.snapshot().maxConcurrentSourceLoads).toBe(2);
    expect(dashboardLoadStats.snapshot().widgetStarts.find((start) => start.widgetId === 'w4')?.visibleAtStart).toBe(
      true
    );
  });

  it('starts a visible widget switched to the host database before the next paint, inside its box', () => {
    const widgets = [
      { id: 'w1', sourceId: 'S1' },
      { id: 'w2', sourceId: 'S2' },
      { id: 'w3', sourceId: 'S3' },
    ];
    const { rerender } = render(<TestDashboard widgets={widgets} />);

    onScreenBoxes.add('w3');
    observer().report((id) => id === 'w1' || id === 'w2');
    expect(Array.from(mountedDatabases.keys()).sort()).toEqual(['w1', 'w2']);

    // w3 now shows a view of the host: its content remounts in the box it had.
    rerender(<TestDashboard widgets={[...widgets.slice(0, 2), { id: 'w3', sourceId: 'host' }]} />);

    expect(Array.from(mountedDatabases.keys()).sort()).toEqual(['w1', 'w2', 'w3']);
    expect(placeholderRenders.get('w3')).toBe(2);
    expect(loadingSources()).toEqual(new Set(['S1', 'S2']));
  });

  /**
   * A dashboard inside its own source database: two visible and two
   * off-screen widgets of the host, and two cold sources beside them.
   */
  const hostDashboard = [
    { id: 'w1', sourceId: 'host' },
    { id: 'w2', sourceId: 'host' },
    { id: 'w3', sourceId: 'S1' },
    { id: 'w4', sourceId: 'S2' },
    { id: 'w5', sourceId: 'host' },
    { id: 'w6', sourceId: 'host' },
    { id: 'w7', sourceId: 'S3' },
  ];
  const hostDashboardVisible = new Set(['w1', 'w2', 'w3', 'w4']);

  function openHostDashboard() {
    hostDashboardVisible.forEach((id) => onScreenBoxes.add(id));
    render(<TestDashboard widgets={hostDashboard} />);
    // Before the observer reports, only the visible host widgets started.
    expect(startedWidgetIds()).toEqual(['w1', 'w2']);
    observer().report((id) => hostDashboardVisible.has(id));
    expect(startedWidgetIds()).toEqual(['w1', 'w2', 'w3', 'w4']);
  }

  it('starts the off-screen widgets of the host database after the first data of every visible widget, without a slot', () => {
    openHostDashboard();

    // Off-screen host widgets wait for the visible ones, though they need no slot.
    report('w1', 'first-data');
    report('w2', 'first-data');
    report('w3', 'first-data');
    expect(screen.getByTestId('placeholder-w5')).toBeTruthy();
    expect(mountedDatabases.has('w5')).toBe(false);

    report('w4', 'first-data');

    // Both slots are still held by S1 and S2: the host widgets start beside
    // them, and the off-screen widget of a third cold source still waits.
    expect(startedWidgetIds()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
    expect(loadingSources()).toEqual(new Set(['S1', 'S2']));
    expect(mountedDatabases.has('w7')).toBe(false);
    expect(dashboardLoadStats.snapshot().widgetStarts.map((start) => start.visibleAtStart)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(dashboardLoadStats.snapshot().maxConcurrentSourceLoads).toBe(2);
  });

  it('starts the off-screen widgets of the host database 10 s after the first visible start when a visible widget shows no data', () => {
    jest.useFakeTimers();
    openHostDashboard();
    report('w1', 'first-data');
    report('w2', 'first-data');
    report('w3', 'first-data');

    act(() => {
      jest.advanceTimersByTime(DASHBOARD_LOADING.deferredStartTimeoutMs - 1);
    });
    expect(mountedDatabases.has('w5')).toBe(false);
    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(startedWidgetIds()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
    expect(loadingSources()).toEqual(new Set(['S1', 'S2']));
    expect(mountedDatabases.has('w7')).toBe(false);
    expect(dashboardLoadStats.snapshot().maxConcurrentSourceLoads).toBe(2);
  });

  it('starts every widget at once outside a dashboard', () => {
    function LoneWidget() {
      const boxRef = useRef<HTMLDivElement>(null);
      const { started } = useWidgetLoadStart({ widgetId: 'w1', sourceId: 'S1', boxRef, resume: false });

      return <div ref={boxRef}>{started ? 'started' : 'queued'}</div>;
    }

    render(<LoneWidget />);

    expect(screen.getByText('started')).toBeTruthy();
  });

  it('counts every widget as visible where the browser has no IntersectionObserver', () => {
    window.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    render(<TestDashboard widgets={widgetsOverDistinctSources(4)} />);

    expect(Array.from(mountedDatabases.keys())).toEqual(['w1', 'w2']);
    expect(dashboardLoadStats.snapshot().widgetStarts.every((start) => start.visibleAtStart)).toBe(true);
  });
});

describe('resident sources in the dashboard load queue', () => {
  it('starts the widget of a resident source without a slot, so only cold loads count', () => {
    mockResidentSources.add('S2');
    render(<TestDashboard widgets={widgetsOverDistinctSources(4)} />);
    observer().report(() => true);

    // S2's rows are in memory: w2 takes no slot, and w3 gets the second one.
    expect(Array.from(mountedDatabases.keys()).sort()).toEqual(['w1', 'w2', 'w3']);
    const stats = dashboardLoadStats.snapshot();

    expect(stats.maxConcurrentSourceLoads).toBe(2);
    expect(stats.sourceLoads.filter((load) => load.end === null).map((load) => load.sourceId)).toEqual(['S1', 'S3']);
  });

  it('frees the slot of a source whose walk settles, and starts the next widget', () => {
    render(<TestDashboard widgets={widgetsOverDistinctSources(3)} />);
    observer().report(() => true);
    expect(Array.from(mountedDatabases.keys()).sort()).toEqual(['w1', 'w2']);

    // w1 still derives its result, but S1's rows are in memory now: its slot is free.
    setResident('S1', true);

    expect(Array.from(mountedDatabases.keys()).sort()).toEqual(['w1', 'w2', 'w3']);
    expect(dashboardLoadStats.snapshot().maxConcurrentSourceLoads).toBe(2);
  });

  it('stops following residency once the dashboard is left', () => {
    const { unmount } = render(<TestDashboard widgets={widgetsOverDistinctSources(2)} />);

    expect(mockResidencyListeners.size).toBe(1);
    unmount();
    expect(mockResidencyListeners.size).toBe(0);
  });
});

describe('the dashboard load counters', () => {
  /** A started widget whose grid lists no row until the test fills it. */
  function GridWidget({ id, sourceId }: TestWidgetSpec) {
    const boxRef = useRef<HTMLDivElement>(null);
    const { started, report } = useWidgetLoadStart({ widgetId: id, sourceId, boxRef, resume: false });
    const [rows, setRows] = useState(0);

    useEffect(() => {
      if (started) reporters.set(id, (next) => (next === 'complete' ? setRows(3) : report(next)));
    }, [id, report, started]);
    useEffect(() => {
      if (rows > 0) report('complete');
    }, [report, rows]);

    return (
      <div data-widget-id={id} ref={boxRef}>
        {started ? <div data-row-count={rows} data-testid='database-grid' /> : null}
      </div>
    );
  }

  function GridDashboard() {
    const scrollRef = useRef<HTMLDivElement>(null);

    return (
      <DashboardLoadSchedulerProvider hostSourceId='host' order={['w1']} scrollRef={scrollRef}>
        <div ref={scrollRef}>
          <GridWidget id='w1' sourceId='S1' />
        </div>
      </DashboardLoadSchedulerProvider>
    );
  }

  it('counts the empty states a widget shows before its load is complete, and only those', async () => {
    window.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    render(<GridDashboard />);
    // MutationObserver callbacks run as microtasks.
    await act(async () => undefined);

    expect(dashboardLoadStats.snapshot().emptyStateSamples.w1).toBeGreaterThan(0);
    const before = dashboardLoadStats.snapshot().emptyStateSamples.w1;

    await act(async () => reporters.get('w1')?.('complete'));
    expect(dashboardLoadStats.snapshot().widgetComplete.w1).toBeDefined();
    expect(dashboardLoadStats.snapshot().emptyStateSamples.w1).toBe(before);
  });

  it('keeps the cap through the effect replay of StrictMode', () => {
    window.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    render(
      <StrictMode>
        <TestDashboard widgets={widgetsOverDistinctSources(4)} />
      </StrictMode>
    );

    expect(Array.from(mountedDatabases.keys()).sort()).toEqual(['w1', 'w2']);
    const stats = dashboardLoadStats.snapshot();

    // The replayed unmount restarts the queue (development only); the cap holds at every step.
    expect(stats.maxConcurrentSourceLoads).toBe(2);
    expect(stats.sourceLoads.filter((load) => load.end === null).map((load) => load.sourceId)).toEqual(['S1', 'S2']);
  });
});

describe('createDashboardLoadScheduler', () => {
  function setup() {
    let now = 0;
    const scheduler = createDashboardLoadScheduler({ hostSourceId: 'host', now: () => now });

    return {
      scheduler,
      advance: (ms: number) => {
        now += ms;
        jest.advanceTimersByTime(ms);
      },
    };
  }

  it('starts deferred widgets when the deferred timeout expires, and plans no timer once closed', () => {
    jest.useFakeTimers();
    const { scheduler, advance } = setup();

    scheduler.register({ id: 'w1', sourceId: 'S1' });
    scheduler.register({ id: 'w2', sourceId: 'S2' });
    scheduler.setOrder(['w1', 'w2']);
    scheduler.setVisibility([
      ['w1', true],
      ['w2', false],
    ]);
    expect(scheduler.isStarted('w1')).toBe(true);
    expect(scheduler.isStarted('w2')).toBe(false);

    advance(DASHBOARD_LOADING.deferredStartTimeoutMs - 1);
    expect(scheduler.isStarted('w2')).toBe(false);
    advance(1);
    expect(scheduler.isStarted('w2')).toBe(true);

    scheduler.register({ id: 'w3', sourceId: 'S3' });
    scheduler.setVisibility([['w3', false]]);
    scheduler.close();
    expect(jest.getTimerCount()).toBe(0);
    scheduler.report('w1', 'complete');
    expect(scheduler.isStarted('w3')).toBe(false);
  });

  it('starts deferred widgets once every visible widget shows its first data', () => {
    const { scheduler } = setup();

    scheduler.register({ id: 'w1', sourceId: 'S1' });
    scheduler.register({ id: 'w2', sourceId: 'S2' });
    scheduler.setOrder(['w1', 'w2']);
    scheduler.setVisibility([
      ['w1', true],
      ['w2', false],
    ]);
    scheduler.report('w1', 'first-data');

    expect(scheduler.isStarted('w2')).toBe(true);
    expect(scheduler.loadingWidgetIds()).toEqual(['w1', 'w2']);
  });

  it('keeps deferred widgets back over the row budget, but never a visible one', () => {
    const { scheduler } = setup();

    scheduler.register({ id: 'w1', sourceId: 'S1' });
    scheduler.register({ id: 'w2', sourceId: 'S2' });
    scheduler.register({ id: 'w3', sourceId: 'S3' });
    scheduler.setOrder(['w1', 'w2', 'w3']);
    scheduler.setVisibility([
      ['w1', true],
      ['w2', false],
      ['w3', false],
    ]);
    scheduler.setSourceRows('S1', DASHBOARD_LOADING.rowBudget + 1);
    scheduler.report('w1', 'complete');

    expect(scheduler.isStarted('w2')).toBe(false);
    scheduler.setVisibility([['w2', true]]);
    expect(scheduler.isStarted('w2')).toBe(true);
    expect(scheduler.isStarted('w3')).toBe(false);
  });

  it('resumes a widget that showed its view before a move without taking a slot', () => {
    const { scheduler } = setup();

    scheduler.register({ id: 'w1', sourceId: 'S1' });
    scheduler.register({ id: 'w2', sourceId: 'S2' });
    scheduler.setVisibility([
      ['w1', true],
      ['w2', true],
    ]);
    scheduler.register({ id: 'w3', sourceId: 'S3', resume: true });
    scheduler.register({ id: 'w4', sourceId: 'S4' });
    scheduler.setVisibility([
      ['w3', true],
      ['w4', true],
    ]);

    expect(scheduler.isStarted('w3')).toBe(true);
    expect(scheduler.isStarted('w4')).toBe(false);
    expect(scheduler.loadingWidgetIds()).toEqual(['w1', 'w2']);
  });

  describe('with resident sources', () => {
    function setupWithResidency(resident: Set<string>) {
      return createDashboardLoadScheduler({
        hostSourceId: 'host',
        isSourceResident: (sourceId) => resident.has(sourceId),
        now: () => 0,
      });
    }

    function registerVisible(scheduler: ReturnType<typeof setupWithResidency>, widgets: [string, string][]) {
      widgets.forEach(([id, sourceId]) => scheduler.register({ id, sourceId }));
      scheduler.setOrder(widgets.map(([id]) => id));
      scheduler.setVisibility(widgets.map(([id]) => [id, true] as [string, boolean]));
    }

    it('starts a resident source at once, holds no slot for it and counts no source load', () => {
      const resident = new Set(['S1']);
      const scheduler = setupWithResidency(resident);

      registerVisible(scheduler, [
        ['w1', 'S1'],
        ['w2', 'S2'],
        ['w3', 'S3'],
        ['w4', 'S4'],
      ]);

      expect(scheduler.loadingWidgetIds()).toEqual(['w1', 'w2', 'w3']);
      expect(scheduler.isStarted('w4')).toBe(false);
      expect(dashboardLoadStats.snapshot().sourceLoads.map((load) => load.sourceId)).toEqual(['S2', 'S3']);
    });

    it('plans again when residency changes: a settled walk frees its slot', () => {
      const resident = new Set<string>();
      const scheduler = setupWithResidency(resident);

      registerVisible(scheduler, [
        ['w1', 'S1'],
        ['w2', 'S2'],
        ['w3', 'S3'],
      ]);
      expect(scheduler.isStarted('w3')).toBe(false);

      resident.add('S1');
      // Nothing re-reads residency until told.
      expect(scheduler.isStarted('w3')).toBe(false);
      scheduler.refreshResidency();

      expect(scheduler.isStarted('w3')).toBe(true);
      const loads = dashboardLoadStats.snapshot().sourceLoads;

      expect(loads.find((load) => load.sourceId === 'S1')?.end).not.toBeNull();
      expect(loads.filter((load) => load.end === null).map((load) => load.sourceId)).toEqual(['S2', 'S3']);
    });

    it('queues the next widget of a released source for a slot again', () => {
      const resident = new Set(['S1']);
      const scheduler = setupWithResidency(resident);

      registerVisible(scheduler, [
        ['w1', 'S1'],
        ['w2', 'S2'],
        ['w3', 'S3'],
      ]);
      scheduler.report('w1', 'complete');
      resident.delete('S1');
      scheduler.refreshResidency();
      scheduler.register({ id: 'w4', sourceId: 'S1' });
      scheduler.setVisibility([['w4', true]]);

      // S2 and S3 hold both slots; S1 is a cold load again.
      expect(scheduler.isStarted('w4')).toBe(false);
      scheduler.report('w2', 'complete');
      expect(scheduler.isStarted('w4')).toBe(true);
    });

    it('starts nothing on a residency change once closed', () => {
      const resident = new Set<string>();
      const scheduler = setupWithResidency(resident);

      registerVisible(scheduler, [
        ['w1', 'S1'],
        ['w2', 'S2'],
        ['w3', 'S3'],
      ]);
      scheduler.close();
      resident.add('S3');
      scheduler.refreshResidency();

      expect(scheduler.isStarted('w3')).toBe(false);
    });
  });

  it('ignores the unregister of a registration that was replaced', () => {
    const { scheduler } = setup();
    const unregisterFirst = scheduler.register({ id: 'w1', sourceId: 'S1' });

    scheduler.register({ id: 'w1', sourceId: 'S1' });
    scheduler.setVisibility([['w1', true]]);
    unregisterFirst();

    expect(scheduler.isStarted('w1')).toBe(true);
  });
});
