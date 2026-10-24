/* eslint-disable @typescript-eslint/no-explicit-any -- Browser performance records are test-only. */
import { expect, Page } from '@playwright/test';

import { loadingWidgets } from './dashboard-loading-helpers';
import { LongTaskSummary, readLongTasks, startLongTasks } from './dashboard-perf-probe';

/** Count settled results, excluding staged rendering of the same result. */
const QUIET_MS = 1_500;
const SETTLE_TIMEOUT_MS = 30_000;

const TIMELINE_KEY = '__DASHBOARD_PERF_CONDITIONS__';

export interface WidgetTrack {
  /** The content hash when the timeline started; `null` while the widget showed a loading state. */
  initial: number | null;
  current: number | null;
  loading: boolean;
  loadingChangedAt: number;
  /** `performance.now()` of each content change (a loading state in between is not one). */
  changes: number[];
  /** PERF_CONDITIONS_DEBUG only: the start of the text of the initial content and of each change. */
  seen?: string[];
}

export interface Timeline {
  now: number;
  /** When the timeline started. */
  startedAt: number;
  /** Trusted pointer and key inputs since the start: `event.timeStamp` (same clock as `performance.now()`). */
  inputs: { type: string; key?: string; t: number }[];
  /** Event Timing entries of those inputs: from the input until the next paint after its handlers. */
  events: { name: string; startTime: number; duration: number }[];
  eventsSupported: boolean;
  widgets: Record<string, WidgetTrack>;
}

/**
 * Starts recording, from now on: each widget's content changes (the result
 * it shows, read after every batch of mutations as `watchWidgetContent` of
 * the probe reads its text, and hashed), the trusted inputs, and their Event
 * Timing entries.
 */
