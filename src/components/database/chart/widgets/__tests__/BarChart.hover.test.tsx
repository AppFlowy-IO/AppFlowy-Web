import { act, render, screen } from '@testing-library/react';

import { ChartDataItem } from '@/application/database-yjs/chart.type';
import { ChartContext } from '@/components/database/chart/useChartContext';
import BarChartWidget from '@/components/database/chart/widgets/BarChart';

import { ChartMeasureContext } from '../measureText';

import { chartContextStub, firePointer, FIXTURE_MEASURE, installChartEnvironment, seriesDataOf } from './chartTestUtils';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

// Counts the renders of the widget's plot: the wrapper runs only when the plot
// component hands Recharts a new element, not when Recharts updates itself.
const mockPlotRenders = jest.fn();

jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  const { createElement } = jest.requireActual('react');

  return {
    ...actual,
    BarChart: (props: Record<string, unknown>) => {
      mockPlotRenders();
      return createElement(actual.BarChart, props);
    },
  };
});

const OWNERS: ChartDataItem[] = [
  { key: 'alice', label: 'Alice', value: 48500, rowIds: ['r1'], color: '#BF8EDA' },
  { key: 'bob', label: 'Bob', value: 1300000, rowIds: ['r2', 'r3'], color: '#DE9255' },
  { key: 'carol', label: 'Carol', value: 690000, rowIds: ['r4'], color: '#4FB9C9' },
];

/** Recharts throttles its own mouse-move handling to one per frame. */
const nextFrame = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

describe('BarChartWidget hover path', () => {
  installChartEnvironment();

  beforeEach(() => {
    mockPlotRenders.mockClear();
  });

  it('does not render the plot or measure a label again for pointer moves inside one band', async () => {
    const measure12 = jest.fn(FIXTURE_MEASURE.measure12);
    const { container } = render(
      <ChartMeasureContext.Provider value={{ ...FIXTURE_MEASURE, measure12 }}>
        <ChartContext.Provider value={chartContextStub()}>
          <BarChartWidget data={seriesDataOf(OWNERS)} onItemClick={jest.fn()} />
        </ChartContext.Provider>
      </ChartMeasureContext.Provider>
    );
    const wrapper = container.querySelector('.recharts-wrapper') as HTMLElement;
    const anchors = container.querySelectorAll('[data-testid="chart-category-anchor"]');
    const band = (index: number) => {
      const anchor = anchors[index] as SVGRectElement;

      return { x: Number(anchor.getAttribute('x')), width: Number(anchor.getAttribute('width')) };
    };

    const measuredAtMount = measure12.mock.calls.length;
    const bob = band(1);

    expect(measuredAtMount).toBeGreaterThan(0);

    // Entering a band shows the hover band: the one render the plot needs.
    act(() => firePointer(wrapper, 'mouseMove', bob.x + bob.width / 2, 200));
    expect(screen.getByTestId('chart-tooltip-name').textContent).toBe('Bob');
    const rendersWhenHovered = mockPlotRenders.mock.calls.length;
    const layer = screen.getByTestId('chart-tooltip-layer');
    const tooltip = screen.getByTestId('chart-tooltip');

    // Moves inside the band: the tooltip follows, nothing renders.
    for (const [dx, y] of [
      [4, 150],
      [9, 230],
      [bob.width - 6, 90],
    ]) {
      await nextFrame();
      act(() => firePointer(wrapper, 'mouseMove', bob.x + dx, y));
      expect([layer.style.left, layer.style.top]).toEqual([`${bob.x + dx + 12}px`, `${y + 12}px`]);
    }

    expect(mockPlotRenders).toHaveBeenCalledTimes(rendersWhenHovered);
    expect(measure12).toHaveBeenCalledTimes(measuredAtMount);
    // The tooltip element itself was kept, not rebuilt per move.
    expect(screen.getByTestId('chart-tooltip')).toBe(tooltip);

    // Another band changes the tooltip; the plot still does not render.
    const carol = band(2);

    await nextFrame();
    act(() => firePointer(wrapper, 'mouseMove', carol.x + carol.width / 2, 200));
    expect(screen.getByTestId('chart-tooltip-name').textContent).toBe('Carol');
    expect(mockPlotRenders).toHaveBeenCalledTimes(rendersWhenHovered);
    expect(measure12).toHaveBeenCalledTimes(measuredAtMount);
  });

  it('keeps the category anchors the tests point at mounted while the pointer moves', async () => {
    const { container } = render(
      <ChartMeasureContext.Provider value={FIXTURE_MEASURE}>
        <ChartContext.Provider value={chartContextStub()}>
          <BarChartWidget data={seriesDataOf(OWNERS)} />
        </ChartContext.Provider>
      </ChartMeasureContext.Provider>
    );
    const wrapper = container.querySelector('.recharts-wrapper') as HTMLElement;
    const anchors = Array.from(container.querySelectorAll('[data-testid="chart-category-anchor"]'));

    expect(anchors.map((anchor) => anchor.getAttribute('data-label'))).toEqual(['Alice', 'Bob', 'Carol']);
    act(() => firePointer(wrapper, 'mouseMove', Number(anchors[1].getAttribute('x')) + 3, 200));
    await nextFrame();
    act(() => firePointer(wrapper, 'mouseMove', Number(anchors[1].getAttribute('x')) + 9, 180));
    expect(Array.from(container.querySelectorAll('[data-testid="chart-category-anchor"]'))).toEqual(anchors);
  });
});
