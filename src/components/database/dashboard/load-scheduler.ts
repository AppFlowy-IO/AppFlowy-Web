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
 * - Only visible unfinished views start, at most two at once. This budget is
 *   independent of source I/O: host and resident views still initialize row
 *   bindings, derived data and subscriptions. Completed views stay mounted.
 * - A widget holds its source's slot until it reports its load complete or
 *   failed, its source turns out unavailable, or it unmounts. A widget whose
 *   source has not opened `sourceLoadTimeoutMs` after its start (its document
 *   or its permission probe never settled) is cancelled before its slot is
 *   reused; an opened source keeps its slot however slowly its rows load.
 * - Off-screen unfinished widgets unmount and acknowledge cancellation before
 *   their slot is reused. They resume only when visible again; completed views stay mounted.
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

// Source residency avoids downloads, not the work of initializing another view.
const MAX_CONCURRENT_VIEW_STARTUPS = 2;

/**
 * What a started widget reports about its load:
 * - `opened`: its source document and permission probe settled and its nested
 *   database mounted (the source load timeout no longer applies to it);
 * - `first-data`: it shows something real (its first rows, matches or a value);
 * - `complete`: its rows and its derived result are complete;
 * - `failed`: the row download failed;
 * - `suspended`: unmount cleanup cancelled an off-screen load; it may resume when visible;
 * - `unavailable`: it shows a placeholder instead of its view (deleted, no access, offline, unsupported).
 *
 * `complete`, `failed` and `unavailable` end the load and free the slot.
 */
export type WidgetLoadReport = 'opened' | 'first-data' | 'complete' | 'failed' | 'unavailable' | 'suspended';

export interface WidgetLoadRegistration {
  id: string;
  /** The database of the widget's view. */
  sourceId: string;
  /**
   * The source document was shown before a move. Transfer the existing view
   * admission: completed work stays complete; unfinished work keeps its slot.
   * A cached document alone never proves that view startup finished.
   */
  resume?: boolean;
}

export interface DashboardLoadSchedulerOptions {
  /**
   * The database of the dashboard view: open already, so its widgets take no
   * source I/O slots. Their view startups are still queued and bounded.
   */
  hostSourceId: string;
  /**
   * Whether the tab holds the rows of a source in memory already, so its
   * widgets load nothing cold: they hold no source I/O slot. Read at
   * every plan; call `refreshResidency` when it changes. Default: no source is.
   */
  isSourceResident?: (sourceId: string) => boolean;
  constants?: DashboardLoadingConstants;
  /** The clock, in ms. */
  now?: () => number;
}

export interface DashboardLoadScheduler {
  /** Adds a mounted widget; cleanup releases its slots after a same-commit move can transfer them. */
  register: (widget: WidgetLoadRegistration) => () => void;
  /** Whether the widget may load its source: started, done or resumed. */
  isStarted: (id: string) => boolean;
  /** Zero while queued; a unique generation for each mounted load. */
  loadGeneration: (id: string) => number;
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
  report: (id: string, report: WidgetLoadReport, generation?: number) => void;
  /** Notified whenever a widget starts or must suspend. */
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
  /** When the widget started, in ms; `null` while idle. */
  startedAt: number | null;
  /** The widget reported `opened`: its source settled, so the source load timeout no longer applies. */
  opened: boolean;
  generation: number;
  /** Keep the slot until the unmounted host has cancelled its requests. */
  suspending: boolean;
  /** Its source startup timed out; cancellation must finish before its slot is reused. */
  timedOut: boolean;
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
  let generation = 0;
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
    entry.timedOut = false;
    entry.generation = ++generation;
    entry.firstData = false;
    entry.startedAt = at;
    entry.opened = false;
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
      if (entry.state === 'idle' || entry.state === 'suspended') return;
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

  /** The started widgets the source load timeout still applies to: loading, not opened, and holding a slot. */
  const stallingEntries = () =>
    Array.from(entries.values()).filter(
      (entry) =>
        entry.state === 'loading' && !entry.suspending && !entry.opened && entry.startedAt !== null && entry.sourceId !== hostSourceId
    );

  /**
   * A stalled startup must not hold the queue forever, or keep running outside
   * its budget. Retire its host, then wait for the same cleanup acknowledgment
   * as a viewport cancellation. A later viewport revisit may retry it.
   */
  const releaseStalledLoads = (at: number) => {
    let changed = false;

    stallingEntries().forEach((entry) => {
      if (at - (entry.startedAt as number) < constants.sourceLoadTimeoutMs) return;
      entry.timedOut = true;
      entry.suspending = true;
      changed = true;
    });
    return changed;
  };

  /** When the next source load timeout falls due, or `null` when no started widget is waiting for its source. */
  const nextStallAt = () =>
    stallingEntries().reduce<number | null>((next, entry) => {
      const at = (entry.startedAt as number) + constants.sourceLoadTimeoutMs;

      return next === null || at < next ? at : next;
    }, null);

  const earliest = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

