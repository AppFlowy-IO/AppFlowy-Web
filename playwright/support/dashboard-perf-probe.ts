/* eslint-disable @typescript-eslint/no-explicit-any -- CDP payloads and the probe's page state are untyped. */
/**
 * Performance probe for dashboard specs (PERFORMANCE-REPORT 4.3, 4.4). Shared
 * by the performance lanes: the web-css lane owns this file; other specs
 * import it and rely on the API below staying stable.
 *
 * - Counts (elements restyled, layers, long tasks, content changes) do not
 *   depend on machine speed: specs assert them in every run.
 * - Times (paint latency, style milliseconds, fps) do: specs assert them only
 *   when `isDashboardPerfMode()` (DASHBOARD_PERF=1, a production build, one
 *   worker, a quiet machine).
 *
 * Every function takes the page it measures; the CDP based ones open their
 * own session and detach it afterwards. Chromium only.
 */
import type { CDPSession, Page } from '@playwright/test';

/** One display frame at 60 Hz. */
export const FRAME_MS = 1000 / 60;
/** An interval longer than this between two animation frames counts as a dropped frame. */
export const DROPPED_FRAME_MS = 1.5 * FRAME_MS;

const LONG_TASKS_KEY = '__DASHBOARD_PERF_LONG_TASKS__';
const FRAMES_KEY = '__DASHBOARD_PERF_FRAMES__';
const WIDGET_CONTENT_KEY = '__DASHBOARD_PERF_WIDGET_CONTENT__';

/** `DASHBOARD_PERF=1`: time budgets are asserted (production build, quiet machine). */
export function isDashboardPerfMode(): boolean {
  return process.env.DASHBOARD_PERF === '1';
}

async function withCdp<T>(page: Page, use: (cdp: CDPSession) => Promise<T>): Promise<T> {
  const cdp = await page.context().newCDPSession(page);

  try {
    return await use(cdp);
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** Resolves after the page has produced `count` more animation frames. */
export async function nextFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let left = frames;
        const tick = () => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      }),
    count
  );
}

// ---------------------------------------------------------------------------
// Long tasks
// ---------------------------------------------------------------------------

export interface LongTaskSummary {
  count: number;
  totalMs: number;
  maxMs: number;
}

/** Starts recording long tasks (main-thread tasks over 50 ms) from now; a second call starts over. */
export async function startLongTasks(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const win = window as any;

    win[key]?.observer?.disconnect();
    const state = { entries: [] as { start: number; duration: number }[], observer: null as PerformanceObserver | null };

    if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      throw new Error('Long Tasks API unavailable: this performance budget cannot be measured');
    }

    state.observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => state.entries.push({ start: entry.startTime, duration: entry.duration }));
    });
    state.observer.observe({ type: 'longtask', buffered: false });

    win[key] = state;
  }, LONG_TASKS_KEY);
}

/** The long tasks recorded since `startLongTasks`, including any not yet delivered to the observer. */
export async function readLongTasks(page: Page): Promise<LongTaskSummary> {
  return page.evaluate((key) => {
    const state = (window as any)[key];

    if (!state) throw new Error('startLongTasks(page) was not called on this document');
    state.observer?.takeRecords().forEach((entry: PerformanceEntry) => {
      state.entries.push({ start: entry.startTime, duration: entry.duration });
    });
    const durations: number[] = state.entries.map((entry: { duration: number }) => entry.duration);
    const round = (value: number) => Math.round(value * 10) / 10;

    return {
      count: durations.length,
      totalMs: round(durations.reduce((sum, value) => sum + value, 0)),
      maxMs: round(Math.max(0, ...durations)),
    };
  }, LONG_TASKS_KEY);
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export interface FrameSummary {
  /** Animation frames seen while the action ran. */
  frames: number;
  /** Frame intervals longer than 1.5 frames (`DROPPED_FRAME_MS`). */
  droppedFrames: number;
  /** `droppedFrames` per frame interval, in percent. */
  droppedPct: number;
  fps: number;
  durationMs: number;
  maxIntervalMs: number;
}

/** Summary of animation-frame timestamps (ms). */
export function summarizeFrames(timestamps: number[]): FrameSummary {
  const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index]);
  const durationMs = timestamps.length > 1 ? timestamps[timestamps.length - 1] - timestamps[0] : 0;
  const droppedFrames = intervals.filter((interval) => interval > DROPPED_FRAME_MS).length;
  const round = (value: number) => Math.round(value * 10) / 10;

  return {
    frames: timestamps.length,
    droppedFrames,
    droppedPct: intervals.length ? round((droppedFrames * 100) / intervals.length) : 0,
    fps: durationMs > 0 ? round((intervals.length * 1000) / durationMs) : 0,
    durationMs: round(durationMs),
    maxIntervalMs: round(Math.max(0, ...intervals)),
  };
}

