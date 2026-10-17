import { fireEvent, render, screen, within } from '@testing-library/react';

import { CHART_COLORS, ChartAggregationType, ChartDataItem } from '@/application/database-yjs/chart.type';
import { DonutChartWidget } from '@/components/database/chart/widgets/DonutChart';

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

// Size of the ring area: the 400px widget minus its 24px insets, the 16px gap and the legend.
const CHART_WIDTH = 800;
const CHART_HEIGHT = 316;

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

// Desktop PR screenshot data: five options with one row each, plus categories the donut drops.
const data: ChartDataItem[] = [
  { label: 'Plan A', value: 1, rowIds: ['row-1'], color: '#E5E7EB', textColor: '#4B5563' },
  { label: 'Plan B', value: 1, rowIds: ['row-2'] },
  { label: 'Zero', value: 0, rowIds: [] },
  { label: 'Plan X', value: 1, rowIds: ['row-3'] },
  { label: 'Negative', value: -3, rowIds: ['row-4'] },
  { label: 'Plan Z', value: 1, rowIds: ['row-5'] },
  { label: 'Broken', value: Number.NaN, rowIds: ['row-6'] },
  { label: 'PlanY', value: 1, rowIds: ['row-7'] },
];
const validData = data.filter((item) => item.value > 0);

/** jsdom reports inline hex colors as `rgb(r, g, b)`. */
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const sectors = (container: HTMLElement) => Array.from(container.querySelectorAll<SVGGElement>('.recharts-pie-sector'));
const leaderFor = (label: string) => {
  const leader = screen.getAllByTestId('donut-chart-leader').find((element) => element.textContent?.startsWith(label));

  if (!leader) throw new Error(`No leader for ${label}`);
  return leader;
};

const labelBox = (label: string) => leaderFor(label).querySelector<HTMLElement>('div');
const px = (value?: string) => parseFloat(value ?? '');
const fillOpacities = () =>
  screen.getAllByTestId('donut-chart-section').map((section) => section.getAttribute('fill-opacity'));