export async function startTimeline(page: Page, editedCell?: { rowId: string; fieldId: string }) {
  await page.evaluate(
    ({ key, debug, editedCell }) => {
      const win = window as unknown as Record<string, any>;

      win[key]?.stop?.();
      const LOADING =
        '[data-testid="dashboard-widget-placeholder"][data-reason="loading"], [data-testid="chart-loading"], [data-testid="grid-loading-indicator"]';
      const hash = (text: string) => {
        let value = 0x811c9dc5;

        for (let index = 0; index < text.length; index += 1) {
          value ^= text.charCodeAt(index);
          value = Math.imul(value, 0x01000193);
        }

        return value >>> 0;
      };

      const state = {
        inputs: [] as { type: string; key?: string; t: number }[],
        events: [] as { name: string; startTime: number; duration: number }[],
        widgets: {} as Record<
          string,
          { initial: number | null; current: number | null; loading: boolean; loadingChangedAt: number; changes: number[]; seen?: string[] }
        >,
        eventsSupported: false,
        startedAt: performance.now(),
        stop: () => undefined as void,
      };
      const observers: MutationObserver[] = [];

      document.querySelectorAll<HTMLElement>('[data-widget-id]').forEach((widget) => {
        const id = widget.getAttribute('data-widget-id') ?? '';
        const body = () => (widget.firstElementChild as HTMLElement | null) ?? widget;
        // What the widget shows as its result: a grid's row count and first rows,
        // a board's columns with their counts, a chart's values, a Number
        // chart's value. Rendering stages of one result (cards mounting in
        // their columns, a chart's labels drawn after its entry animation) do
        // not change it; an intermediate result (a partial or empty one) does.
        const signature = () => {
          const scope = body();

          if (scope.querySelector(LOADING)) return null;
          const grid = scope.querySelector('[data-testid="database-grid"]');

          if (grid) {
            const count = grid.getAttribute('data-row-count') ?? `partial ${grid.getAttribute('data-loaded-row-count')}`;
            const first = Array.from(
              scope.querySelectorAll('[data-testid^="grid-row-"]:not([data-testid="grid-row-undefined"])'),
              (row) => row.getAttribute('data-testid')
            ).slice(0, 5);

            const edited = editedCell
              ? scope.querySelector(`[data-testid="grid-cell-${editedCell.rowId}-${editedCell.fieldId}"]`)?.textContent ?? 'absent'
              : '';

            return `grid ${count} ${first.join(',')} ${edited}`;
          }

          if (scope.querySelector('.database-board')) {
            const columns = Array.from(scope.querySelectorAll('[data-testid="board-column"]'), (column) => {
              const count = column.querySelector('[data-testid="board-column-name"]')?.nextElementSibling?.textContent;

              return `${column.getAttribute('data-column-id')}=${(count ?? '').trim()}`;
            });

            return `board ${columns.join(' ')}`;
          }

          const number = scope.querySelector('[data-testid="number-chart"]');

          if (number) {
            const value = scope.querySelector('[data-testid="number-chart-value"]')?.textContent ?? '';

            return `number ${number.getAttribute('data-empty')} ${value.trim()}`;
          }

          const table = scope.querySelector('[data-testid="chart-data-table"]');

          if (table) {
            const values = Array.from(
              table.querySelectorAll('tr[data-key]'),
              (row) => `${row.getAttribute('data-key')}=${row.getAttribute('data-value')}`
            );

            return `chart ${values.join(' ')}`;
          }

          return `text ${scope.textContent ?? ''}`;
        };

        const read = () => {
          const shown = signature();

          return shown === null ? null : hash(shown);
        };

        const track = {
          initial: read(),
          current: null as number | null,
          loading: false,
          loadingChangedAt: state.startedAt,
          changes: [] as number[],
          // PERF_CONDITIONS_DEBUG: what each change showed (the start of the widget's text).
          seen: debug ? [(signature() ?? 'loading').slice(0, 240)] : undefined,
        };

        track.current = track.initial;
        track.loading = track.initial === null;
        const observer = new MutationObserver(() => {
          const next = read();

          if (track.loading !== (next === null)) track.loadingChangedAt = performance.now();
          track.loading = next === null;
          if (next === null || next === track.current) return;
          track.current = next;
          track.changes.push(performance.now());
          track.seen?.push(`${Math.round(performance.now() - state.startedAt)}ms ${(signature() ?? '').slice(0, 240)}`);
        });

        observer.observe(widget, {
          childList: true, subtree: true, characterData: true, attributes: true,
          attributeFilter: ['data-row-count', 'data-loaded-row-count', 'data-value', 'data-key', 'data-empty', 'data-reason'],
        });
        observers.push(observer);
        state.widgets[id] = track;
      });

      const recordInput = (event: Event) => {
        if (!event.isTrusted) return;
        state.inputs.push({ type: event.type, key: (event as KeyboardEvent).key, t: event.timeStamp });
      };

      const inputTypes = ['pointerdown', 'keydown'];

      inputTypes.forEach((type) => window.addEventListener(type, recordInput, { capture: true, passive: true }));
      let eventObserver: PerformanceObserver | null = null;

      try {
        eventObserver = new PerformanceObserver((list) => {
          list
            .getEntries()
            .forEach((entry) =>
              state.events.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration })
            );
        });
        if (!PerformanceObserver.supportedEntryTypes.includes('event')) throw new Error('Event Timing unavailable');
        eventObserver.observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
        state.eventsSupported = true;
      } catch {
        // No Event Timing API: the key event is not measured.
      }

      state.stop = () => {
        observers.forEach((observer) => observer.disconnect());
        inputTypes.forEach((type) => window.removeEventListener(type, recordInput, { capture: true }));
        eventObserver?.disconnect();
      };

      win[key] = state;
    },
    { key: TIMELINE_KEY, debug: Boolean(process.env.PERF_CONDITIONS_DEBUG), editedCell }
  );
}

export async function readTimeline(page: Page): Promise<Timeline> {
  return page.evaluate((key) => {
    const state = (window as unknown as Record<string, any>)[key];

    if (!state) throw new Error('startTimeline(page) was not called on this document');
    return {
      now: performance.now(),
      startedAt: state.startedAt,
      inputs: [...state.inputs],
      events: [...state.events],
      eventsSupported: state.eventsSupported,
      widgets: JSON.parse(JSON.stringify(state.widgets)),
    };
  }, TIMELINE_KEY);
}