/**
 * Runs `action` while sampling every animation frame of the page
 * (requestAnimationFrame), and summarizes the frame intervals.
 */
export async function measureFrames(page: Page, action: () => Promise<unknown>): Promise<FrameSummary> {
  await page.evaluate((key) => {
    const win = window as any;
    const state = { recording: true, timestamps: [] as number[] };
    const tick = (now: number) => {
      if (!state.recording) return;
      state.timestamps.push(now);
      requestAnimationFrame(tick);
    };

    win[key] = state;
    requestAnimationFrame(tick);
  }, FRAMES_KEY);
  await nextFrames(page, 1);
  let timestamps: number[] = [];

  try {
    await action();
  } finally {
    // The loop stops even when the action throws.
    timestamps = await page
      .evaluate((key) => {
        const state = (window as any)[key];

        state.recording = false;
        return state.timestamps as number[];
      }, FRAMES_KEY)
      .catch(() => []);
  }

  return summarizeFrames(timestamps);
}

// ---------------------------------------------------------------------------
// Paint latency
// ---------------------------------------------------------------------------

export interface PaintLatency {
  /** From the input event to the first DOM state where the condition holds. */
  toMatchMs: number;
  /** From the input event to the frame that shows it. */
  toPaintMs: number;
}

/** What `paintLatency` waits for: an element matching the selector appears, or the last one disappears. */
export type PaintCondition = { appears: string } | { disappears: string };

/**
 * Runs `trigger` (a pointer or key input) and measures how long after the
 * input event the page shows `condition`: the condition is checked on every
 * DOM mutation and frame, and the paint is taken as the end of the frame in
 * which it first held.
 */
export async function paintLatency(
  page: Page,
  trigger: () => Promise<unknown>,
  condition: PaintCondition,
  timeoutMs = 10_000
): Promise<PaintLatency> {
  await page.evaluate(() => {
    const win = window as any;
    const state = { inputAt: null as number | null };
    const record = (event: Event) => {
      if (event.isTrusted && state.inputAt === null) state.inputAt = event.timeStamp;
    };

    ['pointerdown', 'mousedown', 'keydown'].forEach((type) =>
      window.addEventListener(type, record, { capture: true, passive: true, once: true })
    );
    win.__DASHBOARD_PERF_PAINT__ = state;
  });
  const waiter = page.evaluate(
    ({ condition, timeoutMs }) =>
      new Promise<{ matchedAt: number; paintedAt: number } | null>((resolve) => {
        const holds = () =>
          'appears' in condition
            ? document.querySelector(condition.appears) !== null
            : document.querySelector(condition.disappears) === null;
        let done = false;
        const observer = new MutationObserver(() => check());
        const timer = window.setTimeout(() => finish(null), timeoutMs);
        const finish = (result: { matchedAt: number; paintedAt: number } | null) => {
          done = true;
          observer.disconnect();
          window.clearTimeout(timer);
          resolve(result);
        };

        function check() {
          if (done || !holds()) return;
          const matchedAt = performance.now();

          done = true;
          observer.disconnect();
          requestAnimationFrame(() => {
            // A task queued from the frame's rAF runs after that frame is painted.
            const channel = new MessageChannel();

            channel.port1.onmessage = () => {
              window.clearTimeout(timer);
              resolve({ matchedAt, paintedAt: performance.now() });
            };

            channel.port2.postMessage(0);
          });
        }

        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
        const poll = () => {
          check();
          if (!done) requestAnimationFrame(poll);
        };

        poll();
      }),
    { condition, timeoutMs }
  );

  await trigger();
  const result = await waiter;
  const inputAt = await page.evaluate(() => (window as any).__DASHBOARD_PERF_PAINT__?.inputAt as number | null);

  if (!result) throw new Error(`The page did not show ${JSON.stringify(condition)} within ${timeoutMs} ms`);
  if (inputAt === null) throw new Error('The trigger sent no pointer or key input');
  const round = (value: number) => Math.round(value * 10) / 10;

  return { toMatchMs: round(result.matchedAt - inputAt), toPaintMs: round(result.paintedAt - inputAt) };
}

