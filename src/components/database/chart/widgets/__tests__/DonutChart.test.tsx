import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactElement } from 'react';

import { ChartAggregationType, ChartDataItem } from '@/application/database-yjs/chart.type';
import { DonutChartWidget } from '@/components/database/chart/widgets/DonutChart';
import { ThemeModeContext } from '@/components/main/useAppThemeMode';

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
let chartHeight = CHART_HEIGHT;

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
            bottom: chartHeight,
            height: chartHeight,
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
// Plan A carries the light blue tag fill; the rest take the donut palette by position.
const data: ChartDataItem[] = [
  {
    label: 'Plan A',
    value: 1,
    rowIds: ['row-1'],
    color: 'var(--tag-fill-09-light)',
    textColor: 'var(--tag-text-09-light)',
  },
  { label: 'Plan B', value: 1, rowIds: ['row-2'] },
  { label: 'Zero', value: 0, rowIds: [] },
  { label: 'Plan X', value: 1, rowIds: ['row-3'] },
  { label: 'Negative', value: -3, rowIds: ['row-4'] },
  { label: 'Plan Z', value: 1, rowIds: ['row-5'] },
  { label: 'Broken', value: Number.NaN, rowIds: ['row-6'] },
  { label: 'PlanY', value: 1, rowIds: ['row-7'] },
];
const validData = data.filter((item) => item.value > 0);
// Plan A's tag snaps to the sky blue; the others are palette entries 1-4. Labels use the deep tones.
const FILLS = ['#8BCBFC', '#FFD39A', '#FFE2A1', '#FFEC8E', '#E7EB74'];
const TEXTS = ['#0575CA', '#A45D00', '#976800', '#846E00', '#6B6F10'];

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
const leaderOpacities = () =>
  Object.fromEntries(
    screen
      .getAllByTestId('donut-chart-leader')
      .map((leader) => [leader.textContent?.split(/\d/)[0], leader.style.opacity || '1'])
  );
const legendLabelClasses = () =>
  screen
    .getAllByTestId('donut-chart-legend-item')
    .map((item) => item.querySelector(':scope > span:last-child')?.className);
const renderDark = (ui: ReactElement) =>
  render(<ThemeModeContext.Provider value={{ isDark: true, setDark: jest.fn() }}>{ui}</ThemeModeContext.Provider>);

