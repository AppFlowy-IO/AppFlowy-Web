/**
 * Dashboard multi-source loading (addendum A9): the shared constants and the
 * pure scheduler that decides which widgets start loading now.
 *
 * The constants are copied from `dashboard-parity/tokens.json` `loading` (the
 * file desktop reads too) and `dashboard-tokens.test.ts` fails when the two
 * disagree. The scheduler is driven by `dashboard-parity/loading-schedule.json`
 * on both clients (`dashboard-loading.fixtures.test.ts` here), so change the
 * fixture and this file together. Pure: no React, no DOM, no I/O.
 */

/** Exactly `tokens.json` `loading`. */
export const DASHBOARD_LOADING = {
  /**
   * A hard cap: at most this many distinct source databases load cold at a time. The host and the
   * sources whose rows are resident already are not counted.
   */
  maxConcurrentSources: 2,
  /** Off-screen widgets start this long after the first visible widget started, first data or not. */
  deferredStartTimeoutMs: 10000,
  /** Off-screen widgets start in the background only while the open sources hold at most this many rows. */
  rowBudget: 10000,
  /** A source with no attached widget is released this long after the last one detached. */
  sourceIdleReleaseMs: 60000,
} as const;

export interface DashboardLoadingConstants {
  maxConcurrentSources: number;
  deferredStartTimeoutMs: number;
  rowBudget: number;
  sourceIdleReleaseMs: number;
}

/**
 * - `idle`: not started yet (queued or deferred); the widget shows its header and the loading placeholder.
 * - `loading`: started; its source holds a slot, unless it is the host or resident.
 * - `suspended`: started, then paused because it went off-screen; holds no slot.
 * - `done`: complete, failed, unavailable or cancelled; holds no slot.
 */
export type DashboardWidgetLoadState = 'idle' | 'loading' | 'suspended' | 'done';

export interface DashboardLoadWidget {
  id: string;
  /** The database the widget's view belongs to. */
  sourceId: string;
  /** Whether the widget intersects the viewport. */
  visible: boolean;
  state: DashboardWidgetLoadState;
  /** Whether the widget has shown something real (a count, its first rows or matches). */
  firstData: boolean;
}

export interface DashboardLoadPlanInput {
  /** The clock, in ms. */
  now: number;
  constants: DashboardLoadingConstants;
  /** The database of the dashboard view itself. It is open already, so it never needs a slot. */
  hostSourceId: string;
  /** The dashboard was left: nothing starts any more. */
  closed: boolean;
  /**
   * When the first visible widget started, in ms; `null` while none has. When
   * this plan starts the first one, the deferred timeout counts from `now`.
   */
  visibleStartedAt: number | null;
  /** The known row count of every open source. */
  sourceRows: Record<string, number>;
  /**
   * The sources whose rows the client holds in memory already, so a widget of
   * one loads nothing cold: it starts without a slot, and its loading widgets
   * hold none. Omitted: every source is cold.
   *
   * On web a source is resident while the tab holds a settled row walk of the
   * database with its complete seed set (`settled` and `hasCompleteSeedSet`
   * in `database-blob`, not invalidated by a restore) whose seeds were not
   * released: a mounted view retains the database, or the last one left it
   * less than `sourceIdleReleaseMs` ago. A walk in flight is not resident.
   * `loading-schedule.json` `format.residency` defines it for desktop too.
   */
  residentSources?: readonly string[];
  /** In layout order: top to bottom, left to right. */
  widgets: DashboardLoadWidget[];
}

export interface DashboardLoadPlan {
  /** The widgets to start now, in start order. */
  start: string[];
  /** When to plan again although nothing was reported, in ms; `null` when no timer is needed. */
  nextWakeAt: number | null;
}

/**
 * The distinct sources that hold a slot: those of the `loading` widgets, the
 * host and the resident sources excluded. Only cold loads count.
 */
export function busyDashboardSources(
  widgets: DashboardLoadWidget[],
  hostSourceId: string,
  residentSources: Iterable<string> = []
): Set<string> {
  const resident = new Set(residentSources);
  const busy = new Set<string>();

  widgets.forEach((widget) => {
    if (widget.state === 'loading' && widget.sourceId !== hostSourceId && !resident.has(widget.sourceId)) {
      busy.add(widget.sourceId);
    }
  });
  return busy;
}

/**
 * Which widgets start loading now. Run it again on every `first-data` and
 * `done` report, on every visibility change and at `nextWakeAt`.
 *
 * 1. A closed dashboard starts nothing.
 * 2. A source is busy while one of its widgets is `loading`; the host and the
 *    resident sources are never busy, so only cold loads count. At most
 *    `maxConcurrentSources` sources are busy at a time.
 * 3. Candidates are the `idle` widgets and the `suspended` widgets that are
 *    visible again: the visible ones first, then the others, each group in
 *    layout order.
 * 4. A candidate of the host, of a resident source or of a busy source starts
 *    at once and takes no slot. Residency changes nothing else: such a
 *    candidate keeps its place in the order of 3 and the deferral of 6.
 * 5. Any other candidate starts only while a slot is free, and takes it.
 * 6. A candidate that is not visible starts only once every visible widget has
 *    its first data or is done, or `deferredStartTimeoutMs` after the first
 *    visible widget started, and only while the open sources hold at most
 *    `rowBudget` rows. The budget never holds a visible widget back.
 * 7. `nextWakeAt` is that timeout while waiting for it is the only thing that
 *    holds a candidate back.
 */
export function planDashboardLoads(input: DashboardLoadPlanInput): DashboardLoadPlan {
  const { now, constants, hostSourceId, closed, widgets } = input;

  if (closed) return { start: [], nextWakeAt: null };

  const resident = new Set(input.residentSources ?? []);
  const busy = busyDashboardSources(widgets, hostSourceId, resident);
  const needsNoSlot = (widget: DashboardLoadWidget) =>
    widget.sourceId === hostSourceId || resident.has(widget.sourceId) || busy.has(widget.sourceId);
  const canStart = (widget: DashboardLoadWidget) => needsNoSlot(widget) || busy.size < constants.maxConcurrentSources;
  const start: string[] = [];
  const startInOrder = (candidates: DashboardLoadWidget[]) => {
    candidates.forEach((widget) => {
      if (!canStart(widget)) return;
      if (!needsNoSlot(widget)) busy.add(widget.sourceId);
      start.push(widget.id);
    });
  };

  const visibleCandidates = widgets.filter(
    (widget) => widget.visible && (widget.state === 'idle' || widget.state === 'suspended')
  );
  const deferredCandidates = widgets.filter((widget) => !widget.visible && widget.state === 'idle');

  startInOrder(visibleCandidates);
  if (deferredCandidates.length === 0) return { start, nextWakeAt: null };

  const openRows = Object.values(input.sourceRows).reduce((total, rows) => total + rows, 0);

  if (openRows > constants.rowBudget) return { start, nextWakeAt: null };

  const visibleStartedAt = input.visibleStartedAt ?? (start.length > 0 ? now : null);
  const timeoutAt = visibleStartedAt === null ? null : visibleStartedAt + constants.deferredStartTimeoutMs;
  const visibleSettled = widgets.every((widget) => !widget.visible || widget.firstData || widget.state === 'done');

  if (visibleSettled || (timeoutAt !== null && now >= timeoutAt)) {
    startInOrder(deferredCandidates);
    return { start, nextWakeAt: null };
  }

  return { start, nextWakeAt: deferredCandidates.some(canStart) ? timeoutAt : null };
}