// ---------------------------------------------------------------------------
// Style recalculation (CDP tracing)
// ---------------------------------------------------------------------------

export interface StyleRecalcSummary {
  /** Time spent in style recalculation (UpdateLayoutTree) while the action ran. */
  totalMs: number;
  /** Elements restyled by the largest single recalculation. */
  maxElements: number;
  /** Elements restyled, summed over every recalculation. */
  totalElements: number;
  /** Style recalculations. */
  events: number;
}

const STYLE_EVENTS = new Set(['UpdateLayoutTree', 'RecalculateStyles']);

/** Style recalculations recorded by a devtools.timeline trace around `action`. */
export async function traceStyleRecalc(page: Page, action: () => Promise<unknown>): Promise<StyleRecalcSummary> {
  return withCdp(page, async (cdp) => {
    const events: any[] = [];
    const collect = (payload: { value: any[] }) => events.push(...payload.value);

    cdp.on('Tracing.dataCollected', collect);
    await cdp.send('Tracing.start', {
      traceConfig: {
        recordMode: 'recordContinuously',
        includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'],
      },
    } as any);

    try {
      await action();
      // The last frame of the action is painted, and its trace events written.
      await nextFrames(page, 2);
    } finally {
      const complete = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));

      await cdp.send('Tracing.end');
      await complete;
      cdp.off('Tracing.dataCollected', collect);
    }

    let totalUs = 0;
    let maxElements = 0;
    let totalElements = 0;
    let count = 0;

    events.forEach((event) => {
      if (!STYLE_EVENTS.has(event.name)) return;
      const elements = event.args?.elementCount ?? event.args?.endData?.elementCount;

      if (event.ph === 'X') {
        count += 1;
        totalUs += event.dur ?? 0;
      }

      if (typeof elements === 'number') {
        totalElements += elements;
        maxElements = Math.max(maxElements, elements);
      }
    });
    return { totalMs: Math.round(totalUs / 100) / 10, maxElements, totalElements, events: count };
  });
}

// ---------------------------------------------------------------------------
// Compositor layers, heap, DOM
// ---------------------------------------------------------------------------

/** Compositor layers of the page now (CDP LayerTree). */
export async function layerCount(page: Page): Promise<number> {
  return withCdp(page, async (cdp) => {
    const tree: { layers: unknown[] | null } = { layers: null };
    const reported = new Promise<void>((resolve) => {
      cdp.on('LayerTree.layerTreeDidChange', (event: { layers?: unknown[] }) => {
        if (!event.layers) return;
        tree.layers = event.layers;
        resolve();
      });
    });

    await cdp.send('LayerTree.enable');
    // The tree is reported with the next committed frame; the timeout covers a page that commits none.
    await Promise.race([reported, nextFrames(page, 3).then(() => page.waitForTimeout(1000))]);
    await cdp.send('LayerTree.disable').catch(() => undefined);
    if (!tree.layers) throw new Error('LayerTree reported no layers');
    return tree.layers.length;
  });
}