describe('DonutChartWidget', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('renders a Recharts section, a leader and a legend item per positive category', () => {
    const { container } = render(<DonutChartWidget data={data} />);

    expect(screen.getByTestId('donut-chart-widget')).toBeTruthy();
    expect(container.querySelector('.recharts-pie')).not.toBeNull();
    expect(sectors(container)).toHaveLength(5);
    expect(screen.getAllByTestId('donut-chart-leader')).toHaveLength(5);
    expect(screen.getAllByTestId('donut-chart-legend-item').map((item) => item.textContent)).toEqual([
      'Plan A',
      'Plan B',
      'Plan X',
      'Plan Z',
      'PlanY',
    ]);
    expect(screen.queryByText('Zero')).toBeNull();
    expect(screen.queryByText('Negative')).toBeNull();
    expect(screen.queryByText('Broken')).toBeNull();
  });

  it('shows the total and the aggregation title in the ring', () => {
    const { rerender } = render(<DonutChartWidget data={data} aggregationType={ChartAggregationType.Count} />);
    const center = screen.getByTestId('donut-chart-center');

    expect(center.textContent).toBe('5TotalCount(Type)');
    expect(within(center).getByTestId('chart-title').textContent).toBe('Count(Type)');

    rerender(<DonutChartWidget data={data} aggregationType={ChartAggregationType.Average} />);
    expect(within(screen.getByTestId('donut-chart-center')).getByTestId('chart-title').textContent).toBe(
      'Average(Type)'
    );

    rerender(<DonutChartWidget data={data} />);
    expect(screen.getByTestId('donut-chart-center').textContent).toBe('5Total');
  });

  it('labels every leader with the truncated count and its share', () => {
    const { rerender } = render(<DonutChartWidget data={data} />);

    expect(screen.getAllByTestId('donut-chart-leader-value').map((value) => value.textContent)).toEqual(
      Array(5).fill('1 (20.0%)')
    );

    rerender(
      <DonutChartWidget
        data={[
          { label: 'Sum A', value: 2.6, rowIds: ['row-1'] },
          { label: 'Sum B', value: 1.6, rowIds: ['row-2'] },
        ]}
      />
    );
    expect(screen.getAllByTestId('donut-chart-leader-value').map((value) => value.textContent)).toEqual([
      '2 (61.9%)',
      '1 (38.1%)',
    ]);
    expect(screen.getByTestId('donut-chart-center').textContent).toBe('4Total');
  });

  it('tints leaders with the section colors', () => {
    render(<DonutChartWidget data={data} />);

    const planA = leaderFor('Plan A');
    const planB = leaderFor('Plan B');

    // Lines use the fill color, labels the option's text color (falling back to the fill).
    expect(planA.querySelector('polyline')?.getAttribute('stroke')).toBe('#E5E7EB');
    expect(planA.querySelector<HTMLElement>('span')?.style.color).toBe(rgb('#4B5563'));
    expect(planB.querySelector('polyline')?.getAttribute('stroke')).toBe(CHART_COLORS[1]);
    expect(planB.querySelector<HTMLElement>('span')?.style.color).toBe(rgb(CHART_COLORS[1]));
    expect(within(planB).getByTestId('donut-chart-leader-value').style.opacity).toBe('0.7');
  });

  it('lays sections out clockwise from 3 o’clock with desktop leader geometry', () => {
    render(<DonutChartWidget data={data} />);

    // Plan A spans 0°–72°: below-right of the center (400, 158), so its label extends right.
    expect(leaderFor('Plan A').querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(3);
    expect(px(labelBox('Plan A')?.style.left)).toBeCloseTo(542.16, 1);
    expect(px(labelBox('Plan A')?.style.top)).toBeCloseTo(228.76, 1);

    // Plan X is centered at 9 o'clock: one straight 50px line, label right-anchored at its end.
    expect(leaderFor('Plan X').querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(2);
    expect(px(labelBox('Plan X')?.style.right)).toBeCloseTo(CHART_WIDTH - 239, 1);
    expect(px(labelBox('Plan X')?.style.top)).toBeCloseTo(140, 1);

    // Plan Z (252°) would poke above the chart: its label is clamped 4px below the top edge.
    expect(px(labelBox('Plan Z')?.style.right)).toBeCloseTo(466.66, 1);
    expect(labelBox('Plan Z')?.style.top).toBe('4px');

    // Plan B (108°) is clamped to 36 + 4px above the bottom edge.
    expect(px(labelBox('Plan B')?.style.top)).toBeCloseTo(CHART_HEIGHT - 40, 1);
  });

  it('separates sections with a constant 2px gap and draws a lone section as a full ring', () => {
    const { container, rerender } = render(<DonutChartWidget data={data} />);
    const firstPath = screen.getAllByTestId('donut-chart-section')[0].getAttribute('d') ?? '';
    const [, innerX, innerY, outerX, outerY] =
      /^M([\d.]+),([\d.]+) L([\d.]+),([\d.]+)/.exec(firstPath)?.map(Number) ?? [];

    // The first edge runs parallel to the 3 o'clock ray, 1px (half the gap) below it.
    expect(innerY).toBeCloseTo(159, 6);
    expect(outerY).toBeCloseTo(159, 6);
    expect(innerX).toBeCloseTo(400 + Math.sqrt(70 ** 2 - 1), 6);
    expect(outerX).toBeCloseTo(400 + Math.sqrt(110 ** 2 - 1), 6);

    rerender(<DonutChartWidget data={[{ label: 'Only', value: 3, rowIds: ['row-1'] }]} />);
    expect(screen.getByTestId('donut-chart-section').getAttribute('d')).toBe(
      'M510,158 A110,110 0 1 1 290,158 A110,110 0 1 1 510,158 M470,158 A70,70 0 1 0 330,158 A70,70 0 1 0 470,158 Z'
    );

    fireEvent.mouseEnter(sectors(container)[0]);
    expect(screen.getByTestId('donut-chart-section').getAttribute('d')).toMatch(/^M515,158 A115,115 /);
  });

  it('keeps only the part of a thin section that clears the gaps, like fl_chart', () => {
    const { rerender } = render(
      <DonutChartWidget
        data={[
          { label: 'Big', value: 299, rowIds: ['row-1'] },
          { label: 'Thin', value: 1, rowIds: ['row-2'] },
        ]}
      />
    );
    const thinPath = screen.getAllByTestId('donut-chart-section')[1].getAttribute('d') ?? '';
    const [, apexX, apexY] = /^M([\d.]+),([\d.]+)/.exec(thinPath)?.map(Number) ?? [];

    // Its inset edges meet ~95px from the center, between the hole and the rim: no inner arc is left.
    expect(thinPath.match(/A/g)).toHaveLength(1);
    expect(Math.hypot(apexX - 400, apexY - 158)).toBeCloseTo(1 / Math.sin(Math.PI / 300), 3);

    rerender(
      <DonutChartWidget
        data={[
          { label: 'Big', value: 1000, rowIds: ['row-1'] },
          { label: 'Thin', value: 1, rowIds: ['row-2'] },
        ]}
      />
    );
    // Narrower than the gap itself: nothing is painted, but the leader still points at it.
    expect(screen.getAllByTestId('donut-chart-section')[1].getAttribute('d')).toBe('');
    expect(screen.getAllByTestId('donut-chart-leader')).toHaveLength(2);
  });

  it('grows and fades the hovered section and shows the tooltip beside its label', () => {
    const { container } = render(<DonutChartWidget data={data} />);

    fireEvent.mouseEnter(sectors(container)[1]);

    expect(fillOpacities()).toEqual(['1', '0.8', '1', '1', '1']);

    const tooltip = screen.getByTestId('chart-tooltip');

    expect(tooltip.textContent).toContain('Plan B');
    expect(tooltip.textContent).toContain('1');
    // Left-half anchor x = lineEndX - 96 + 8 - 90 = 155.34; y = lineEndY = 301.6, clamped to 316 - 88.
    expect(px(tooltip.parentElement?.style.left)).toBeCloseTo(65.34, 1);
    expect(tooltip.parentElement?.style.top).toBe(`${CHART_HEIGHT - 88}px`);

    // The hovered leader is drawn last, above the other labels.
    const leaders = screen.getAllByTestId('donut-chart-leader');

    expect(leaders[leaders.length - 1].textContent).toContain('Plan B');

    fireEvent.mouseLeave(sectors(container)[1]);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    expect(fillOpacities()).toEqual(Array(5).fill('1'));
  });

  it('uses the section text color for the tooltip dot', () => {
    const { container } = render(<DonutChartWidget data={data} />);

    fireEvent.mouseEnter(sectors(container)[0]);

    const dot = within(screen.getByTestId('chart-tooltip')).getByTestId('chart-indicator-dot');

    expect(dot.querySelector<HTMLElement>(':scope > span > span')?.style.backgroundColor).toBe(rgb('#4B5563'));
  });

  it('drills down from a section or a legend item with the resolved color', () => {
    const onSliceClick = jest.fn();
    const { container } = render(<DonutChartWidget data={data} onSliceClick={onSliceClick} />);

    fireEvent.mouseEnter(sectors(container)[1]);
    fireEvent.click(sectors(container)[1]);
    expect(onSliceClick).toHaveBeenLastCalledWith({ ...validData[1], color: CHART_COLORS[1] });
    // Desktop clears the hover once a section is tapped.
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();

    fireEvent.click(screen.getAllByTestId('donut-chart-legend-item')[0]);
    expect(onSliceClick).toHaveBeenLastCalledWith({ ...validData[0], color: '#E5E7EB' });
    expect(onSliceClick).toHaveBeenCalledTimes(2);
  });

  it('shows the no-valid-data message when no category is positive', () => {
    const { container } = render(
      <DonutChartWidget
        data={[
          { label: 'Zero', value: 0, rowIds: [] },
          { label: 'Negative', value: -1, rowIds: ['row-1'] },
        ]}
      />
    );

    expect(screen.getByTestId('chart-no-valid-data').textContent).toBe('No valid data to display');
    expect(container.querySelector('.recharts-pie')).toBeNull();
  });
});
