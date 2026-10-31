import {
  createContext,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
} from 'react';

import { isDatabaseSourceResident, subscribeToDatabaseSourceResidency } from '@/application/database-blob';
import { dashboardLoadStats, isDashboardLoadStatsRecording } from '@/application/database-yjs/dashboard-load-stats';

import { createDashboardLoadScheduler, DashboardLoadScheduler, WidgetLoadReport } from './load-scheduler';

/** A widget of the host database asking to start before the first paint when its box is on screen. */
interface BeforePaintRead {
  id: string;
  box: RefObject<Element>;
  /** Renders the widget again, so it reads that it started. */
  rerender: () => void;
}

interface DashboardLoadSchedulerContextValue {
  scheduler: DashboardLoadScheduler;
  hostSourceId: string;
  /** Follows whether the widget box intersects the dashboard's viewport, until the returned cleanup runs. */
  observe: (id: string, element: Element) => () => void;
  /**
   * Reads the box of a host widget once, before the first paint: on screen,
   * the widget is marked visible and can take a view-startup slot before
   * paint. The returned cleanup drops a read that has not happened yet.
   */
  startBeforePaint: (read: BeforePaintRead) => () => void;
}

const DashboardLoadSchedulerContext = createContext<DashboardLoadSchedulerContextValue | null>(null);

const VIEWPORT_VISIBILITY_ATTRIBUTE = 'data-dashboard-visible';

/** A CSS signal: scrolling must not rerender cached views merely to pause their queued spinners. */
function reflectViewportVisibility(element: Element, visible: boolean) {
  const value = String(visible);

  if (element.getAttribute(VIEWPORT_VISIBILITY_ATTRIBUTE) !== value) {
    element.setAttribute(VIEWPORT_VISIBILITY_ATTRIBUTE, value);
  }
}

/** Whether `value`, a computed `overflow-x` or `overflow-y`, clips the content of its box. */
function clipsContent(value: string) {
  return value !== '' && value !== 'visible';
}

/**
 * Whether the box intersects the viewport, clipped by every ancestor that
 * clips its content: what the dashboard's `IntersectionObserver` reports
 * first (`isIntersecting`), read synchronously. As for the observer, touching
 * edges count, and so does a box with no area that lies inside.
 */
function intersectsViewport(element: Element): boolean {
  const box = element.getBoundingClientRect();
  let top = Math.max(box.top, 0);
  let left = Math.max(box.left, 0);
  let bottom = Math.min(box.bottom, window.innerHeight);
  let right = Math.min(box.right, window.innerWidth);

  for (
    let ancestor = element.parentElement;
    ancestor && ancestor !== document.body && top <= bottom && left <= right;
    ancestor = ancestor.parentElement
  ) {
    const { overflowX, overflowY } = window.getComputedStyle(ancestor);

    if (!clipsContent(overflowX) && !clipsContent(overflowY)) continue;
    const clip = ancestor.getBoundingClientRect();

    top = Math.max(top, clip.top);
    left = Math.max(left, clip.left);
    bottom = Math.min(bottom, clip.bottom);
    right = Math.min(right, clip.right);
  }

  return top <= bottom && left <= right;
}

/**
 * Tells the queue which of `reads` have their box on screen, in one plan, and
 * renders again those that started. Only "visible" is told: an off-screen
 * widget waits for the observer's report of every box, so it is never planned
 * against a partial view of the dashboard.
 */
function startOnScreenBeforePaint(scheduler: DashboardLoadScheduler, reads: BeforePaintRead[]) {
  const onScreen = reads.filter(({ id, box }) => {
    const element = box.current;

    return element !== null && !scheduler.isStarted(id) && intersectsViewport(element);
  });

  if (onScreen.length === 0) return;
  onScreen.forEach(({ box }) => {
    if (box.current) reflectViewportVisibility(box.current, true);
  });
  scheduler.setVisibility(onScreen.map(({ id }) => [id, true] as [string, boolean]));
  onScreen.forEach(({ id, rerender }) => {
    if (scheduler.isStarted(id)) rerender();
  });
}

const noop = () => undefined;

/**
 * What a started widget shows when it looks empty: a grid that lists no row,
 * a chart without data, a number with no row to count. Before the widget's
 * load is complete that is a wrong answer, which the load counters record
 * (`emptyStateSamples`, development and test builds only).
 */
const EMPTY_STATE_SELECTOR = [
  '[data-testid="database-grid"][data-row-count="0"]',
  '[data-testid="chart-no-data"]',
  '[data-testid="number-chart-empty"]',
].join(', ');