  function plan() {
    if (closed) {
      clearWake();
      return;
    }

    const at = now();

    const cancellingStalled = releaseStalledLoads(at);
    const resident = residentSources();
    // Keep cancellation-in-progress entries in both budgets. Unvisited boxes
    // have no background work to admit, even after the shared source planner's
    // deferral. That planner still owns source residency, deduplication and caps.
    const widgets = plannedWidgets().filter(
      (widget) => widget.visible || widget.state === 'loading' || widget.state === 'done'
    );
    const loadingViews = widgets.filter((widget) => widget.state === 'loading').length;
    const availableViews = Math.max(0, MAX_CONCURRENT_VIEW_STARTUPS - loadingViews);
    const { start: sourceStarts, nextWakeAt } = planDashboardLoads({
      now: at,
      constants,
      hostSourceId,
      closed,
      visibleStartedAt,
      sourceRows: openSourceRows(),
      residentSources: resident,
      widgets,
    });
    const start = sourceStarts.slice(0, availableViews);

    start.forEach((id) => {
      const entry = entries.get(id);

      if (entry) markStarted(entry, at);
    });
    syncSlots(resident);
    scheduleWake(earliest(nextWakeAt, nextStallAt()));
    if (start.length > 0 || cancellingStalled) notify();
  }

  return {
    register({ id, sourceId, resume = false }) {
      const previous = entries.get(id);
      const continuing = resume && previous?.sourceId === sourceId && !previous.suspending && !previous.timedOut;
      const token = Symbol(id);
      const entry: WidgetEntry = {
        id,
        sourceId,
        token,
        visible: null,
        state: 'idle',
        firstData: false,
        startedAt: null,
        opened: false,
        generation: ++generation,
        suspending: false,
        timedOut: false,
      };

      entries.set(id, entry);
      if (continuing) {
        // A shown document can still have unfinished rows/derived data. Move
        // that admission with its view instead of declaring the work complete.
        entry.visible = previous.visible;
        entry.state = previous.state;
        entry.firstData = previous.firstData;
        entry.startedAt = previous.startedAt;
        entry.opened = previous.opened;
      }

      plan();
      return () => {
        if (entries.get(id)?.token !== token) return;
        // A queued view owns no host or work to transfer. Remove it now so
        // another report in this commit cannot accidentally admit it.
        if (entry.state === 'idle' || entry.state === 'suspended') {
          entries.delete(id);
          syncSlots();
          plan();
          return;
        }

        // Match host cleanup: row retainers get their microtask to transfer or
        // cancel. A move registers its replacement in this commit and keeps
        // the same unfinished slot; a stale cleanup cannot release that slot.
        queueMicrotask(() => queueMicrotask(() => {
          if (entries.get(id)?.token !== token) return;
          entries.delete(id);
          syncSlots();
          plan();
        }));
      };
    },

    isStarted(id) {
      const entry = entries.get(id);

      return Boolean(
        entry && !entry.suspending && !entry.timedOut && (entry.state === 'loading' || entry.state === 'done')
      );
    },

    loadGeneration(id) {
      const entry = entries.get(id);

      return entry && !entry.suspending && !entry.timedOut && (entry.state === 'loading' || entry.state === 'done')
        ? entry.generation
        : 0;
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
        if (visible && entry.timedOut && entry.state === 'done') {
          entry.state = 'idle';
          entry.timedOut = false;
        }

        entry.visible = visible;
        changed = true;
        // A widget that started before it was seen (it resumed after a move, or started off-screen) starts the
        // deferred timeout once it shows.
        if (visible && entry.state !== 'idle' && visibleStartedAt === null) visibleStartedAt = now();
      }

      if (!changed) return;
      let suspending = false;

      entries.forEach((entry) => {
        if (entry.visible !== false || entry.suspending || entry.state !== 'loading') return;
        entry.suspending = true;
        suspending = true;
      });
      // Unmount unfinished off-screen hosts first. Their cleanup acknowledges
      // cancellation before the next source can take the released slot.
      if (suspending) notify();
      plan();
    },

    setSourceRows(sourceId, rows) {
      if (sourceRows.get(sourceId) === rows) return;
      sourceRows.set(sourceId, rows);
      plan();
    },

    refreshResidency() {
      plan();
    },

    report(id, report, generation) {
      const entry = entries.get(id);

      if (!entry || (generation !== undefined && entry.generation !== generation)) return;
      if (report === 'suspended') {
        if (!entry.suspending) return;
        entry.suspending = false;
        entry.state = entry.timedOut ? 'done' : 'suspended';
        entry.startedAt = null;
        entry.firstData = false;
        syncSlots();
        plan();
        return;
      }

      if (entry.suspending || entry.timedOut || entry.state === 'idle' || entry.state === 'suspended') return;
      if (report === 'opened') {
        if (entry.opened) return;
        entry.opened = true;
        // The source load timeout no longer applies to it: the wake is planned again.
        plan();
        return;
      }

      if (report === 'first-data' || report === 'complete') {
        entry.firstData = true;
        dashboardLoadStats.recordWidgetFirstData(id);
      }

      if (report === 'complete') dashboardLoadStats.recordWidgetComplete(id);
      if (report !== 'first-data') {
        entry.state = 'done';
        entry.timedOut = false;
      }

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
