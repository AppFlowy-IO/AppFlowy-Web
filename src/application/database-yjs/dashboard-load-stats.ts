/**
 * Dashboard load counters: how often each source database is opened, walked
 * and bound, in which order the widgets start, and how many sources load at
 * the same time. Desktop keeps the same counters under the same names.
 *
 * A test bridge only. Every `record*` is a no-op outside development and test
 * builds; there, `window.__DASHBOARD_LOAD_STATS__` exposes `snapshot()` and
 * `reset()` to the BDD steps. Nothing in the app reads the counters back.
 */
import { isDevelopmentOrTestEnvironment } from '@/utils/runtime-config';

export interface DashboardWidgetStart {
  widgetId: string;
  sourceId: string;
  visibleAtStart: boolean;
  /** ms since the epoch. */
  at: number;
}

export interface DashboardSourceLoad {
  sourceId: string;
  /** ms since the epoch. */
  start: number;
  /** `null` while the source still holds its slot. */
  end: number | null;
}

export interface DashboardSourceRelease {
  sourceId: string;
  reason: string;
}

export interface DashboardLoadStatsSnapshot {
  /** Times the database document was opened, by database id. */
  sourceOpens: Record<string, number>;
  /** Full passes over the rows of the database, from any caller. */
  rowLoadPasses: Record<string, number>;
  /** Rows that got a realtime binding. */
  rowsBound: Record<string, number>;
  /**
   * Rows of the database read from outside the tab's memory, by any reader:
   * every row of each blob/diff page fetched from the server, and each row a
   * view had to fetch on its own (from IndexedDB or its realtime sync) because
   * the tab held neither its data nor a seed of it. A reader served from
   * memory (a seed, a resident row document) reads nothing.
   */
  rowsRead: Record<string, number>;
  /** Full computations of a derived result, by its cache key. */
  derivedComputes: Record<string, number>;
  /** In start order. */
  widgetStarts: DashboardWidgetStart[];
  /** When each widget first showed something real, by widget id. */
  widgetFirstData: Record<string, number>;
  /** When each widget first completed, by widget id. */
  widgetComplete: Record<string, number>;
  /** Times a widget showed an empty state before it completed. */
  emptyStateSamples: Record<string, number>;
  /** The intervals during which a source held a load slot, in start order. */
  sourceLoads: DashboardSourceLoad[];
  /** The most sources that ever held a slot at the same time. */
  maxConcurrentSourceLoads: number;
  sourcesReleased: DashboardSourceRelease[];
}

export interface DashboardLoadStatsBridge {
  snapshot: () => DashboardLoadStatsSnapshot;
  reset: () => void;
}

type DashboardLoadStatsWindow = Window & { __DASHBOARD_LOAD_STATS__?: DashboardLoadStatsBridge };

function emptyStats(): DashboardLoadStatsSnapshot {
  return {
    sourceOpens: {},
    rowLoadPasses: {},
    rowsBound: {},
    rowsRead: {},
    derivedComputes: {},
    widgetStarts: [],
    widgetFirstData: {},
    widgetComplete: {},
    emptyStateSamples: {},
    sourceLoads: [],
    maxConcurrentSourceLoads: 0,
    sourcesReleased: [],
  };
}

let stats = emptyStats();

/** The predicate `DatabaseContext.tsx` uses for its test globals. */
function isRecording() {
  return (
    // Many Jest suites replace `runtime-config` with a partial mock that has no
    // such predicate; this module is imported by the row pipeline they load.
    (typeof isDevelopmentOrTestEnvironment === 'function' && isDevelopmentOrTestEnvironment()) ||
    (typeof window !== 'undefined' && 'Cypress' in window)
  );
}

function snapshot(): DashboardLoadStatsSnapshot {
  return {
    sourceOpens: { ...stats.sourceOpens },
    rowLoadPasses: { ...stats.rowLoadPasses },
    rowsBound: { ...stats.rowsBound },
    rowsRead: { ...stats.rowsRead },
    derivedComputes: { ...stats.derivedComputes },
    widgetStarts: stats.widgetStarts.map((entry) => ({ ...entry })),
    widgetFirstData: { ...stats.widgetFirstData },
    widgetComplete: { ...stats.widgetComplete },
    emptyStateSamples: { ...stats.emptyStateSamples },
    sourceLoads: stats.sourceLoads.map((entry) => ({ ...entry })),
    maxConcurrentSourceLoads: stats.maxConcurrentSourceLoads,
    sourcesReleased: stats.sourcesReleased.map((entry) => ({ ...entry })),
  };
}