interface DashboardLoadSchedulerProviderProps {
  /** The dashboard's own database: open already, so its widgets never take a slot. */
  hostSourceId: string;
  /** The dashboard's root element: test builds sample the widgets inside it for empty states. */
  scrollRef: RefObject<HTMLElement>;
  /** Every widget id in layout order: top to bottom, left to right. */
  order: string[];
  children: ReactNode;
}

/**
 * Queues the widgets of one open dashboard (`load-scheduler.ts`): visible
 * views only, the host database's included, at most two unfinished view
 * startups and two source databases loading cold at a time. The host and a
 * resident database skip only the source I/O budget (`isDatabaseSourceResident`). It watches
 * every widget box with one `IntersectionObserver` on the viewport (every
 * widget counts as visible where the browser has none). Unmounting it
 * (leaving the dashboard) closes the queue: nothing starts afterwards.
 *
 * The viewport, not the dashboard's own scroll box: in the app that box grows
 * with its rows and the page scroller around it scrolls, and the viewport
 * root clips a box by every scrolling ancestor, whichever one scrolls.
 */
export function DashboardLoadSchedulerProvider({
  hostSourceId,
  scrollRef,
  order,
  children,
}: DashboardLoadSchedulerProviderProps) {
  const scheduler = useMemo(
    () => createDashboardLoadScheduler({ hostSourceId, isSourceResident: isDatabaseSourceResident }),
    [hostSourceId]
  );
  // Every observed widget box, by element; the observer is created after the widgets' first effects.
  const targetsRef = useRef(new Map<Element, string>());
  // The host widgets whose box this commit has not placed yet when they registered, by widget id.
  const beforePaintRef = useRef(new Map<string, BeforePaintRead>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  // The browser has no IntersectionObserver: every widget counts as visible.
  const allVisibleRef = useRef(typeof IntersectionObserver === 'undefined');
  const orderKey = order.join('\n');

  // A layout effect: when the dashboard unmounts, the queue closes before its
  // widgets unregister (their layout cleanups run after this one), so the
  // slots they give back start nothing.
  useLayoutEffect(() => {
    scheduler.open();
    return () => scheduler.close();
  }, [scheduler]);

  // After every commit of the dashboard, before the paint: React attaches a
  // widget box's ref after the layout effects inside it, so the host widgets
  // that registered in this commit have their box only now. Those on screen
  // start, all in one plan.
  useLayoutEffect(() => {
    const pending = beforePaintRef.current;

    if (pending.size === 0) return;
    const reads = Array.from(pending.values());

    pending.clear();
    startOnScreenBeforePaint(scheduler, reads);
  });

  useEffect(() => {
    scheduler.setOrder(orderKey ? orderKey.split('\n') : []);
  }, [orderKey, scheduler]);

  // A walk that settles makes its database resident, and a release ends that: both change the free slots.
  useEffect(() => subscribeToDatabaseSourceResidency(scheduler.refreshResidency), [scheduler]);

  useEffect(() => {
    const targets = targetsRef.current;

    if (allVisibleRef.current) {
      targets.forEach((_id, element) => reflectViewportVisibility(element, true));
      scheduler.setVisibility(Array.from(targets.values(), (id) => [id, true] as [string, boolean]));
      return;
    }

    const observer = new IntersectionObserver((records) => {
      const changes: [string, boolean][] = [];

      records.forEach((record) => {
        const id = targets.get(record.target);

        if (id !== undefined) {
          reflectViewportVisibility(record.target, record.isIntersecting);
          changes.push([id, record.isIntersecting]);
        }
      });
      scheduler.setVisibility(changes);
    });

    observerRef.current = observer;
    targets.forEach((_id, element) => observer.observe(element));
    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
    };
  }, [scheduler]);

  // Test builds: a started widget that looks empty before its load completes is counted, at every DOM change.
  useEffect(() => {
    const root = scrollRef.current;

    if (!root || typeof MutationObserver === 'undefined' || !isDashboardLoadStatsRecording()) return;
    const targets = targetsRef.current;
    const sample = () => {
      const loading = new Set(scheduler.loadingWidgetIds());

      if (loading.size === 0) return;
      targets.forEach((id, element) => {
        if (!loading.has(id) || !element.querySelector(EMPTY_STATE_SELECTOR)) return;
        dashboardLoadStats.recordEmptyStateSample(id);
      });
    };

    const observer = new MutationObserver(sample);

    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-row-count'] });
    return () => observer.disconnect();
  }, [scheduler, scrollRef]);

  const observe = useCallback(
    (id: string, element: Element) => {
      const targets = targetsRef.current;

      targets.set(element, id);
      if (!element.hasAttribute(VIEWPORT_VISIBILITY_ATTRIBUTE)) {
        reflectViewportVisibility(element, allVisibleRef.current);
      }

      if (observerRef.current) observerRef.current.observe(element);
      else if (allVisibleRef.current) scheduler.setVisibility([[id, true]]);
      return () => {
        if (targets.get(element) === id) targets.delete(element);
        observerRef.current?.unobserve(element);
        element.removeAttribute(VIEWPORT_VISIBILITY_ATTRIBUTE);
      };
    },
    [scheduler]
  );

  const startBeforePaint = useCallback(
    (read: BeforePaintRead) => {
      // A widget that remounted inside its box reads it at once.
      if (read.box.current) {
        startOnScreenBeforePaint(scheduler, [read]);
        return noop;
      }

      const pending = beforePaintRef.current;

      pending.set(read.id, read);
      return () => {
        if (pending.get(read.id) === read) pending.delete(read.id);
      };
    },
    [scheduler]
  );

  const value = useMemo(
    () => ({ scheduler, hostSourceId, observe, startBeforePaint }),
    [hostSourceId, observe, scheduler, startBeforePaint]
  );

  return <DashboardLoadSchedulerContext.Provider value={value}>{children}</DashboardLoadSchedulerContext.Provider>;
}

