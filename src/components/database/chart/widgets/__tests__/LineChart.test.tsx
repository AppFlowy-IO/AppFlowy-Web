import { fireEvent, render, screen } from '@testing-library/react';
import { ComponentProps } from 'react';

import {
  CHART_COLORS,
  CHART_EMPTY_VALUE_COLOR,
  ChartAggregationType,
  ChartDataItem,
} from '@/application/database-yjs/chart.type';
import { lineCategoryAxisLayout } from '@/components/database/chart/widgets/chartAxis';
import { getChartTooltipPosition } from '@/components/database/chart/widgets/ChartTooltip';
import { LineChartWidget } from '@/components/database/chart/widgets/LineChart';

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

// jsdom has no canvas: 6px per character stands in for the caption font.
jest.mock('@/components/database/chart/widgets/chartTextMeasure', () => ({
  measureCategoryLabelWidth: (text: string) => text.length * 6,
}));

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

const OPTION_COLOR = 'var(--tag-fill-05-light)';
const ITEMS: ChartDataItem[] = [
  { label: 'Plan A', value: 1, rowIds: ['row-1'], color: OPTION_COLOR },
  { label: 'Plan B', value: 1, rowIds: ['row-2'] },
  { label: 'Plan X', value: 1, rowIds: ['row-3'] },
  { label: 'Plan Z', value: 2.5, rowIds: ['row-4', 'row-5'] },
  { label: 'No Bank', value: 0, rowIds: [], isEmptyCategory: true },
];
// Max 2.5 -> 20% headroom rounds up to an axis max of 5, ticks every 1.
const AXIS_MAX = 5;

function renderLineChart(props: Partial<ComponentProps<typeof LineChartWidget>> = {}) {
  return render(<LineChartWidget data={ITEMS} aggregationType={ChartAggregationType.Count} {...props} />);
}

/** Points sit in the middle of equal segments (x domain -0.5 .. n - 0.5). */
function pointX(index: number, count = ITEMS.length) {
  return AXIS_WIDTH + ((index + 0.5) / count) * PLOT_WIDTH;
}

function pointY(value: number) {
  return PLOT_HEIGHT * (1 - value / AXIS_MAX);
}

function texts(container: HTMLElement, selector: string) {
  return Array.from(container.querySelectorAll(selector)).map((node) => node.textContent);
}

