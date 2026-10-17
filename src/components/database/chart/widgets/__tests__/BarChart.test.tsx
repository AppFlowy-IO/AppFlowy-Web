import { fireEvent, render, screen } from '@testing-library/react';
import { ComponentProps } from 'react';

import { CHART_COLORS, ChartAggregationType, ChartDataItem } from '@/application/database-yjs/chart.type';
import { BarChartWidget } from '@/components/database/chart/widgets/BarChart';
import { getChartTooltipPosition } from '@/components/database/chart/widgets/ChartTooltip';

// Real en.json strings, so the assertions cover the translation keys too.
jest.mock('react-i18next', () => {
  const i18n = jest.requireActual('i18next').createInstance();

  i18n.init({
    lng: 'en',
    initImmediate: false,
    resources: { en: { translation: jest.requireActual('@/@types/translations/en.json') } },
  });
  return { useTranslation: () => ({ t: i18n.t.bind(i18n) }) };
});

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  disconnect() {
    // The test has no persistent observation lifecycle to clean up.
  }

  observe(target: Element) {
    this.callback(
      [
        {
          borderBoxSize: [],
          contentBoxSize: [],
          contentRect: {
            bottom: 400,
            height: 400,
            left: 0,
            right: 800,
            top: 0,
            width: 800,
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
    // Recharts only needs the initial measurement in this test.
  }
}

// The mocked container is 800 x 400. With the 18px title the chart area is
// 782px wide: a 40px value axis, then a 742px plot; the plot is 360px tall
// above the 40px category band.
const WIDTH = 800;
const HEIGHT = 400;
const TITLE_WIDTH = 18;
const AXIS_WIDTH = 40;
const PLOT_WIDTH = WIDTH - TITLE_WIDTH - AXIS_WIDTH;
const PLOT_HEIGHT = HEIGHT - 40;

const OPTION_COLOR = 'var(--tag-fill-03-light)';
const ITEMS: ChartDataItem[] = [
  { label: 'Plan A', value: 3, rowIds: ['row-1', 'row-2', 'row-3'] },
  { label: 'Plan B', value: 2.5, rowIds: ['row-4'], color: OPTION_COLOR },
  { label: 'No Type', value: 0, rowIds: [], isEmptyCategory: true },
];
// Tallest bar 3 -> axis max 3.9 (30% headroom), ticks every 1.
const AXIS_MAX = 3.9;
const SEGMENT_WIDTH = PLOT_WIDTH / ITEMS.length;

function renderBarChart(props: Partial<ComponentProps<typeof BarChartWidget>> = {}) {
  return render(<BarChartWidget data={ITEMS} aggregationType={ChartAggregationType.Count} {...props} />);
}

function segmentCenter(index: number) {
  return AXIS_WIDTH + SEGMENT_WIDTH * (index + 0.5);
}

function barTop(value: number) {
  return PLOT_HEIGHT * (1 - value / AXIS_MAX);
}

function texts(container: HTMLElement, selector: string) {
  return Array.from(container.querySelectorAll(selector)).map((node) => node.textContent);
}

describe('BarChartWidget', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('renders the real Recharts component without an invalid hook call', () => {
    let container: HTMLElement | undefined;

    expect(
      () =>
        ({ container } = render(
          <BarChartWidget
            data={[
              {
                color: '#5B8FF9',
                label: 'In Progress',
                rowIds: ['row-1'],
                value: 1,
              },
            ]}
          />
        ))
    ).not.toThrow();

    expect(screen.getByTestId('bar-chart-widget')).toBeTruthy();
    expect(container?.querySelector('.recharts-wrapper')).not.toBeNull();
    expect(container?.querySelector('.recharts-bar-rectangle')).not.toBeNull();
  });

  it('titles the value axis with the aggregation like desktop', () => {
    const { rerender } = renderBarChart();

    expect(screen.getByTestId('chart-title').textContent).toBe('Count(Type)');

    rerender(<BarChartWidget data={ITEMS} aggregationType={ChartAggregationType.Sum} />);
    expect(screen.getByTestId('chart-title').textContent).toBe('Sum(Type)');

    rerender(<BarChartWidget data={ITEMS} />);
    expect(screen.queryByTestId('chart-title')).toBeNull();
  });

  it('centers one bar per category in equal segments with value labels in the bar color', () => {
    const { container } = renderBarChart();

    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(3);
    expect(texts(container, '.recharts-xAxis .recharts-cartesian-axis-tick text')).toEqual([
      'Plan A',
      'Plan B',
      'No Type',
    ]);

    const fills = Array.from(container.querySelectorAll('.recharts-bar-rectangle path')).map((path) =>
      path.getAttribute('fill')
    );

    // The zero-height bar renders no path.
    expect(fills).toEqual([CHART_COLORS[0], OPTION_COLOR]);

    const valueLabels = Array.from(container.querySelectorAll('.recharts-label-list text'));

    expect(valueLabels.map((label) => label.textContent)).toEqual(['3', '2.5', '0']);
    expect(valueLabels.map((label) => label.getAttribute('fill'))).toEqual([
      CHART_COLORS[0],
      OPTION_COLOR,
      CHART_COLORS[2],
    ]);
    valueLabels.forEach((label, index) => {
      // Recharts floors the bar offset inside its band, so allow a pixel.
      expect(Math.abs(Number(label.getAttribute('x')) - segmentCenter(index))).toBeLessThanOrEqual(1);
      expect(Number(label.getAttribute('y'))).toBeCloseTo(barTop(ITEMS[index].value) - 4);
    });
  });

  it('labels whole ticks between the axis min and max and dashes the grid on every tick', () => {
    const { container } = renderBarChart();

    const valueLabels = Array.from(container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick text'));

    expect(valueLabels.map((label) => label.textContent)).toEqual(['1', '2', '3']);
    valueLabels.forEach((label, index) => {
      expect(Number(label.getAttribute('x'))).toBe(AXIS_WIDTH);
      expect(Number(label.getAttribute('y'))).toBeCloseTo(barTop(index + 1));
    });

    const gridLines = Array.from(container.querySelectorAll('.recharts-cartesian-grid-horizontal line'));

    expect(gridLines.map((line) => Number(line.getAttribute('y1')))).toEqual(
      [1, 2, 3].map((value) => expect.closeTo(barTop(value)))
    );
    expect(gridLines[0].getAttribute('stroke-dasharray')).toBe('5 5');
    expect(container.querySelectorAll('.recharts-cartesian-grid-vertical line')).toHaveLength(0);
  });

  it('skips fractional ticks and both axis ends', () => {
    // Tallest bar 1 -> axis max 1.3 with ticks every 0.2: only 1 is labeled.
    const { container } = renderBarChart({ data: [{ label: 'Only', value: 1, rowIds: ['row-1'] }] });

    expect(texts(container, '.recharts-yAxis .recharts-cartesian-axis-tick text')).toEqual(['1']);
    expect(container.querySelectorAll('.recharts-cartesian-grid-horizontal line')).toHaveLength(6);
  });

  it('labels nothing on an all-zero chart instead of Recharts fractional ticks', () => {
    // Tallest bar 0 -> axis max 1 with ticks every 1: desktop skips both axis
    // ends, so no value label is drawn at all.
    const { container } = renderBarChart({ data: [{ label: 'Empty', value: 0, rowIds: [] }] });

    expect(texts(container, '.recharts-yAxis .recharts-cartesian-axis-tick text')).toEqual([]);
    expect(texts(container, '.recharts-xAxis .recharts-cartesian-axis-tick text')).toEqual(['Empty']);
  });

  it('tilts the category labels once there are more than six', () => {
    const items = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ label: `Category ${index}`, value: index, rowIds: [] }));
    const { container, rerender } = renderBarChart({ data: items(6) });
    const transforms = () =>
      Array.from(container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick text')).map((label) =>
        label.getAttribute('transform')
      );

    expect(transforms().every((transform) => transform === null)).toBe(true);

    rerender(<BarChartWidget data={items(7)} aggregationType={ChartAggregationType.Count} />);
    expect(transforms().every((transform) => transform?.startsWith('rotate(-28.64'))).toBe(true);
  });

  it('lets the labels paint past the chart surface like desktop', () => {
    renderBarChart();

    // jsdom does no layout: the class is what undoes the SVG's default `overflow: hidden`.
    expect(screen.getByTestId('bar-chart-plot').className).toContain('[&_.recharts-surface]:overflow-visible');
  });

  it('truncates long category labels after 15 characters', () => {
    const { container } = renderBarChart({
      data: [{ label: 'A very long category name', value: 1, rowIds: [] }],
    });

    expect(texts(container, '.recharts-xAxis .recharts-cartesian-axis-tick text')).toEqual(['A very long cat...']);
  });

  it('hovers the whole segment column: background, hidden value label and tooltip above the bar', () => {
    const { container } = renderBarChart();
    const plot = screen.getByTestId('bar-chart-plot');

    // Inside the second segment but down in the category label band.
    fireEvent.mouseMove(plot, { clientX: segmentCenter(1) + 50, clientY: HEIGHT - 10 });

    const background = screen.getByTestId('bar-chart-hover-background');

    expect(parseFloat(background.style.left)).toBeCloseTo(AXIS_WIDTH + SEGMENT_WIDTH);
    expect(parseFloat(background.style.width)).toBeCloseTo(SEGMENT_WIDTH);
    expect(parseFloat(background.style.height)).toBe(PLOT_HEIGHT);
    expect(plot.className).toContain('cursor-pointer');
    expect(texts(container, '.recharts-label-list text')).toEqual(['3', '0']);

    const tooltip = screen.getByTestId('chart-tooltip');
    const expected = getChartTooltipPosition(
      { x: TITLE_WIDTH + segmentCenter(1), y: barTop(2.5) },
      { width: WIDTH, height: HEIGHT }
    );

    expect(tooltip.textContent).toContain('Plan B');
    // Desktop truncates the tooltip value.
    expect(tooltip.textContent).toContain('2');
    expect(tooltip.textContent).not.toContain('2.5');
    expect(parseFloat(tooltip.parentElement?.style.left ?? '')).toBeCloseTo(expected.left);
    expect(parseFloat(tooltip.parentElement?.style.top ?? '')).toBeCloseTo(expected.top);

    // The tooltip swatch takes the palette color resolved for the hovered index.
    fireEvent.mouseMove(plot, { clientX: segmentCenter(0), clientY: 200 });
    expect(screen.getByTestId('chart-tooltip').textContent).toContain('Plan A');
    expect(screen.getByTestId('chart-indicator-dot').querySelector('[style]')?.getAttribute('style')).toMatch(
      /#5b8ff9|rgb\(91, 143, 249\)/i
    );

    fireEvent.mouseLeave(plot);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    expect(screen.queryByTestId('bar-chart-hover-background')).toBeNull();
    expect(plot.className).not.toContain('cursor-pointer');
    expect(texts(container, '.recharts-label-list text')).toEqual(['3', '2.5', '0']);
  });

  it('ignores the pointer over the value axis', () => {
    renderBarChart();
    fireEvent.mouseMove(screen.getByTestId('bar-chart-plot'), { clientX: AXIS_WIDTH - 5, clientY: 100 });

    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('opens the clicked segment with its resolved color', () => {
    const onBarClick = jest.fn();

    renderBarChart({ onBarClick });
    const plot = screen.getByTestId('bar-chart-plot');

    fireEvent.click(plot, { clientX: segmentCenter(0) - 80, clientY: 20 });
    expect(onBarClick).toHaveBeenLastCalledWith({ ...ITEMS[0], color: CHART_COLORS[0] });

    fireEvent.click(plot, { clientX: segmentCenter(1), clientY: 300 });
    expect(onBarClick).toHaveBeenLastCalledWith({ ...ITEMS[1], color: OPTION_COLOR });

    fireEvent.click(plot, { clientX: segmentCenter(2), clientY: 300 });
    expect(onBarClick).toHaveBeenLastCalledWith({ ...ITEMS[2], color: CHART_COLORS[2] });

    fireEvent.click(plot, { clientX: 10, clientY: 300 });
    expect(onBarClick).toHaveBeenCalledTimes(3);
  });

  it('drops negative and non-finite values and colors by the rendered index', () => {
    const onBarClick = jest.fn();
    const { container } = renderBarChart({
      onBarClick,
      data: [
        { label: 'Kept', value: 2, rowIds: ['row-1'] },
        { label: 'Negative', value: -1, rowIds: ['row-2'] },
        { label: 'NaN', value: Number.NaN, rowIds: ['row-3'] },
        { label: 'Infinite', value: Number.POSITIVE_INFINITY, rowIds: ['row-4'] },
        { label: 'Also kept', value: 1, rowIds: ['row-5'] },
      ],
    });

    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
    expect(texts(container, '.recharts-xAxis .recharts-cartesian-axis-tick text')).toEqual(['Kept', 'Also kept']);

    fireEvent.click(screen.getByTestId('bar-chart-plot'), { clientX: AXIS_WIDTH + PLOT_WIDTH * 0.75, clientY: 100 });
    expect(onBarClick).toHaveBeenCalledWith({ label: 'Also kept', value: 1, rowIds: ['row-5'], color: CHART_COLORS[1] });
  });

  it('shows the no-valid-data note when nothing can be plotted', () => {
    const { container } = renderBarChart({ data: [{ label: 'Negative', value: -3, rowIds: ['row-1'] }] });

    expect(screen.getByTestId('bar-chart-widget').textContent).toBe('No valid data to display');
    expect(screen.getByTestId('chart-no-valid-data')).toBeTruthy();
    expect(container.querySelector('.recharts-wrapper')).toBeNull();
  });
});