/** JS heap in use after a full garbage collection, in MB. */
export async function heapAfterGc(page: Page): Promise<number> {
  return withCdp(page, async (cdp) => {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');

    await cdp.send('HeapProfiler.disable').catch(() => undefined);
    return Math.round((usedSize / (1024 * 1024)) * 10) / 10;
  });
}

export interface DomCounts {
  elements: number;
  /** Event listeners on window, document and every node, or null where CDP cannot list them. */
  listeners: number | null;
}

export async function domCounts(page: Page): Promise<DomCounts> {
  const elements = await page.evaluate(() => document.getElementsByTagName('*').length);
  const listeners = await withCdp(page, async (cdp) => {
    let total = 0;

    for (const [expression, depth] of [
      ['window', 0],
      ['document', -1],
    ] as const) {
      const { result } = await cdp.send('Runtime.evaluate', { expression });

      if (!result.objectId) return null;
      const { listeners: found } = await cdp.send('DOMDebugger.getEventListeners', {
        objectId: result.objectId,
        depth,
        pierce: true,
      });

      total += found.length;
      await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => undefined);
    }

    return total;
  }).catch(() => null);

  return { elements, listeners };
}

// ---------------------------------------------------------------------------
// Widget content changes
// ---------------------------------------------------------------------------

/**
 * Starts counting content changes of every dashboard widget on the page
 * (`[data-widget-id]`): a MutationObserver per widget hashes the text of its
 * body after each batch of mutations and counts the hash changes. While a
 * widget shows a loading placeholder its text is not recorded, so a reload
 * that ends with the same content counts 0 changes. Widgets mounted after the
 * call are not watched. A second call starts over.
 */
export async function watchWidgetContent(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const win = window as any;

    win[key]?.watchers?.forEach(({ observer }: { observer: MutationObserver }) => observer.disconnect());
    const LOADING =
      '[data-testid="dashboard-widget-placeholder"][data-reason="loading"], [data-testid="chart-loading"], [data-testid="grid-loading-indicator"]';
    const hash = (text: string) => {
      // FNV-1a, 32 bit.
      let value = 0x811c9dc5;

      for (let index = 0; index < text.length; index += 1) {
        value ^= text.charCodeAt(index);
        value = Math.imul(value, 0x01000193);
      }

      return value >>> 0;
    };

    const state = {
      watchers: [] as { observer: MutationObserver; check: () => void }[],
      changes: {} as Record<string, number>,
    };

    document.querySelectorAll<HTMLElement>('[data-widget-id]').forEach((widget) => {
      const id = widget.getAttribute('data-widget-id') ?? '';
      const body = () => (widget.firstElementChild as HTMLElement | null) ?? widget;
      const read = () => (body().querySelector(LOADING) ? null : hash(body().textContent ?? ''));
      let last = read();
      const check = () => {
        const current = read();

        if (current === null || current === last) return;
        state.changes[id] += 1;
        last = current;
      };

      const observer = new MutationObserver(check);

      state.changes[id] = 0;
      observer.observe(widget, { childList: true, subtree: true, characterData: true });
      state.watchers.push({ observer, check });
    });
    win[key] = state;
  }, WIDGET_CONTENT_KEY);
}

/** Content changes per widget id since `watchWidgetContent`. */
export async function readWidgetContentChanges(page: Page): Promise<Record<string, number>> {
  return page.evaluate((key) => {
    const state = (window as any)[key];

    if (!state) throw new Error('watchWidgetContent(page) was not called on this document');
    // Mutations not delivered to an observer yet.
    state.watchers.forEach(({ observer, check }: { observer: MutationObserver; check: () => void }) => {
      if (observer.takeRecords().length > 0) check();
    });
    return { ...state.changes };
  }, WIDGET_CONTENT_KEY);
}