function reset() {
  stats = emptyStats();
}

const bridge: DashboardLoadStatsBridge = { snapshot, reset };

/** Whether to record; exposes the bridge on the way, so it also appears when the test flag is set late. */
function recording() {
  if (!isRecording()) return false;
  if (typeof window !== 'undefined') {
    const target = window as DashboardLoadStatsWindow;

    if (target.__DASHBOARD_LOAD_STATS__ !== bridge) target.__DASHBOARD_LOAD_STATS__ = bridge;
  }

  return true;
}

function count(counter: Record<string, number>, key: string, amount = 1) {
  counter[key] = (counter[key] ?? 0) + amount;
}

/**
 * Whether the counters record (development and test builds). A recorder that
 * costs more than a counter update, such as a DOM sampler, checks it first.
 */
export function isDashboardLoadStatsRecording() {
  return recording();
}

function openSourceLoads() {
  return stats.sourceLoads.filter((entry) => entry.end === null);
}

export const dashboardLoadStats = {
  /** The database document was opened. */
  recordSourceOpen(databaseId: string) {
    if (recording()) count(stats.sourceOpens, databaseId);
  },

  /** A full pass over the rows of the database started. */
  recordRowLoadPass(databaseId: string) {
    if (recording()) count(stats.rowLoadPasses, databaseId);
  },

  /** `rows` rows of the database got a realtime binding. */
  recordRowsBound(databaseId: string, rows = 1) {
    if (recording()) count(stats.rowsBound, databaseId, rows);
  },

  /** `rows` rows of the database were read from the server or from IndexedDB (see `rowsRead`). */
  recordRowsRead(databaseId: string, rows: number) {
    if (rows > 0 && recording()) count(stats.rowsRead, databaseId, rows);
  },

  /** A derived result (filter, sort, group, calculation, chart) was computed in full. */
  recordDerivedCompute(key: string) {
    if (recording()) count(stats.derivedComputes, key);
  },

  /** The scheduler started a widget. A resumed widget is recorded again. */
  recordWidgetStart(start: Omit<DashboardWidgetStart, 'at'> & { at?: number }) {
    if (!recording()) return;
    stats.widgetStarts.push({
      widgetId: start.widgetId,
      sourceId: start.sourceId,
      visibleAtStart: start.visibleAtStart,
      at: start.at ?? Date.now(),
    });
  },

  /** A widget showed something real. Only the first time counts. */
  recordWidgetFirstData(widgetId: string, at = Date.now()) {
    if (recording() && stats.widgetFirstData[widgetId] === undefined) stats.widgetFirstData[widgetId] = at;
  },

  /** A widget's rows and derived result are complete. Only the first time counts. */
  recordWidgetComplete(widgetId: string, at = Date.now()) {
    if (recording() && stats.widgetComplete[widgetId] === undefined) stats.widgetComplete[widgetId] = at;
  },

  /** A widget showed an empty state. Counted only before the widget completed: afterwards it is a true result. */
  recordEmptyStateSample(widgetId: string) {
    if (recording() && stats.widgetComplete[widgetId] === undefined) count(stats.emptyStateSamples, widgetId);
  },

  /** A source took a load slot. A source that already holds one is not counted twice. */
  recordSourceLoadStart(sourceId: string, at = Date.now()) {
    if (!recording()) return;
    const open = openSourceLoads();

    if (open.some((entry) => entry.sourceId === sourceId)) return;
    stats.sourceLoads.push({ sourceId, start: at, end: null });
    stats.maxConcurrentSourceLoads = Math.max(stats.maxConcurrentSourceLoads, open.length + 1);
  },

  /** A source gave its slot back (finished, failed, cancelled or suspended). */
  recordSourceLoadEnd(sourceId: string, at = Date.now()) {
    if (!recording()) return;
    const open = openSourceLoads().find((entry) => entry.sourceId === sourceId);

    if (open) open.end = at;
  },

  /** A source's rows and derived results were dropped. */
  recordSourceReleased(sourceId: string, reason: string) {
    if (recording()) stats.sourcesReleased.push({ sourceId, reason });
  },

  snapshot,
  reset,
};

// Expose the bridge as soon as the module loads, so a BDD step can reset the counters before anything is recorded.
recording();
