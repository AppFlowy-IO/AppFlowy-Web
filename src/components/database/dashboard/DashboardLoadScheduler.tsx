import {
  createContext,
  ReactNode,
  RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import { isDatabaseSourceResident, subscribeToDatabaseSourceResidency } from '@/application/database-blob';
import { dashboardLoadStats, isDashboardLoadStatsRecording } from '@/application/database-yjs/dashboard-load-stats';

import { createDashboardLoadScheduler, DashboardLoadScheduler, WidgetLoadReport } from './load-scheduler';

interface DashboardLoadSchedulerContextValue {
  scheduler: DashboardLoadScheduler;
  hostSourceId: string;
  /** Follows whether the widget box intersects the dashboard's viewport, until the returned cleanup runs. */
  observe: (id: string, element: Element) => () => void;
}

const DashboardLoadSchedulerContext = createContext<DashboardLoadSchedulerContextValue | null>(null);

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
  /** The dashboard's own database: its widgets start at once. */
  hostSourceId: string;
  /** The dashboard's root element: test builds sample the widgets inside it for empty states. */
  scrollRef: RefObject<HTMLElement>;
  /** Every widget id in layout order: top to bottom, left to right. */
  order: string[];
  children: ReactNode;
}

/**
 * Queues the widgets of one open dashboard (`load-scheduler.ts`): visible
 * widgets first, at most two source databases loading cold at a time (a
 * database whose settled walk the tab still holds is resident: its widgets
 * take no slot, see `isDatabaseSourceResident`). It watches
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

  useEffect(() => {
    scheduler.setOrder(orderKey ? orderKey.split('\n') : []);
  }, [orderKey, scheduler]);

  // A walk that settles makes its database resident, and a release ends that: both change the free slots.
  useEffect(() => subscribeToDatabaseSourceResidency(scheduler.refreshResidency), [scheduler]);

  useEffect(() => {
    const targets = targetsRef.current;

    if (allVisibleRef.current) {
      scheduler.setVisibility(Array.from(targets.values(), (id) => [id, true] as [string, boolean]));
      return;
    }

    const observer = new IntersectionObserver((records) => {
      const changes: [string, boolean][] = [];

      records.forEach((record) => {
        const id = targets.get(record.target);

        if (id !== undefined) changes.push([id, record.isIntersecting]);
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
      if (observerRef.current) observerRef.current.observe(element);
      else if (allVisibleRef.current) scheduler.setVisibility([[id, true]]);
      return () => {
        if (targets.get(element) === id) targets.delete(element);
        observerRef.current?.unobserve(element);
      };
    },
    [scheduler]
  );

  const value = useMemo(() => ({ scheduler, hostSourceId, observe }), [hostSourceId, observe, scheduler]);

  return <DashboardLoadSchedulerContext.Provider value={value}>{children}</DashboardLoadSchedulerContext.Provider>;
}

const subscribeNothing = () => () => undefined;

interface WidgetLoadStartOptions {
  widgetId: string;
  /** The database of the widget's view. */
  sourceId: string;
  /** The widget box: its visibility orders the queue. */
  boxRef: RefObject<Element>;
  /** The widget showed its view before it remounted (a move): it starts at once. */
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
 * the loading placeholder, and loads nothing. A widget of the host database,
 * a widget that resumes after a move and a widget outside a dashboard (no
 * scheduler) start at once. Unmounting gives the slot back.
 */
export function useWidgetLoadStart({ widgetId, sourceId, boxRef, resume }: WidgetLoadStartOptions): WidgetLoadStart {
  const context = useContext(DashboardLoadSchedulerContext);
  const scheduler = context?.scheduler ?? null;
  const observe = context?.observe;
  const resumeRef = useRef(resume);
  // Reports reach the scheduler only while this widget's registration is the current one.
  const registeredRef = useRef(false);

  // A layout effect: registered before the passive effects of the nested database, which may report at once.
  useLayoutEffect(() => {
    if (!scheduler) return;
    const unregister = scheduler.register({ id: widgetId, sourceId, resume: resumeRef.current });

    registeredRef.current = true;
    return () => {
      registeredRef.current = false;
      unregister();
    };
  }, [scheduler, sourceId, widgetId]);

  useEffect(() => {
    const element = boxRef.current;

    if (!observe || !element) return;
    return observe(widgetId, element);
  }, [boxRef, observe, widgetId]);

  const subscribe = scheduler ? scheduler.subscribe : subscribeNothing;
  const getStarted = useCallback(() => (scheduler ? scheduler.isStarted(widgetId) : true), [scheduler, widgetId]);
  const granted = useSyncExternalStore(subscribe, getStarted, getStarted);
  const report = useCallback(
    (next: WidgetLoadReport) => {
      if (scheduler && registeredRef.current) scheduler.report(widgetId, next);
    },
    [scheduler, widgetId]
  );

  // Decided while rendering for the widgets that never wait, so they never flash the placeholder.
  const started = !context || granted || resume || sourceId === context.hostSourceId;

  return { started, report };
}

/** Tells the dashboard's queue how many rows an open source holds (its row budget). No-op outside a dashboard. */
export function useReportSourceRows(sourceId: string, rows: number | undefined) {
  const scheduler = useContext(DashboardLoadSchedulerContext)?.scheduler;

  useEffect(() => {
    if (scheduler && rows !== undefined) scheduler.setSourceRows(sourceId, rows);
  }, [rows, scheduler, sourceId]);
}
