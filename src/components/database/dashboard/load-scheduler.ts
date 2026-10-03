/**
 * The load queue of one open dashboard (addendum A9): which widgets may start
 * loading their source database now. It keeps the input of
 * `planDashboardLoads` (who is mounted, where in the layout, visible or not,
 * loading or done), plans again on every change and at the plan's wake time,
 * and tells each widget when it may start.
 *
 * - At most `maxConcurrentSources` distinct source databases load at a time;
 *   the host database never takes a slot, nor does a resident source (one
 *   whose rows the tab holds already, `isSourceResident`): only cold loads count.
 * - Visible widgets start first; the others wait for them (or the deferred
 *   timeout) and for a free slot.
 * - A widget holds its source's slot until it reports its load complete or
 *   failed, its source turns out unavailable, or it unmounts.
 * - A closed scheduler (the dashboard was left) starts nothing and keeps no timer.
 *
 * No React and no DOM here: `DashboardLoadScheduler.tsx` feeds it the widget
 * mounts and their visibility, and tells each widget its turn
 * (`useWidgetLoadStart`).
 */
import { dashboardLoadStats } from '@/application/database-yjs/dashboard-load-stats';
import {
  busyDashboardSources,
  DASHBOARD_LOADING,
  DashboardLoadingConstants,
  DashboardLoadWidget,
  DashboardWidgetLoadState,
  planDashboardLoads,
} from '@/application/database-yjs/dashboard-loading';

/**
 * What a started widget reports about its load:
 * - `first-data`: it shows something real (its first rows, matches or a value);
 * - `complete`: its rows and its derived result are complete;
 * - `failed`: the row download failed;
 * - `unavailable`: it shows a placeholder instead of its view (deleted, no access, offline, unsupported).
 *
 * All but `first-data` end the load and free the slot.
 */
export type WidgetLoadReport = 'first-data' | 'complete' | 'failed' | 'unavailable';

export interface WidgetLoadRegistration {
  id: string;
  /** The database of the widget's view. */
  sourceId: string;
  /**
   * The widget already showed its view on this dashboard (it remounted after a
   * move): it starts at once and holds no slot, as the load it needs again is
   * cached.
   */
  resume?: boolean;
}

export interface DashboardLoadSchedulerOptions {
  /** The database of the dashboard view: open already, its widgets start at once. */
  hostSourceId: string;
  /**
   * Whether the tab holds the rows of a source in memory already, so its
   * widgets load nothing cold: they start without a slot and hold none. Read at
   * every plan; call `refreshResidency` when it changes. Default: no source is.
   */
  isSourceResident?: (sourceId: string) => boolean;
  constants?: DashboardLoadingConstants;
  /** The clock, in ms. */
  now?: () => number;
}

export interface DashboardLoadScheduler {
  /** Adds a mounted widget; the returned function removes it (an unmount counts as done). */
  register: (widget: WidgetLoadRegistration) => () => void;
  /** Whether the widget may load its source: started, done or resumed. */
  isStarted: (id: string) => boolean;
  /** The widgets that started and have not finished loading. */
  loadingWidgetIds: () => string[];
  /** The widget ids in layout order: top to bottom, left to right. */
  setOrder: (ids: string[]) => void;
  /** Whether each widget intersects the dashboard's viewport. A widget is not planned before its first report. */
  setVisibility: (changes: Iterable<[id: string, visible: boolean]>) => void;
  /** The known row count of an open source (for the row budget). */
  setSourceRows: (sourceId: string, rows: number) => void;
  /** Which sources are resident changed (`isSourceResident`): plan again. */
  refreshResidency: () => void;
  report: (id: string, report: WidgetLoadReport) => void;
  /** Notified whenever a widget starts. */
  subscribe: (listener: () => void) => () => void;
  /** Plans again after `close` (a remount in StrictMode). */
  open: () => void;
  /** The dashboard was left: nothing starts any more and the wake timer is cleared. */
  close: () => void;
}

interface WidgetEntry {
  id: string;
  sourceId: string;
  /** Identifies the registration, so a stale unregister never removes a newer one. */
  token: symbol;
  /** `null` until the first visibility report. */
  visible: boolean | null;
  state: DashboardWidgetLoadState;
  firstData: boolean;
}

function toPlanWidget({ id, sourceId, visible, state, firstData }: WidgetEntry): DashboardLoadWidget {
  return { id, sourceId, visible: visible === true, state, firstData };
}

const noSourceResident = () => false;