describe('DonutChartWidget', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  afterEach(() => {
    chartHeight = CHART_HEIGHT;
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

  it('draws from the donut palette and labels each section in a readable tone of its fill', () => {
    render(<DonutChartWidget data={data} />);

    expect(screen.getAllByTestId('donut-chart-section').map((section) => section.getAttribute('fill'))).toEqual(FILLS);
    ['Plan A', 'Plan B', 'Plan X', 'Plan Z', 'PlanY'].forEach((label, index) => {
      const leader = leaderFor(label);

      expect(leader.querySelector('polyline')?.getAttribute('stroke')).toBe(FILLS[index]);
      expect(leader.querySelector<HTMLElement>('span')?.style.color).toBe(rgb(TEXTS[index]));
    });
    expect(within(leaderFor('Plan B')).getByTestId('donut-chart-leader-value').style.opacity).toBe('0.7');

    const swatches = screen
      .getAllByTestId('donut-chart-legend-item')
      .map((item) => item.querySelector<HTMLElement>('[style]')?.style.backgroundColor);

    expect(swatches).toEqual(FILLS.map(rgb));
  });

  it('labels with the fills themselves on the dark theme, where the pastels already read', () => {
    renderDark(<DonutChartWidget data={data} />);

    ['Plan A', 'Plan B', 'Plan X', 'Plan Z', 'PlanY'].forEach((label, index) => {
      expect(leaderFor(label).querySelector<HTMLElement>('span')?.style.color).toBe(rgb(FILLS[index]));
    });
  });

  it('lays sections out clockwise from 3 o’clock with desktop leader geometry', () => {
    render(<DonutChartWidget data={data} />);

    // Plan A spans 0°–72°: below-right of the center (400, 158). Its leader starts on the
    // ring's outer edge (70 + 13 + 1 = 84px out), and its label reads rightward 4px past the line end.
    const [start] = leaderFor('Plan A').querySelector('polyline')?.getAttribute('points')?.split(' ') ?? [];

    expect(leaderFor('Plan A').querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(3);
    expect(start.split(',').map(Number)).toEqual([expect.closeTo(467.957, 2), expect.closeTo(207.374, 2)]);
    expect(px(labelBox('Plan A')?.style.left)).toBeCloseTo(524.32, 1);
    expect(px(labelBox('Plan A')?.style.top)).toBeCloseTo(212.89, 1);
    expect(labelBox('Plan A')?.className).toContain('items-start text-left');

    // Plan X is centered at 9 o'clock: one straight 50px line, its label reads leftward from 4px before the end.
    expect(leaderFor('Plan X').querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(2);
    expect(px(labelBox('Plan X')?.style.right)).toBeCloseTo(CHART_WIDTH - 266 + 4, 1);
    expect(px(labelBox('Plan X')?.style.top)).toBeCloseTo(140, 1);
    expect(labelBox('Plan X')?.className).toContain('items-end text-right');

    expect(px(labelBox('Plan Z')?.style.right)).toBeCloseTo(462.32, 1);
    expect(px(labelBox('Plan Z')?.style.top)).toBeCloseTo(22.07, 1);
    expect(px(labelBox('Plan B')?.style.top)).toBeCloseTo(257.93, 1);
  });

  it('keeps the labels inside a short chart', () => {
    chartHeight = 200;
    render(<DonutChartWidget data={data} />);

    // Plan Z (252°) would poke above the chart: clamped 4px below the top edge.
    expect(labelBox('Plan Z')?.style.top).toBe('4px');
    // Plan B (108°) is clamped to 36 + 4px above the bottom edge.
    expect(px(labelBox('Plan B')?.style.top)).toBeCloseTo(200 - 40, 1);
  });

  it('separates sections with a constant 2px gap and draws a lone section as a full ring', () => {
    const { container, rerender } = render(<DonutChartWidget data={data} />);
    const firstPath = screen.getAllByTestId('donut-chart-section')[0].getAttribute('d') ?? '';
    const [, innerX, innerY, outerX, outerY] =
      /^M([\d.]+),([\d.]+) L([\d.]+),([\d.]+)/.exec(firstPath)?.map(Number) ?? [];

    // The first edge runs parallel to the 3 o'clock ray, 1px (half the gap) below it, across the 13px ring.
    expect(innerY).toBeCloseTo(159, 6);
    expect(outerY).toBeCloseTo(159, 6);
    expect(innerX).toBeCloseTo(400 + Math.sqrt(70 ** 2 - 1), 6);
    expect(outerX).toBeCloseTo(400 + Math.sqrt(83 ** 2 - 1), 6);

    rerender(<DonutChartWidget data={[{ label: 'Only', value: 3, rowIds: ['row-1'] }]} />);
    expect(screen.getByTestId('donut-chart-section').getAttribute('d')).toBe(
      'M483,158 A83,83 0 1 1 317,158 A83,83 0 1 1 483,158 M470,158 A70,70 0 1 0 330,158 A70,70 0 1 0 470,158 Z'
    );

    // Hovering thickens the ring by half: 13 → 19.5px.
    fireEvent.mouseEnter(sectors(container)[0]);
    expect(screen.getByTestId('donut-chart-section').getAttribute('d')).toMatch(/^M489.5,158 A89.5,89.5 /);
  });

  it('keeps only the part of a thin section that clears the gaps, like fl_chart', () => {
    const { rerender } = render(
      <DonutChartWidget
        data={[
          { label: 'Big', value: 240, rowIds: ['row-1'] },
          { label: 'Thin', value: 1, rowIds: ['row-2'] },
        ]}
      />
    );
    const thinPath = screen.getAllByTestId('donut-chart-section')[1].getAttribute('d') ?? '';
    const [, apexX, apexY] = /^M([\d.]+),([\d.]+)/.exec(thinPath)?.map(Number) ?? [];

    // Its inset edges meet ~77px from the center, between the hole and the rim: no inner arc is left.
    expect(thinPath.match(/A/g)).toHaveLength(1);
    expect(Math.hypot(apexX - 400, apexY - 158)).toBeCloseTo(1 / Math.sin(Math.PI / 241), 3);

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

  it('thickens the hovered section, dims every other one and shows the tooltip beside its label', () => {
    const { container } = render(<DonutChartWidget data={data} />);

    fireEvent.mouseEnter(sectors(container)[1]);

    expect(fillOpacities()).toEqual(['0.4', '1', '0.4', '0.4', '0.4']);
    expect(screen.getAllByTestId('donut-chart-section')[1].getAttribute('d')).toMatch(/A89.5,89.5 /);
    // Dimmed sections take their leader line and label with them.
    expect(leaderOpacities()).toEqual({
      'Plan A': '0.4',
      'Plan B': '1',
      'Plan X': '0.4',
      'Plan Z': '0.4',
      PlanY: '0.4',
    });

    const tooltip = screen.getByTestId('chart-tooltip');

    expect(tooltip.textContent).toContain('Plan B');
    expect(tooltip.textContent).toContain('1');
    // Left-half anchor x = lineEndX - 96 + 8 - 90 = 163.68; y = lineEndY = 275.9, clamped to 316 - 88.
    expect(px(tooltip.parentElement?.style.left)).toBeCloseTo(73.68, 1);
    expect(tooltip.parentElement?.style.top).toBe(`${CHART_HEIGHT - 88}px`);

    // The hovered leader is drawn last, above the other labels.
    const leaders = screen.getAllByTestId('donut-chart-leader');

    expect(leaders[leaders.length - 1].textContent).toContain('Plan B');

    fireEvent.mouseLeave(sectors(container)[1]);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    expect(fillOpacities()).toEqual(Array(5).fill('1'));
    expect(Object.values(leaderOpacities())).toEqual(Array(5).fill('1'));
  });

  it('uses the section label tone for the tooltip dot', () => {
    const { container } = render(<DonutChartWidget data={data} />);

    fireEvent.mouseEnter(sectors(container)[0]);

    const dot = within(screen.getByTestId('chart-tooltip')).getByTestId('chart-indicator-dot');

    expect(dot.querySelector<HTMLElement>(':scope > span > span')?.style.backgroundColor).toBe(rgb(TEXTS[0]));
  });

  it('lights a section from its legend entry, with the ring taking over while it is hovered', () => {
    const { container } = render(<DonutChartWidget data={data} />);
    const legendItems = screen.getAllByTestId('donut-chart-legend-item');

    expect(legendLabelClasses().every((className) => className?.includes('text-text-primary'))).toBe(true);

    fireEvent.mouseEnter(legendItems[2]);
    expect(fillOpacities()).toEqual(['0.4', '0.4', '1', '0.4', '0.4']);
    expect(screen.getByTestId('chart-tooltip').textContent).toContain('Plan X');
    // Every swatch keeps its color; only the other labels step back.
    expect(legendLabelClasses().map((className) => className?.includes('text-text-tertiary'))).toEqual([
      true,
      true,
      false,
      true,
      true,
    ]);

    // Crossing onto the ring: its hover wins, and leaving it hands back to the legend.
    fireEvent.mouseEnter(sectors(container)[0]);
    expect(fillOpacities()).toEqual(['1', '0.4', '0.4', '0.4', '0.4']);
    expect(screen.getByTestId('chart-tooltip').textContent).toContain('Plan A');
    fireEvent.mouseLeave(sectors(container)[0]);
    expect(screen.getByTestId('chart-tooltip').textContent).toContain('Plan X');

    fireEvent.mouseLeave(legendItems[2]);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    expect(fillOpacities()).toEqual(Array(5).fill('1'));
    expect(legendLabelClasses().every((className) => className?.includes('text-text-primary'))).toBe(true);
  });

  it('drills down from a section or a legend item with the resolved color', () => {
    const onSliceClick = jest.fn();
    const { container } = render(<DonutChartWidget data={data} onSliceClick={onSliceClick} />);

    fireEvent.mouseEnter(sectors(container)[1]);
    fireEvent.click(sectors(container)[1]);
    expect(onSliceClick).toHaveBeenLastCalledWith({ ...validData[1], color: FILLS[1] });
    // Desktop clears the hover once a section is tapped.
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();

    fireEvent.click(screen.getAllByTestId('donut-chart-legend-item')[0]);
    expect(onSliceClick).toHaveBeenLastCalledWith({ ...validData[0], color: FILLS[0] });
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
