/**
 * The loading rules of addendum A9 through the dashboard's load queue as the
 * widgets use it (`DashboardLoadSchedulerProvider`, `useWidgetLoadStart`,
 * `useReportSourceRows`), for the cases `load-scheduler.test.tsx` leaves out
 * (missing-dashboard-tests M3, M8, M16, M19): widgets that share a database,
 * two slow sources holding both slots, a layout that changes while widgets
 * wait, and the row budget fed by the widgets themselves.
 */
import { act, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';

import { dashboardLoadStats } from '@/application/database-yjs/dashboard-load-stats';
import { DASHBOARD_LOADING } from '@/application/database-yjs/dashboard-loading';

import { DashboardLoadSchedulerProvider, useReportSourceRows, useWidgetLoadStart } from '../DashboardLoadScheduler';
import { WidgetLoadReport } from '../load-scheduler';

// No source is resident: every load in these tests is cold.
jest.mock('@/application/database-blob', () => ({
  isDatabaseSourceResident: () => false,
  subscribeToDatabaseSourceResidency: () => () => undefined,
}));

/** Stands in for the browser's observer: the test decides which boxes intersect the viewport. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
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
  /** Rows its open source holds, reported once it started (the row budget). */
  rows?: number;
}

/** Every database mount, in order, and the widgets whose stand-in database is mounted now. */
const mounts: { widgetId: string; sourceId: string }[] = [];
const mounted = new Map<string, { sourceId: string; done: boolean }>();
const reporters = new Map<string, (report: WidgetLoadReport) => void>();

/** Stands in for `WidgetDatabaseHost`: mounting it is what loads the source, and it reports the source's size. */
function FakeDatabase({
  widgetId,
  sourceId,
  rows,
  report,
}: TestWidgetSpec & { widgetId: string; report: (report: WidgetLoadReport) => void }) {
  useReportSourceRows(sourceId, rows);
  useEffect(() => {
    mounts.push({ widgetId, sourceId });
    mounted.set(widgetId, { sourceId, done: false });
    reporters.set(widgetId, report);
    // As `WidgetDatabaseHost` does once the source settled and its database
    // mounted: the source load timeout (fix B4) no longer applies to it.
    report('opened');
    return () => {
      mounted.delete(widgetId);
      reporters.delete(widgetId);
    };
  }, [report, sourceId, widgetId]);
  return <div data-testid={`database-${widgetId}`} />;
}

function TestWidget({ id, sourceId, rows }: TestWidgetSpec) {
  const boxRef = useRef<HTMLDivElement>(null);
  const { started, report } = useWidgetLoadStart({ widgetId: id, sourceId, boxRef, resume: false });

  return (
    <div data-widget-id={id} ref={boxRef}>
      {started ? (
        <FakeDatabase id={id} report={report} rows={rows} sourceId={sourceId} widgetId={id} />
      ) : (
        <div data-testid={`placeholder-${id}`} />
      )}
    </div>
  );
}

function TestDashboard({ widgets }: { widgets: TestWidgetSpec[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <DashboardLoadSchedulerProvider hostSourceId='host' order={widgets.map((widget) => widget.id)} scrollRef={scrollRef}>
      <div ref={scrollRef}>
        {/* Keyed by source, as `DashboardWidget` keys its `WidgetSource`: a new source is a new mount. */}
        {widgets.map((widget) => (
          <TestWidget key={`${widget.id}:${widget.sourceId}`} {...widget} />
        ))}
      </div>
    </DashboardLoadSchedulerProvider>
  );
}

function observer() {
  const instance = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];

  if (!instance) throw new Error('The dashboard observes no widget');
  return instance;
}

/** The distinct sources with a mounted database whose load has not ended. */
function loadingSources() {
  const sources = new Set<string>();

  mounted.forEach(({ sourceId, done }) => {
    if (!done) sources.add(sourceId);
  });
  return sources;
}

function report(widgetId: string, next: WidgetLoadReport) {
  const reporter = reporters.get(widgetId);

  if (!reporter) throw new Error(`${widgetId} has no mounted database`);
  act(() => reporter(next));
  const entry = mounted.get(widgetId);

  if (entry && next !== 'first-data') entry.done = true;
}

function startedWidgetIds() {
  return dashboardLoadStats.snapshot().widgetStarts.map((start) => start.widgetId);
}

