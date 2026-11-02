/**
 * Budget of a chart whose widget box resizes (W21): while the dashboard row is
 * resized (or the box eases to a new width) a frame size change lays the
 * marks out once, without animation, so no frame after it mounts new bar
 * elements; the chart does not replay the resize when the resize ends; new
 * data still animates. The control case shows the same resize animating (and
 * re-creating the bars on every frame) without the flag.
 */
import { act, render } from '@testing-library/react';
import { ReactElement } from 'react';
import { Bar, Line, Pie } from 'recharts';

import { ChartDataItem } from '@/application/database-yjs/chart.type';

import BarChartWidget from '../BarChart';
import DonutChartWidget from '../DonutChart';
import LineChartWidget from '../LineChart';
import { ChartResizingContext } from '../useReducedMotion';

import { chartContextStub, ChartStubProvider, seriesDataOf } from './chartTestUtils';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

/** A ResizeObserver whose reports the test sends: `report` resizes every observed frame. */
const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>();

function report(width: number, height: number) {
  act(() => {
    observers.forEach(({ callback, targets }) => {
      const entries = Array.from(targets, (target) => ({
        borderBoxSize: [],
        contentBoxSize: [],
        contentRect: { bottom: height, height, left: 0, right: width, top: 0, width, x: 0, y: 0, toJSON: () => ({}) },
        devicePixelContentBoxSize: [],
        target,
      }));

      callback(entries, {} as ResizeObserver);
    });
  });
}

class ResizeObserverMock {
  private readonly entry: { callback: ResizeObserverCallback; targets: Set<Element> };

  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: new Set() };
    observers.add(this.entry);
  }

  observe(target: Element) {
    this.entry.targets.add(target);
  }

  unobserve(target: Element) {
    this.entry.targets.delete(target);
  }

  disconnect() {
    observers.delete(this.entry);
  }
}

const DEPARTMENTS: ChartDataItem[] = ['Eng', 'Mktg', 'Prod', 'Dsgn', 'Sale', 'Supp', 'HR', 'Fin'].map(
  (label, index) => ({ key: label, label, value: (index + 1) * 10, rowIds: [`r${index}`], color: '#4FB9C9' })
);
const DATA = seriesDataOf(DEPARTMENTS);
const NEW_DATA = seriesDataOf(DEPARTMENTS.map((item) => ({ ...item, value: item.value * 2 })));

/** Long enough for any chart animation to end (400ms entry, 1.5s Recharts default). */
const ANIMATION_WINDOW_MS = 2000;

// One value for every render, as `ChartProvider` keeps it: a new one would hand the charts new data.
const CONTEXT = chartContextStub();

function chart(element: ReactElement, resizing: boolean) {
  return (
    <ChartStubProvider value={CONTEXT}>
      <ChartResizingContext.Provider value={resizing}>{element}</ChartResizingContext.Provider>
    </ChartStubProvider>
  );
}

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

/** The bar elements mounted since the last `markBars`. */
const seenBars = new WeakSet<Element>();
const bars = (container: HTMLElement) => Array.from(container.querySelectorAll('.recharts-bar-rectangle'));
const markBars = (container: HTMLElement) => bars(container).forEach((bar) => seenBars.add(bar));
const newBars = (container: HTMLElement) => bars(container).filter((bar) => !seenBars.has(bar)).length;

const originalResizeObserver = globalThis.ResizeObserver;
const originalMatchMedia = window.matchMedia;

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  // No reduced motion: the charts animate.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  window.matchMedia = originalMatchMedia;
});