describe('LineChartWidget', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('draws a straight 2px line in the series color through the points, with no markers', () => {
    const { container } = renderLineChart();

    expect(screen.getByTestId('line-chart-widget')).toBeTruthy();
    expect(container.querySelector('.recharts-wrapper')).not.toBeNull();

    const curve = container.querySelector('.recharts-line .recharts-line-curve');

    expect(curve?.getAttribute('stroke')).toBe('#91B5FB');
    expect(curve?.getAttribute('stroke-width')).toBe('2');
    expect(curve?.getAttribute('stroke-linecap')).toBe('round');
    // Linear segments only, and no area fill under the line.
    expect(curve?.getAttribute('d')).not.toMatch(/C/);
    expect(container.querySelector('.recharts-area')).toBeNull();
    expect(container.querySelectorAll('.recharts-dot')).toHaveLength(0);

    // The line runs through the point of every category.
    const vertices = Array.from((curve?.getAttribute('d') ?? '').matchAll(/[ML]([\d.]+),([\d.]+)/g));

    expect(vertices).toHaveLength(ITEMS.length);
    vertices.forEach(([, x, y], index) => {
      expect(Number(x)).toBeCloseTo(pointX(index));
      expect(Number(y)).toBeCloseTo(pointY(ITEMS[index].value));
    });
    expect(texts(container, '.recharts-xAxis .recharts-cartesian-axis-tick text')).toEqual(
      ITEMS.map((item) => item.label)
    );
  });

  it('tilts the category labels once a slot is narrower than 100px, inside a band measured to hold them', () => {
    const items = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ label: `A long category ${index}`, value: index, rowIds: [] }));
    const ticks = () => Array.from(container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick text'));
    // 742 / 7 = 106px per slot: upright, 8px under the axis in the 40px band.
    const { container, rerender } = renderLineChart({ data: items(7) });

    expect(ticks().every((tick) => tick.getAttribute('transform') === null)).toBe(true);
    expect(Number(ticks()[0].getAttribute('y'))).toBe(PLOT_HEIGHT + 17);

    // 742 / 8 = 92.75px per slot: tilted, centered in a band of the widest label plus 8px.
    rerender(<LineChartWidget data={items(8)} aggregationType={ChartAggregationType.Count} />);
    const layout = lineCategoryAxisLayout(
      items(8).map((item) => item.label),
      PLOT_WIDTH / 8,
      (text) => text.length * 6
    );
    const plotHeight = HEIGHT - layout.height;

    expect(layout.height).toBeCloseTo(108 * Math.sin(0.5) + 18 * Math.cos(0.5) + 8);
    ticks().forEach((tick) => {
      const y = Number(tick.getAttribute('y'));

      expect(y).toBeCloseTo(plotHeight + layout.labelCenter);
      expect(tick.getAttribute('transform')).toBe(`rotate(${(-0.5 * 180) / Math.PI} ${tick.getAttribute('x')} ${y})`);
    });
  });

  it('titles the value axis with the aggregation like desktop', () => {
    const { rerender } = renderLineChart();

    expect(screen.getByTestId('chart-title').textContent).toBe('Count(Type)');

    rerender(<LineChartWidget data={ITEMS} aggregationType={ChartAggregationType.Average} />);
    expect(screen.getByTestId('chart-title').textContent).toBe('Average(Type)');
  });

  it('labels whole ticks from zero up to (not including) the axis max over a dashed grid', () => {
    const { container } = renderLineChart();
    const labels = Array.from(container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick text'));

    expect(labels.map((label) => label.textContent)).toEqual(['0', '1', '2', '3', '4']);
    labels.forEach((label, index) => {
      // 8px between the label and the plot.
      expect(Number(label.getAttribute('x'))).toBe(AXIS_WIDTH - 8);
      expect(Number(label.getAttribute('y'))).toBeCloseTo(pointY(index));
    });

    const gridLines = Array.from(container.querySelectorAll('.recharts-cartesian-grid-horizontal line'));

    expect(gridLines.map((line) => Number(line.getAttribute('y1')))).toEqual(
      [1, 2, 3, 4].map((value) => expect.closeTo(pointY(value)))
    );
    expect(gridLines[0].getAttribute('stroke-dasharray')).toBe('5 5');
  });

  it('keeps an all-zero series on a 0..5 axis', () => {
    const { container } = renderLineChart({
      data: [
        { label: 'A', value: 0, rowIds: [] },
        { label: 'B', value: 0, rowIds: [] },
      ],
    });

    expect(texts(container, '.recharts-yAxis .recharts-cartesian-axis-tick text')).toEqual(['0', '1', '2', '3', '4']);
  });

  it('lets the labels paint past the chart surface like desktop', () => {
    renderLineChart();

    // jsdom does no layout: the class is what undoes the SVG's default `overflow: hidden`.
    expect(screen.getByTestId('line-chart-plot').className).toContain('[&_.recharts-surface]:overflow-visible');
  });

  it('labels every point with its value, hovered or not', () => {
    const { container } = renderLineChart();
    const expectLabels = () => {
      const labels = Array.from(container.querySelectorAll('.recharts-label-list text'));

      expect(labels.map((label) => label.textContent)).toEqual(['1', '1', '1', '2.5', '0']);
      labels.forEach((label, index) => {
        expect(Number(label.getAttribute('x'))).toBeCloseTo(pointX(index));
        // Center of a 20px box that starts 28px above the point.
        expect(Number(label.getAttribute('y'))).toBeCloseTo(Math.max(0, pointY(ITEMS[index].value) - 28) + 10);
        expect(label.getAttribute('fill')).toBe('var(--block-text-color-13)');
      });
    };

    expectLabels();
    fireEvent.mouseMove(screen.getByTestId('line-chart-plot'), { clientX: pointX(3), clientY: 100 });
    expect(screen.getByTestId('chart-tooltip')).toBeTruthy();
    expectLabels();
  });

  it('hovers the point within 10px along x: dashed line and a raised tooltip', () => {
    renderLineChart();
    const plot = screen.getByTestId('line-chart-plot');

    fireEvent.mouseMove(plot, { clientX: pointX(2) + 9.5, clientY: 30 });

    const tooltip = screen.getByTestId('chart-tooltip');
    const expected = getChartTooltipPosition(
      { x: TITLE_WIDTH + pointX(2), y: pointY(1) },
      { width: WIDTH, height: HEIGHT },
      60
    );

    expect(tooltip.textContent).toContain('Plan X');
    expect(tooltip.textContent).toContain('Click to view data');
    expect(parseFloat(tooltip.parentElement?.style.left ?? '')).toBeCloseTo(expected.left);
    expect(parseFloat(tooltip.parentElement?.style.top ?? '')).toBeCloseTo(expected.top);
    expect(plot.className).toContain('cursor-pointer');

    const hoverLine = screen.getByTestId('line-chart-hover-line');

    expect(parseFloat(hoverLine.style.left)).toBeCloseTo(pointX(2) - 0.5);
    expect(parseFloat(hoverLine.style.height)).toBe(PLOT_HEIGHT);

    fireEvent.mouseLeave(plot);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    expect(screen.queryByTestId('line-chart-hover-line')).toBeNull();
  });

  it('ignores the pointer away from the points or outside the plot', () => {
    renderLineChart();
    const plot = screen.getByTestId('line-chart-plot');

    for (const [clientX, clientY] of [
      [pointX(2) + 11, 100],
      // The category label band under the plot.
      [pointX(2), PLOT_HEIGHT + 10],
      // The value axis.
      [AXIS_WIDTH - 2, 100],
    ]) {
      fireEvent.mouseMove(plot, { clientX, clientY });
      expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    }
  });

  it('opens the clicked point with its resolved color', () => {
    const onPointClick = jest.fn();

    renderLineChart({ onPointClick });
    const plot = screen.getByTestId('line-chart-plot');

    // The "No {field}" category is grey on every chart.
    fireEvent.click(plot, { clientX: pointX(4) - 3, clientY: 200 });
    expect(onPointClick).toHaveBeenLastCalledWith({ ...ITEMS[4], color: CHART_EMPTY_VALUE_COLOR });

    fireEvent.click(plot, { clientX: pointX(0), clientY: 200 });
    expect(onPointClick).toHaveBeenLastCalledWith({ ...ITEMS[0], color: OPTION_COLOR });

    // Halfway between two points is out of reach of both.
    fireEvent.click(plot, { clientX: (pointX(1) + pointX(2)) / 2, clientY: 200 });
    expect(onPointClick).toHaveBeenCalledTimes(2);
  });

  it('drops the hover state on click like desktop', () => {
    renderLineChart();
    const plot = screen.getByTestId('line-chart-plot');

    fireEvent.mouseMove(plot, { clientX: pointX(1), clientY: 200 });
    expect(screen.getByTestId('chart-tooltip')).toBeTruthy();

    fireEvent.click(plot, { clientX: pointX(1), clientY: 200 });
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('drops negative and non-finite values and colors by the rendered index', () => {
    const onPointClick = jest.fn();
    const { container } = renderLineChart({
      onPointClick,
      data: [
        { label: 'Kept', value: 2, rowIds: ['row-1'] },
        { label: 'Negative', value: -1, rowIds: ['row-2'] },
        { label: 'NaN', value: Number.NaN, rowIds: ['row-3'] },
        { label: 'Also kept', value: 3, rowIds: ['row-4'] },
      ],
    });

    expect(texts(container, '.recharts-label-list text')).toEqual(['2', '3']);
    expect(texts(container, '.recharts-xAxis .recharts-cartesian-axis-tick text')).toEqual(['Kept', 'Also kept']);

    fireEvent.click(screen.getByTestId('line-chart-plot'), { clientX: pointX(1, 2), clientY: 100 });
    expect(onPointClick).toHaveBeenCalledWith({
      label: 'Also kept',
      value: 3,
      rowIds: ['row-4'],
      color: CHART_COLORS[1],
    });
  });

  it('shows the no-valid-data note when nothing can be plotted', () => {
    const { container } = renderLineChart({ data: [{ label: 'Negative', value: -3, rowIds: ['row-1'] }] });

    expect(screen.getByTestId('line-chart-widget').textContent).toBe('No valid data to display');
    expect(screen.getByTestId('chart-no-valid-data')).toBeTruthy();
    expect(container.querySelector('.recharts-wrapper')).toBeNull();
  });
});