export function createDashboardLoadScheduler({
  hostSourceId,
  isSourceResident = noSourceResident,
  constants = DASHBOARD_LOADING,
  now = Date.now,
}: DashboardLoadSchedulerOptions): DashboardLoadScheduler {
  const entries = new Map<string, WidgetEntry>();
  const listeners = new Set<() => void>();
  const sourceRows = new Map<string, number>();
  let layoutIndex = new Map<string, number>();
  let closed = false;
  let visibleStartedAt: number | null = null;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeAt: number | null = null;
  // The sources that hold a slot, as last recorded in the load counters.
  let slotSources = new Set<string>();

  const notify = () => listeners.forEach((listener) => listener());

  const clearWake = () => {
    if (wakeTimer !== null) clearTimeout(wakeTimer);
    wakeTimer = null;
    wakeAt = null;
  };

  /** The resident sources among the widgets' (the host left out: it never takes a slot), sorted. */
  const residentSources = () => {
    const resident = new Set<string>();

    entries.forEach(({ sourceId }) => {
      if (sourceId !== hostSourceId && !resident.has(sourceId) && isSourceResident(sourceId)) resident.add(sourceId);
    });
    return Array.from(resident).sort();
  };

  /**
   * Records slot use in the load counters: a source holds a slot while one of
   * its widgets is loading, unless it is resident.
   */
  const syncSlots = (resident: string[] = residentSources()) => {
    const busy = busyDashboardSources(Array.from(entries.values(), toPlanWidget), hostSourceId, resident);

    slotSources.forEach((sourceId) => {
      if (!busy.has(sourceId)) dashboardLoadStats.recordSourceLoadEnd(sourceId);
    });
    busy.forEach((sourceId) => {
      if (!slotSources.has(sourceId)) dashboardLoadStats.recordSourceLoadStart(sourceId);
    });
    slotSources = busy;
  };

  const markStarted = (entry: WidgetEntry, at: number) => {
    entry.state = 'loading';
    if (entry.visible && visibleStartedAt === null) visibleStartedAt = at;
    dashboardLoadStats.recordWidgetStart({
      widgetId: entry.id,
      sourceId: entry.sourceId,
      visibleAtStart: entry.visible === true,
      at,
    });
  };

  /** The rows held by the sources that are open: those with a started widget. */
  const openSourceRows = () => {
    const open: Record<string, number> = {};

    entries.forEach((entry) => {
      if (entry.state === 'idle') return;
      const rows = sourceRows.get(entry.sourceId);

      if (rows !== undefined) open[entry.sourceId] = rows;
    });
    return open;
  };

  /** The planned widgets in layout order; a widget whose visibility is not known yet is left out. */
  const plannedWidgets = (): DashboardLoadWidget[] => {
    const known = Array.from(entries.values()).filter((entry) => entry.visible !== null);
    const position = (entry: WidgetEntry) => layoutIndex.get(entry.id) ?? Number.MAX_SAFE_INTEGER;

    // `sort` is stable: widgets missing from the layout keep their mount order, after the others.
    return known.sort((a, b) => position(a) - position(b)).map(toPlanWidget);
  };

  const scheduleWake = (at: number | null) => {
    if (at === wakeAt) return;
    clearWake();
    if (at === null || closed) return;
    wakeAt = at;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      wakeAt = null;
      plan();
    }, Math.max(0, at - now()));
  };

  function plan() {
    if (closed) {
      clearWake();
      return;
    }

    const at = now();
    const resident = residentSources();
    const { start, nextWakeAt } = planDashboardLoads({
      now: at,
      constants,
      hostSourceId,
      closed,
      visibleStartedAt,
      sourceRows: openSourceRows(),
      residentSources: resident,
      widgets: plannedWidgets(),
    });

    start.forEach((id) => {
      const entry = entries.get(id);

      if (entry) markStarted(entry, at);
    });
    syncSlots(resident);
    scheduleWake(nextWakeAt);
    if (start.length > 0) notify();
  }

  return {
    register({ id, sourceId, resume = false }) {
      const token = Symbol(id);
      const entry: WidgetEntry = { id, sourceId, token, visible: null, state: 'idle', firstData: false };

      entries.set(id, entry);
      if (resume) {
        // It loaded before the move; its source's load is cached and takes no slot.
        entry.state = 'done';
        entry.firstData = true;
      } else if (sourceId === hostSourceId && !closed) {
        // The host database is open already: never queued.
        markStarted(entry, now());
      }

      plan();
      return () => {
        if (entries.get(id)?.token !== token) return;
        entries.delete(id);
        syncSlots();
        plan();
      };
    },

    isStarted(id) {
      const state = entries.get(id)?.state;

      return state !== undefined && state !== 'idle';
    },

    loadingWidgetIds() {
      return Array.from(entries.values())
        .filter((entry) => entry.state === 'loading')
        .map((entry) => entry.id);
    },

    setOrder(ids) {
      const next = new Map(ids.map((id, index) => [id, index]));

      if (next.size === layoutIndex.size && ids.every((id, index) => layoutIndex.get(id) === index)) return;
      layoutIndex = next;
      plan();
    },

    setVisibility(changes) {
      let changed = false;

      for (const [id, visible] of changes) {
        const entry = entries.get(id);

        if (!entry || entry.visible === visible) continue;
        entry.visible = visible;
        changed = true;
        // A widget started before it was seen (the host's) starts the deferred timeout once it shows.
        if (visible && entry.state !== 'idle' && visibleStartedAt === null) visibleStartedAt = now();
      }

      if (changed) plan();
    },

    setSourceRows(sourceId, rows) {
      if (sourceRows.get(sourceId) === rows) return;
      sourceRows.set(sourceId, rows);
      plan();
    },

    refreshResidency() {
      plan();
    },

    report(id, report) {
      const entry = entries.get(id);

      if (!entry || entry.state === 'idle') return;
      if (report === 'first-data' || report === 'complete') {
        entry.firstData = true;
        dashboardLoadStats.recordWidgetFirstData(id);
      }

      if (report === 'complete') dashboardLoadStats.recordWidgetComplete(id);
      if (report !== 'first-data') entry.state = 'done';
      syncSlots();
      plan();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    open() {
      if (!closed) return;
      closed = false;
      plan();
    },

    close() {
      closed = true;
      clearWake();
    },
  };
}
