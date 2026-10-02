import { createEvent, fireEvent, render } from '@testing-library/react';
import { ReactElement, ReactNode } from 'react';

import {
  ChartExtendedSettings,
  DEFAULT_CHART_EXTENDED_SETTINGS,
} from '@/application/database-yjs/chart-extended-settings';
import { ChartFormatYField, formatChartValue } from '@/application/database-yjs/chart-format';
import { ChartAggregationType } from '@/application/database-yjs/chart.type';
import { NumberFormat } from '@/application/database-yjs/fields';
import { YDatabaseField } from '@/application/types';
import { ChartContext, ChartContextValue, DEFAULT_CHART_CONTEXT } from '@/components/database/chart/useChartContext';

import { ChartMeasureContext } from '../measureText';

/** The fake measurer of `chart-geometry.json`: 6px per character at 12px, 5px at 10px. */
export const FIXTURE_MEASURE = {
  measure12: (text: string) => Array.from(text).length * 6,
  measure10: (text: string) => Array.from(text).length * 5,
};

let observedSize = { width: 800, height: 400 };

/** Every observed element measures `width × height` (the chart frame's content box). */
export function setObservedSize(width: number, height: number) {
  observedSize = { width, height };
}

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  disconnect() {
    // Nothing to release: the mock measures once.
  }

  observe(target: Element) {
    const { width, height } = observedSize;

    this.callback(
      [
        {
          borderBoxSize: [],
          contentBoxSize: [],
          contentRect: { bottom: height, height, left: 0, right: width, top: 0, width, x: 0, y: 0, toJSON: () => ({}) },
          devicePixelContentBoxSize: [],
          target,
        },
      ],
      this
    );
  }

  unobserve() {
    // The charts only need the first measurement.
  }
}

/** Install the ResizeObserver mock and reduced motion (so labels render without waiting for Recharts' animation). */
export function installChartEnvironment() {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalMatchMedia = window.matchMedia;

  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  });

  beforeEach(() => setObservedSize(800, 400));

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    window.matchMedia = originalMatchMedia;
  });
}

export interface ChartStub {
  aggregation?: ChartAggregationType;
  yField?: ChartFormatYField | null;
  style?: Partial<ChartExtendedSettings>;
  seriesLabel?: string;
  isDark?: boolean;
}

/** A chart context for `aggregation` over `yField` (USD Sum by default). */
export function chartContextStub({
  aggregation = ChartAggregationType.Sum,
  yField = { type: 'number', numberFormat: NumberFormat.USD },
  style,
  seriesLabel = '',
  isDark = false,
}: ChartStub = {}): ChartContextValue {
  return {
    ...DEFAULT_CHART_CONTEXT,
    isLoading: false,
    aggregationType: aggregation,
    // Only its presence matters to the widgets.
    yAxisField: yField ? ({} as YDatabaseField) : null,
    style: { ...DEFAULT_CHART_EXTENDED_SETTINGS, ...style },
    format: (value, mode) => formatChartValue(value, { aggregation, yField, mode, locale: 'en-US' }),
    seriesLabel,
    isDark,
  };
}

export function ChartStubProvider({ value, children }: { value: ChartContextValue; children: ReactNode }) {
  return (
    <ChartMeasureContext.Provider value={FIXTURE_MEASURE}>
      <ChartContext.Provider value={value}>{children}</ChartContext.Provider>
    </ChartMeasureContext.Provider>
  );
}

export function renderChart(element: ReactElement, stub: ChartStub = {}) {
  const value = chartContextStub(stub);
  const result = render(<ChartStubProvider value={value}>{element}</ChartStubProvider>);

  return {
    ...result,
    rerenderChart: (next: ReactElement, nextStub: ChartStub = stub) =>
      result.rerender(<ChartStubProvider value={chartContextStub(nextStub)}>{next}</ChartStubProvider>),
  };
}

/** Text of every element matching `selector`, in document order. */
export function texts(container: ParentNode, selector: string): string[] {
  return Array.from(container.querySelectorAll(selector)).map((element) => element.textContent ?? '');
}

/**
 * A mouse event at viewport `x, y` on `target`. jsdom leaves `pageX` / `pageY`
 * undefined, and Recharts locates the pointer with them.
 */
export function firePointer(target: Element, type: 'mouseMove' | 'click', x: number, y: number) {
  const event = createEvent[type](target, { clientX: x, clientY: y, bubbles: true });

  Object.defineProperty(event, 'pageX', { value: x });
  Object.defineProperty(event, 'pageY', { value: y });
  fireEvent(target, event);
}

/** Point at the middle of category `index` (the anchors give the slots; jsdom places the chart at 0, 0). */
export function hoverCategory(container: HTMLElement, index: number, y = 200) {
  const anchors = container.querySelectorAll('[data-testid="chart-category-anchor"]');
  const anchor = anchors[index] as SVGRectElement;
  const x = Number(anchor.getAttribute('x')) + Number(anchor.getAttribute('width')) / 2;
  const top = Number(anchor.getAttribute('y'));
  const height = Number(anchor.getAttribute('height'));
  const wrapper = container.querySelector('.recharts-wrapper') as HTMLElement;

  firePointer(wrapper, 'mouseMove', x, Math.min(Math.max(y, top + 1), top + height - 1));
}