const originalIntersectionObserver = window.IntersectionObserver;

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  mounts.length = 0;
  mounted.clear();
  reporters.clear();
  dashboardLoadStats.reset();
  window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  window.IntersectionObserver = originalIntersectionObserver;
  jest.useRealTimers();
});

describe('widgets that share a database (M3)', () => {
  // Three rows of two: each database's two widgets side by side.
  const PAIRS: TestWidgetSpec[] = [
    { id: 'a1', sourceId: 'A' },
    { id: 'a2', sourceId: 'A' },
    { id: 'b1', sourceId: 'B' },
    { id: 'b2', sourceId: 'B' },
    { id: 'c1', sourceId: 'C' },
    { id: 'c2', sourceId: 'C' },
  ];

  it('start together on one slot: the cap counts databases, not widgets', () => {
    render(<TestDashboard widgets={PAIRS} />);
    observer().report(() => true);

    expect(Array.from(mounted.keys())).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(loadingSources()).toEqual(new Set(['A', 'B']));
    expect(screen.getByTestId('placeholder-c1')).toBeTruthy();
    expect(screen.getByTestId('placeholder-c2')).toBeTruthy();
    const stats = dashboardLoadStats.snapshot();

    expect(stats.maxConcurrentSourceLoads).toBe(DASHBOARD_LOADING.maxConcurrentSources);
    expect(stats.sourceLoads.map((load) => load.sourceId)).toEqual(['A', 'B']);
  });

  it('keep the slot until both widgets of the database are done, then the next database starts both of its widgets', () => {
    render(<TestDashboard widgets={PAIRS} />);
    observer().report(() => true);

    report('a1', 'complete');
    // a2 still loads A: the slot is not free.
    expect(mounted.has('c1')).toBe(false);
    expect(loadingSources()).toEqual(new Set(['A', 'B']));

    report('a2', 'failed');
    expect(Array.from(mounted.keys()).filter((id) => id.startsWith('c'))).toEqual(['c1', 'c2']);
    expect(loadingSources()).toEqual(new Set(['B', 'C']));
    const stats = dashboardLoadStats.snapshot();

    expect(stats.maxConcurrentSourceLoads).toBe(2);
    // One slot interval per database, whatever its widget count.
    expect(stats.sourceLoads.map((load) => load.sourceId)).toEqual(['A', 'B', 'C']);
    expect(stats.sourceLoads.find((load) => load.sourceId === 'A')?.end).not.toBeNull();
  });
});

describe('two slow sources (M8: the cap is hard)', () => {
  const EIGHT: TestWidgetSpec[] = Array.from({ length: 8 }, (_, index) => ({
    id: `w${index + 1}`,
    sourceId: `S${index + 1}`,
  }));

  it('hold both slots past the deferred timeout: nothing else starts until one of them is done', () => {
    jest.useFakeTimers();
    render(<TestDashboard widgets={EIGHT} />);
    const visible = new Set(['w1', 'w2', 'w3', 'w4']);

    observer().report((id) => visible.has(id));
    expect(startedWidgetIds()).toEqual(['w1', 'w2']);

    // Neither slow source shows anything for three deferred timeouts.
    act(() => {
      jest.advanceTimersByTime(DASHBOARD_LOADING.deferredStartTimeoutMs * 3);
    });

    expect(startedWidgetIds()).toEqual(['w1', 'w2']);
    expect(Array.from(mounted.keys())).toEqual(['w1', 'w2']);
    // Every other widget, visible or not, waits with its placeholder.
    EIGHT.slice(2).forEach(({ id }) => expect(screen.getByTestId(`placeholder-${id}`)).toBeTruthy());
    expect(dashboardLoadStats.snapshot().maxConcurrentSourceLoads).toBe(2);

    report('w2', 'complete');
    // The freed slot goes to the next visible widget, then the deferred ones (their timeout ran out) follow.
    expect(startedWidgetIds()).toEqual(['w1', 'w2', 'w3']);
    expect(loadingSources()).toEqual(new Set(['S1', 'S3']));
  });
});