beforeEach(() => {
  jest.useFakeTimers();
  observers.clear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Renders `element` at 800 × 400 and lets its entry animation end. */
function renderSettled(element: (resizing: boolean) => ReactElement) {
  const result = render(element(false));

  report(800, 400);
  advance(ANIMATION_WINDOW_MS);
  return result;
}

describe('a bar chart in a resizing widget box', () => {
  it('lays the bars out once without animation, and no frame after that mounts a bar', () => {
    const animated = jest.spyOn(Bar.prototype as never, 'renderRectanglesWithAnimation');
    const element = (resizing: boolean) => chart(<BarChartWidget data={DATA} fill />, resizing);
    const { container, rerender } = renderSettled(element);

    // The entry animation ran: animation is on in this environment.
    expect(animated).toHaveBeenCalled();
    expect(bars(container)).toHaveLength(DEPARTMENTS.length);

    rerender(element(true));
    animated.mockClear();
    report(600, 400);
    advance(20);
    // One layout at the new size, drawn statically.
    expect(bars(container)).toHaveLength(DEPARTMENTS.length);
    expect(animated).not.toHaveBeenCalled();

    markBars(container);
    advance(ANIMATION_WINDOW_MS);
    expect(newBars(container)).toBe(0);
    expect(animated).not.toHaveBeenCalled();

    // The resize ends: nothing replays it.
    rerender(element(false));
    advance(ANIMATION_WINDOW_MS);
    expect(newBars(container)).toBe(0);
    expect(animated).not.toHaveBeenCalled();
  });

  it('draws a size change that follows the flag without animation (a height commit: the content was held)', () => {
    const animated = jest.spyOn(Bar.prototype as never, 'renderRectanglesWithAnimation');
    const element = (resizing: boolean) => chart(<BarChartWidget data={DATA} fill />, resizing);
    const { container, rerender } = renderSettled(element);

    // A held height drag: the flag goes up and down while the chart keeps its size.
    rerender(element(true));
    advance(20);
    rerender(element(false));
    animated.mockClear();

    // The released content then reaches the chart at its new height.
    report(800, 520);
    advance(20);
    expect(bars(container)).toHaveLength(DEPARTMENTS.length);
    expect(animated).not.toHaveBeenCalled();
    markBars(container);
    advance(ANIMATION_WINDOW_MS);
    expect(newBars(container)).toBe(0);
    expect(animated).not.toHaveBeenCalled();
  });

  it('still animates new data after a resize', () => {
    const animated = jest.spyOn(Bar.prototype as never, 'renderRectanglesWithAnimation');
    const element = (data: typeof DATA, resizing: boolean) => chart(<BarChartWidget data={data} fill />, resizing);
    const { rerender } = renderSettled((resizing) => element(DATA, resizing));

    rerender(element(DATA, true));
    report(600, 400);
    advance(20);
    rerender(element(DATA, false));
    animated.mockClear();

    rerender(element(NEW_DATA, false));
    expect(animated).toHaveBeenCalled();
  });

  it('animates the same resize, and re-creates the bars on its frames, without the flag (control)', () => {
    const animated = jest.spyOn(Bar.prototype as never, 'renderRectanglesWithAnimation');
    const { container } = renderSettled((resizing) => chart(<BarChartWidget data={DATA} fill />, resizing));

    animated.mockClear();
    report(600, 400);
    advance(20);
    expect(animated).toHaveBeenCalled();

    markBars(container);
    advance(100);
    expect(newBars(container)).toBeGreaterThan(0);
  });
});

describe('line and donut charts in a resizing widget box', () => {
  it('draw a resize of the line chart without animation', () => {
    const animated = jest.spyOn(Line.prototype as never, 'renderCurveWithAnimation');
    const element = (resizing: boolean) => chart(<LineChartWidget data={DATA} fill />, resizing);
    const { rerender } = renderSettled(element);

    rerender(element(true));
    animated.mockClear();
    report(600, 300);
    advance(ANIMATION_WINDOW_MS);
    rerender(element(false));
    advance(ANIMATION_WINDOW_MS);
    expect(animated).not.toHaveBeenCalled();
  });

  it('draw a resize of the donut chart without animation, and animate its next data', () => {
    const animated = jest.spyOn(Pie.prototype as never, 'renderSectorsWithAnimation');
    const element = (data: typeof DATA, resizing: boolean) => chart(<DonutChartWidget data={data} fill />, resizing);
    const { rerender } = renderSettled((resizing) => element(DATA, resizing));

    expect(animated).toHaveBeenCalled();
    rerender(element(DATA, true));
    animated.mockClear();
    report(600, 300);
    advance(ANIMATION_WINDOW_MS);
    rerender(element(DATA, false));
    advance(ANIMATION_WINDOW_MS);
    expect(animated).not.toHaveBeenCalled();

    rerender(element(NEW_DATA, false));
    expect(animated).toHaveBeenCalled();
  });
});