/**
 * Waits until no widget is loading and none changed for `QUIET_MS` (counted
 * from the start when none changed yet: a debounced input changes nothing at
 * first); returns the timeline then.
 */
export async function settledTimeline(page: Page): Promise<Timeline> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;

  for (;;) {
    await page.waitForTimeout(250);
    const timeline = await readTimeline(page);
    const tracks = Object.values(timeline.widgets);
    const lastChange = Math.max(timeline.startedAt, ...tracks.flatMap((track) => [...track.changes, track.loadingChangedAt]));
    const loading = tracks.some((track) => track.loading || track.current === null);

    if (!loading && timeline.now - lastChange >= QUIET_MS) return timeline;
    if (Date.now() > deadline) throw new Error(`The widgets did not settle in ${SETTLE_TIMEOUT_MS} ms`);
  }
}

export interface ChangeMeasure {
  /** Content changes per widget label. */
  changes: Record<string, number>;
  /** Widgets whose content after the change differs from before it. */
  changed: string[];
  /** ms from the input to the last content change of any widget. */
  everyWidgetMs: number;
  longTasks: LongTaskSummary;
  /** The longest Event Timing entry of the input (key or pointer), in ms. */
  inputEventMs: number | null;
}

/** Runs `action` (one input) and measures the widget changes it causes, once every widget settled again. */
export async function measureChange(
  page: Page, inputType: 'pointerdown' | 'keydown', action: () => Promise<unknown>,
  editedCell?: { rowId: string; fieldId: string },
  waitForExpectedResult?: () => Promise<void>
) {
  await startLongTasks(page);
  await startTimeline(page, editedCell);
  const before = await readTimeline(page);

  expect(Object.keys(before.widgets).sort(), 'every widget is mounted before the trigger').toEqual(
    loadingWidgets(page).map((widget) => widget.id).sort()
  );
  expect(Object.values(before.widgets).every((track) => !track.loading && track.initial !== null),
    'widget results are ready before this change').toBe(true);
  await action();
  await waitForExpectedResult?.();
  const timeline = await settledTimeline(page);
  const longTasks = await readLongTasks(page);
  const input = timeline.inputs.find((entry) => entry.type === inputType);

  if (!input) throw new Error(`The action sent no ${inputType}`);
  const labelOf = new Map(loadingWidgets(page).map((widget) => [widget.id, widget.label]));

  expect(Object.keys(timeline.widgets).sort(), 'every expected widget was observed').toEqual(
    loadingWidgets(page).map((widget) => widget.id).sort()
  );
  const changes: Record<string, number> = {};
  const changed: string[] = [];
  let everyWidgetMs = 0;

  Object.entries(timeline.widgets).forEach(([id, track]) => {
    const label = labelOf.get(id) ?? id;

    changes[label] = track.changes.length;
    if (track.current !== track.initial) changed.push(label);
    track.changes.forEach((t) => {
      everyWidgetMs = Math.max(everyWidgetMs, t - input.t);
    });
  });
  expect(changed.length, 'this real filter or cell edit must change a widget result').toBeGreaterThan(0);
  // A supported API with no >=16ms entry means the input was below that threshold.
  // An unsupported API is unmeasured, never a false zero-duration pass.
  const inputEventMs = timeline.eventsSupported ? Math.max(
    0,
    ...timeline.events.filter((entry) => Math.abs(entry.startTime - input.t) < 20).map((entry) => entry.duration)
  ) : null;

  if (process.env.PERF_CONDITIONS_DEBUG) {
    Object.entries(timeline.widgets).forEach(([id, track]) => {
      if (track.changes.length > 1)
        console.log(`[perf-conditions:debug] ${labelOf.get(id)} ${JSON.stringify(track.seen)}`);
    });
  }

  return { changes, changed, everyWidgetMs: Math.round(everyWidgetMs), longTasks, inputEventMs } as ChangeMeasure;
}
