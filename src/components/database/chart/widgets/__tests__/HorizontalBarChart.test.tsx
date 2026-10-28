import { fireEvent, render, screen } from '@testing-library/react';

import {
  CHART_COLORS,
  CHART_EMPTY_VALUE_COLOR,
  ChartAggregationType,
  ChartDataItem,
} from '@/application/database-yjs/chart.type';
import { HorizontalBarChartWidget } from '@/components/database/chart/widgets/HorizontalBarChart';

jest.mock('react-i18next', () => {
  const translations: unknown = jest.requireActual('@/@types/translations/en.json');
  const t = (key: string) => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
        translations
      );

    return typeof value === 'string' ? value : key;
  };

  return { useTranslation: () => ({ t }) };
});

// Content box of the chart (inside the widget's 18px + 24px insets).
const CHART_WIDTH = 800;
const CHART_HEIGHT = 400;

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  disconnect() {
    // observe() reports one fixed size, so there is nothing to release.
  }

  observe(target: Element) {
    this.callback(
      [
        {
          borderBoxSize: [],
          contentBoxSize: [],
          contentRect: {
            bottom: CHART_HEIGHT,
            height: CHART_HEIGHT,
            left: 0,
            right: CHART_WIDTH,
            top: 0,
            width: CHART_WIDTH,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
          devicePixelContentBoxSize: [],
          target,
        },
      ],
      this
    );
  }

  unobserve() {
    // Sizes never change in these tests.
  }
}

const data: ChartDataItem[] = [
  { label: 'Plan A', value: 3, rowIds: ['row-1', 'row-2', 'row-3'], color: '#E86452' },
  { label: 'Plan B', value: 1.6, rowIds: ['row-4', 'row-5'] },
  { label: 'Negative', value: -2, rowIds: ['row-6'] },
  { label: 'Broken', value: Number.POSITIVE_INFINITY, rowIds: ['row-7'] },
  { label: 'No Plan', value: 0, rowIds: [], isEmptyCategory: true },
];

const rows = () => screen.getAllByTestId('horizontal-bar-chart-row');
const barAreas = () => screen.getAllByTestId('horizontal-bar-chart-bar-area');
/** jsdom reports inline hex colors as `rgb(r, g, b)`. */
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