const subscribeNothing = () => () => undefined;

interface WidgetLoadStartOptions {
  widgetId: string;
  /** The database of the widget's view. */
  sourceId: string;
  /** The widget box: its visibility orders the queue. */
  boxRef: RefObject<Element>;
  /** Its source doc was shown before a move: transfer its existing view admission. */
  resume: boolean;
}

export interface WidgetLoadStart {
  /** Whether the widget may open its source database and mount its `Database`. */
  started: boolean;
  /** Reports the load of a started widget; see `WidgetLoadReport`. Stable. */
  report: (report: WidgetLoadReport) => void;
}

/**
 * A widget's turn to load. Until it is granted the widget shows its header and
 * the loading placeholder, and loads nothing. A widget that resumes after a
 * move transfers its existing admission. Outside a dashboard there is no queue. A widget
 * of the host database is queued like the others, but takes no source I/O
 * slot: an on-screen box may take a view-startup slot before the first paint.
 * Unmounting gives its slots back.
 */
export function useWidgetLoadStart({ widgetId, sourceId, boxRef, resume }: WidgetLoadStartOptions): WidgetLoadStart {
  const context = useContext(DashboardLoadSchedulerContext);
  const scheduler = context?.scheduler ?? null;
  const observe = context?.observe;
  const startBeforePaint = context?.startBeforePaint;
  const isHostSource = context !== null && sourceId === context.hostSourceId;
  const resumeRef = useRef(resume);
  // Reports reach the scheduler only while this widget's registration is the current one.
  const registeredRef = useRef(false);
  const [, renderAgain] = useReducer((count: number) => count + 1, 0);

  // A layout effect: registered before the passive effects of the nested database, which may report at once.
  useLayoutEffect(() => {
    if (!scheduler) return;
    const unregister = scheduler.register({ id: widgetId, sourceId, resume: resumeRef.current });

    registeredRef.current = true;
    // A host widget needs no source I/O slot. Read its box before paint so
    // visible work can use the view-startup budget without waiting for the
    // observer's first report.
    const cancelRead =
      isHostSource && startBeforePaint ? startBeforePaint({ id: widgetId, box: boxRef, rerender: renderAgain }) : noop;

    return () => {
      registeredRef.current = false;
      cancelRead();
      unregister();
    };
  }, [boxRef, isHostSource, scheduler, sourceId, startBeforePaint, widgetId]);

  useEffect(() => {
    const element = boxRef.current;

    if (!observe || !element) return;
    return observe(widgetId, element);
  }, [boxRef, observe, widgetId]);

  const subscribe = scheduler ? scheduler.subscribe : subscribeNothing;
  const getStarted = useCallback(() => (scheduler ? scheduler.loadGeneration(widgetId) : 1), [scheduler, widgetId]);
  const granted = useSyncExternalStore(subscribe, getStarted, getStarted);
  const report = useCallback(
    (next: WidgetLoadReport) => {
      if (scheduler && registeredRef.current) scheduler.report(widgetId, next, granted);
    },
    [granted, scheduler, widgetId]
  );

  // Decided while rendering for the widgets that never wait, so they never flash the placeholder.
  const started = !context || granted > 0;

  return { started, report };
}

/** Tells the dashboard's queue how many rows an open source holds (its row budget). No-op outside a dashboard. */
export function useReportSourceRows(sourceId: string, rows: number | undefined) {
  const scheduler = useContext(DashboardLoadSchedulerContext)?.scheduler;

  useEffect(() => {
    if (scheduler && rows !== undefined) scheduler.setSourceRows(sourceId, rows);
  }, [rows, scheduler, sourceId]);
}