describe('a layout that changes while widgets wait (M16)', () => {
  const FOUR: TestWidgetSpec[] = Array.from({ length: 4 }, (_, index) => ({
    id: `w${index + 1}`,
    sourceId: `S${index + 1}`,
  }));

  it('never loads the database of a widget removed while it waits', () => {
    const { rerender } = render(<TestDashboard widgets={FOUR} />);

    observer().report(() => true);
    rerender(<TestDashboard widgets={FOUR.filter((widget) => widget.id !== 'w3')} />);
    report('w1', 'complete');
    report('w2', 'complete');

    expect(mounts.map((mount) => mount.widgetId)).toEqual(['w1', 'w2', 'w4']);
    expect(dashboardLoadStats.snapshot().sourceLoads.map((load) => load.sourceId)).not.toContain('S3');
    expect(startedWidgetIds()).not.toContain('w3');
  });

  it('starts the waiting widgets in the new layout order after a reorder', () => {
    const { rerender } = render(<TestDashboard widgets={FOUR} />);

    observer().report(() => true);
    expect(startedWidgetIds()).toEqual(['w1', 'w2']);
    // A collaborator moves w4 in front of w3 while both wait.
    rerender(<TestDashboard widgets={[FOUR[0], FOUR[1], FOUR[3], FOUR[2]]} />);
    report('w1', 'complete');

    expect(startedWidgetIds()).toEqual(['w1', 'w2', 'w4']);
    expect(screen.getByTestId('placeholder-w3')).toBeTruthy();
  });

  it("frees the old source's slot and queues the new source when a loading widget's source is replaced", () => {
    const { rerender } = render(<TestDashboard widgets={FOUR} />);
    const starts = () =>
      dashboardLoadStats.snapshot().widgetStarts.map((start) => `${start.widgetId}:${start.sourceId}`);

    observer().report(() => true);
    expect(loadingSources()).toEqual(new Set(['S1', 'S2']));
    // Settings › Source: w1 now shows a view of another database, S9. Its S1 load is dropped.
    rerender(<TestDashboard widgets={[{ id: 'w1', sourceId: 'S9' }, ...FOUR.slice(1)]} />);
    observer().report(() => true);

    const stats = dashboardLoadStats.snapshot();

    expect(stats.sourceLoads.find((load) => load.sourceId === 'S1')?.end).not.toBeNull();
    expect(loadingSources().has('S1')).toBe(false);
    expect(loadingSources().size).toBe(2);
    expect(stats.maxConcurrentSourceLoads).toBe(2);
    // The new source waits for a slot like any other cold load.
    expect(screen.getByTestId('placeholder-w1')).toBeTruthy();

    report('w2', 'complete');
    // First in layout order among the waiting widgets: w1 on its new source, before w4.
    expect(starts()).toEqual(['w1:S1', 'w2:S2', 'w3:S3', 'w1:S9']);
    expect(screen.getByTestId('placeholder-w4')).toBeTruthy();
  });
});

describe('the row budget reported by the widgets (M19)', () => {
  it('keeps deferred widgets back while the open sources hold more than the budget, but never a visible one', () => {
    const widgets: TestWidgetSpec[] = [
      { id: 'w1', sourceId: 'S1', rows: DASHBOARD_LOADING.rowBudget + 1 },
      { id: 'w2', sourceId: 'S2', rows: 10 },
      { id: 'w3', sourceId: 'S3', rows: 10 },
      { id: 'w4', sourceId: 'S4', rows: 10 },
    ];

    render(<TestDashboard widgets={widgets} />);
    observer().report((id) => id === 'w1' || id === 'w2');
    report('w1', 'complete');
    report('w2', 'complete');

    // Both visible widgets showed their data, so the deferred ones may start, except over the row budget.
    expect(startedWidgetIds()).toEqual(['w1', 'w2']);
    expect(screen.getByTestId('placeholder-w3')).toBeTruthy();

    // Scrolled into view, a widget starts whatever the budget.
    observer().report((id) => id !== 'w4');
    expect(startedWidgetIds()).toEqual(['w1', 'w2', 'w3']);
    expect(screen.getByTestId('placeholder-w4')).toBeTruthy();
  });

  it('lets deferred widgets start in the background while the open sources stay under the budget', () => {
    const widgets: TestWidgetSpec[] = [
      { id: 'w1', sourceId: 'S1', rows: DASHBOARD_LOADING.rowBudget - 20 },
      { id: 'w2', sourceId: 'S2', rows: 10 },
      { id: 'w3', sourceId: 'S3', rows: 10 },
    ];

    render(<TestDashboard widgets={widgets} />);
    observer().report((id) => id === 'w1');
    report('w1', 'complete');

    expect(startedWidgetIds()).toEqual(['w1', 'w2', 'w3']);
  });
});