describe('HorizontalBarChartWidget', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('renders a row per finite, non-negative category with truncated values', () => {
    render(<HorizontalBarChartWidget data={data} />);

    expect(screen.getByTestId('horizontal-bar-chart-widget')).toBeTruthy();
    expect(rows().map((row) => row.textContent)).toEqual(['Plan A3', 'Plan B1', 'No Plan0']);
    expect(screen.queryByText('Negative')).toBeNull();
    expect(screen.queryByText('Broken')).toBeNull();
  });

  it('sizes bars against the rounded axis maximum and draws the value axis', () => {
    render(<HorizontalBarChartWidget data={data} />);

    // max 3 → axis max 4; the bar area is 800 - 100 (labels) - 40 (value room) = 660px.
    const bars = screen.getAllByTestId('horizontal-bar-chart-bar');

    expect(bars.map((bar) => bar.style.width)).toEqual(['495px', '264px', '0px']);
    // Fixed option color first, then the palette by position in the rendered list; "No …" is grey.
    expect(bars.map((bar) => bar.style.backgroundColor)).toEqual([
      rgb('#E86452'),
      rgb(CHART_COLORS[1]),
      rgb(CHART_EMPTY_VALUE_COLOR),
    ]);
    // 16px tall with square ends.
    bars.forEach((bar) => {
      expect(bar.className).toContain('h-4');
      expect(bar.className).not.toMatch(/rounded/);
    });

    expect(screen.getAllByTestId('horizontal-bar-chart-x-label').map((label) => label.textContent)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(
      screen.getAllByTestId('horizontal-bar-chart-grid-line').map((line) => Number(line.getAttribute('x1')))
    ).toEqual([100, 265, 430, 595, 760]);
    // The label column, the grid and the value axis share one 100px offset.
    rows().forEach((row) => expect((row.firstElementChild as HTMLElement).style.width).toBe('100px'));
    expect(
      (screen.getAllByTestId('horizontal-bar-chart-x-label')[0].parentElement as HTMLElement).style.paddingLeft
    ).toBe('100px');
  });

  it('floors the decade like desktop, so a max of exactly 800 gets a 1000 axis', () => {
    render(
      <HorizontalBarChartWidget
        data={[
          { label: 'Plan A', value: 800, rowIds: ['row-1'] },
          { label: 'Plan B', value: 200, rowIds: ['row-2'] },
        ]}
      />
    );

    // 800 × 1.25 = 1000, whose desktop decade (log / ln10) is 2, not 3: axis max 1000, not 1500.
    expect(screen.getAllByTestId('horizontal-bar-chart-x-label').map((label) => label.textContent)).toEqual([
      '0',
      '250',
      '500',
      '750',
      '1000',
    ]);
    // 80% and 20% of the 660px bar area.
    expect(screen.getAllByTestId('horizontal-bar-chart-bar').map((bar) => bar.style.width)).toEqual(['528px', '132px']);
  });

  it('truncates long category labels like desktop', () => {
    render(<HorizontalBarChartWidget data={[{ label: 'A very long category name', value: 2, rowIds: ['row-1'] }]} />);

    expect(rows()[0].textContent).toBe('A very long cat...2');
  });

  it('renders the aggregation title below the axis only when an aggregation is set', () => {
    const { rerender } = render(<HorizontalBarChartWidget data={data} aggregationType={ChartAggregationType.Sum} />);

    expect(screen.getByTestId('chart-title').textContent).toBe('Sum(Type)');

    rerender(<HorizontalBarChartWidget data={data} aggregationType={ChartAggregationType.Count} />);
    expect(screen.getByTestId('chart-title').textContent).toBe('Count(Type)');

    rerender(<HorizontalBarChartWidget data={data} />);
    expect(screen.queryByTestId('chart-title')).toBeNull();
  });

  it('shows the tooltip past the hovered bar and fills only that bar area', () => {
    render(<HorizontalBarChartWidget data={data} />);

    fireEvent.mouseEnter(rows()[1]);

    const tooltip = screen.getByTestId('chart-tooltip');

    expect(tooltip.textContent).toContain('Plan B');
    expect(tooltip.textContent).toContain('1');
    // Anchor x = 100 + 0.4 × 660 + 110 = 474, y = 1.5 / 3 × (400 - 32) = 184,
    // then centered on the 180×80 box and lifted 20px.
    expect(tooltip.parentElement?.style.left).toBe('384px');
    expect(tooltip.parentElement?.style.top).toBe('124px');

    expect(barAreas()[1].className).toContain('bg-fill-content-hover');
    expect(barAreas()[0].className).not.toContain('bg-fill-content-hover');
    expect(rows()[1].className).toContain('cursor-pointer');
    expect(rows()[0].className).not.toContain('cursor-pointer');

    fireEvent.mouseLeave(rows()[1]);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    expect(barAreas()[1].className).not.toContain('bg-fill-content-hover');
  });

  it('keeps the tooltip inside the chart', () => {
    render(<HorizontalBarChartWidget data={data} />);

    fireEvent.mouseEnter(rows()[0]);

    // Anchor (705, 61.3) would put the box past the right and top edges.
    const position = screen.getByTestId('chart-tooltip').parentElement;

    expect(position?.style.left).toBe(`${CHART_WIDTH - 180 - 8}px`);
    expect(position?.style.top).toBe('8px');
  });

  it('drills into categories that have rows, passing the resolved color', () => {
    const onBarClick = jest.fn();

    render(<HorizontalBarChartWidget data={data} onBarClick={onBarClick} />);

    fireEvent.mouseEnter(rows()[1]);
    fireEvent.click(rows()[1]);
    expect(onBarClick).toHaveBeenCalledTimes(1);
    expect(onBarClick).toHaveBeenCalledWith({ ...data[1], color: '#5AD8A6' });
    // The drill-down dialog takes over, so the hover ends.
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();

    fireEvent.click(rows()[0]);
    expect(onBarClick).toHaveBeenLastCalledWith({ ...data[0], color: '#E86452' });

    // "No Plan" has no rows to show.
    fireEvent.click(rows()[2]);
    expect(onBarClick).toHaveBeenCalledTimes(2);
  });

  it('shows the no-valid-data message when no category can be drawn', () => {
    render(
      <HorizontalBarChartWidget
        data={[
          { label: 'Negative', value: -1, rowIds: ['row-1'] },
          { label: 'Broken', value: Number.NaN, rowIds: ['row-2'] },
        ]}
      />
    );

    expect(screen.getByTestId('chart-no-valid-data').textContent).toBe('No valid data to display');
    expect(screen.queryAllByTestId('horizontal-bar-chart-row')).toHaveLength(0);
  });
});
