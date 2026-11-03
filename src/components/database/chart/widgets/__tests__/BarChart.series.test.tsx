/**
 * Bars with a Group by (WP12 §2.3, §2.6, §2.8, §2.10): stacked, grouped and
 * percent bars over the `series.json` "content" dataset, their segments,
 * labels, legend, tooltip, drill-down payloads and the truncation caption.
 */
import { act, screen } from '@testing-library/react';

import { ChartGroupStyle } from '@/application/database-yjs/chart-extended-settings';
import { ChartAggregationType, ChartSeriesData, ChartType } from '@/application/database-yjs/chart.type';
import { SelectOptionColor } from '@/application/database-yjs/fields';
import { buildChartSeries, groupedBarWidth } from '@/components/database/chart/hooks/chartSeries';
import BarChartWidget from '@/components/database/chart/widgets/BarChart';
import HorizontalBarChartWidget from '@/components/database/chart/widgets/HorizontalBarChart';

import { firePointer, hoverCategory, installChartEnvironment, renderChart, texts } from './chartTestUtils';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const COUNT = { aggregation: ChartAggregationType.Count, yField: null };
/** The stored group style comes from the chart settings, like `ChartProvider` passes it. */
const styled = (groupStyle: ChartGroupStyle) => ({ ...COUNT, style: { groupStyle } });

/** The WP12 "content" dataset: Channel on X, Audience as the Group by. */
function contentData(groupStyle: ChartGroupStyle, chartType = ChartType.Bar, aggregation = 0): ChartSeriesData {
  const reach: Record<string, number> = { r1: 100, r2: 50, r3: 30, r4: 200, r5: 10, r6: 40, r7: 5, r8: 7 };
  const rows: Array<[string, string[], string[]]> = [
    ['r1', ['blog'], ['biz']],
    ['r2', ['blog'], ['con']],
    ['r3', ['blog'], ['con']],
    ['r4', ['video'], ['smb']],
    ['r5', ['video'], ['biz']],
    ['r6', ['podcast'], ['con']],
    ['r7', ['podcast'], []],
    ['r8', [], ['biz']],
  ];

  return buildChartSeries({
    chartType,
    aggregation,
    groupStyle,
    cumulative: false,
    showEmptyValues: true,
    hiddenGroups: [],
    xSort: 'auto',
    colorTheme: 'auto',
    xField: {
      kind: 'select',
      groups: [
        { key: 'blog', label: 'Blog', optionColor: SelectOptionColor.OptionColor1 },
        { key: 'video', label: 'Video', optionColor: SelectOptionColor.OptionColor2 },
        { key: 'podcast', label: 'Podcast', optionColor: SelectOptionColor.OptionColor5 },
        { key: '__empty__', label: 'No Channel', isEmpty: true },
      ],
    },
    subField: {
      kind: 'select',
      groups: [
        { key: 'biz', label: 'Business', optionColor: SelectOptionColor.OptionColor4 },
        { key: 'con', label: 'Consumers', optionColor: SelectOptionColor.OptionColor9 },
        { key: 'smb', label: 'SMB', optionColor: SelectOptionColor.OptionColor7 },
        { key: '__empty__', label: 'No Audience', isEmpty: true },
      ],
    },
    rows: rows.map(([id, x, sub]) => ({
      id,
      x,
      sub,
      y: { empty: false, tokens: [String(reach[id])], number: reach[id] },
    })),
  });
}

function segments(container: HTMLElement, category?: string) {
  const all = Array.from(container.querySelectorAll<SVGPathElement>('[data-testid="chart-bar-segment"]'));

  return category ? all.filter((segment) => segment.getAttribute('data-category') === category) : all;
}

function box(segment: Element) {
  const x = Number(segment.getAttribute('x'));
  const y = Number(segment.getAttribute('y'));
  const width = Number(segment.getAttribute('width'));
  const height = Number(segment.getAttribute('height'));

  return {
    left: Math.min(x, x + width),
    top: Math.min(y, y + height),
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

describe('BarChartWidget with a Group by', () => {
  installChartEnvironment();

  it('stacks one segment per group with series 0 at the value end and card-coloured strokes', () => {
    const { container } = renderChart(<BarChartWidget data={contentData('stacked')} fill />, COUNT);
    const root = screen.getByTestId('bar-chart-widget');

    expect(root.getAttribute('data-group-style')).toBe('stacked');
    expect(root.getAttribute('data-series-count')).toBe('4');
    // 7 non-zero cells; zero cells draw nothing.
    expect(segments(container)).toHaveLength(7);
    segments(container).forEach((segment) => {
      expect(segment.getAttribute('stroke')).toBe('var(--dash-card-bg)');
      expect(segment.getAttribute('stroke-width')).toBe('1');
      expect(segment.getAttribute('data-parity-id')).toBe('dash-chart-bar-segment');
    });
    const [business, consumers] = ['Business', 'Consumers'].map(
      (series) =>
        segments(container, 'Blog').find((segment) => segment.getAttribute('data-series') === series) as SVGPathElement
    );

    expect(business.getAttribute('data-value')).toBe('1');
    expect(consumers.getAttribute('data-value')).toBe('2');
    // Series 0 sits on top of the stack, touching the segment below it.
    expect(box(business).top).toBeLessThan(box(consumers).top);
    expect(Math.abs(box(business).top + box(business).height - box(consumers).top)).toBeLessThanOrEqual(0.5);
    expect(box(business).left).toBeCloseTo(box(consumers).left, 5);
    // Only the outermost segment rounds its value end.
    expect(business.getAttribute('d')).toContain('A');
    expect(consumers.getAttribute('d')).not.toContain('A');
    expect(texts(container, '[data-testid="chart-data-label"]')).toEqual(['3', '2', '2', '1']);
  });

  it('lists the groups in the legend and every group of the hovered bar in the tooltip', () => {
    const { container } = renderChart(
      <BarChartWidget data={contentData('stacked')} fill onItemClick={jest.fn()} />,
      COUNT
    );

    expect(screen.getAllByTestId('chart-legend-item').map((item) => item.getAttribute('data-series-key'))).toEqual([
      'biz',
      'con',
      'smb',
      '__empty__',
    ]);
    act(() => hoverCategory(container, 1));
    expect(screen.getByTestId('chart-tooltip-title').textContent).toBe('Video');
    expect(
      screen.getAllByTestId('chart-tooltip-row').map((row) => `${row.getAttribute('data-series')} ${row.textContent}`)
    ).toEqual(['biz Business1', 'smb SMB1']);
    expect(screen.getByTestId('chart-tooltip-footer').textContent).toBe('Click to view data');
  });

  it('stands grouped bars side by side, 2px apart, with a label on each non-zero bar', () => {
    const data = contentData('grouped', ChartType.Bar, ChartAggregationType.Sum);
    const { container } = renderChart(<BarChartWidget data={data} fill />, styled('grouped'));
    const blog = segments(container, 'Blog').map(box);

    expect(screen.getByTestId('bar-chart-widget').getAttribute('data-group-style')).toBe('grouped');
    expect(blog).toHaveLength(2);
    expect(blog[1].left - (blog[0].left + blog[0].width)).toBeCloseTo(2, 5);
    const anchor = container.querySelector('[data-testid="chart-category-anchor"]') as SVGRectElement;

    expect(blog[0].width).toBeCloseTo(groupedBarWidth(Number(anchor.getAttribute('width')), 4), 5);
    segments(container).forEach((segment) => expect(segment.getAttribute('stroke')).toBeNull());
    // Each bar's label, read along the category axis (Recharts draws them per series).
    const labels = Array.from(container.querySelectorAll('[data-testid="chart-data-label"]')).sort(
      (a, b) => Number(a.getAttribute('x')) - Number(b.getAttribute('x'))
    );

    expect(
      labels.map((label) => [label.getAttribute('data-category'), label.getAttribute('data-series'), label.textContent])
    ).toEqual([
      ['Blog', 'Business', '100'],
      ['Blog', 'Consumers', '80'],
      ['Video', 'Business', '10'],
      ['Video', 'SMB', '200'],
      ['Podcast', 'Consumers', '40'],
      ['Podcast', 'No Audience', '5'],
      ['No Channel', 'Business', '7'],
    ]);
  });

  it('fills the axis with percent bars, draws no labels and shows each share in the tooltip', () => {
    const { container } = renderChart(
      <BarChartWidget data={contentData('percent')} fill onItemClick={jest.fn()} />,
      styled('percent')
    );

    expect(screen.getByTestId('bar-chart-widget').getAttribute('data-group-style')).toBe('percent');
    expect(container.querySelector('[data-testid="chart-data-label"]')).toBeNull();
    expect(texts(container, '[data-testid="chart-value-tick"]')).toEqual(['0%', '25%', '50%', '75%', '100%']);
    act(() => hoverCategory(container, 0));
    expect(screen.getAllByTestId('chart-tooltip-row').map((row) => row.textContent)).toEqual([
      'Business33.3% (1)',
      'Consumers66.7% (2)',
    ]);
  });

  it('opens the clicked segment with its group, and the category band without one', () => {
    const onItemClick = jest.fn();
    const { container } = renderChart(
      <BarChartWidget data={contentData('stacked')} fill onItemClick={onItemClick} />,
      COUNT
    );
    const consumers = segments(container, 'Blog').find((segment) => segment.getAttribute('data-series') === 'Consumers');

    act(() => {
      consumers?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenLastCalledWith(
      expect.objectContaining({
        label: 'Blog',
        categoryKey: 'blog',
        seriesKey: 'con',
        seriesLabel: 'Consumers',
        value: 2,
        rowIds: ['r2', 'r3'],
      })
    );

    act(() => hoverCategory(container, 1));
    const anchor = container.querySelectorAll('[data-testid="chart-category-anchor"]')[1] as SVGRectElement;

    act(() => {
      firePointer(
        container.querySelector('.recharts-wrapper') as HTMLElement,
        'click',
        Number(anchor.getAttribute('x')) + 3,
        200
      );
    });
    expect(onItemClick).toHaveBeenCalledTimes(2);
    const band = onItemClick.mock.calls[1][0];

    expect(band).toEqual(
      expect.objectContaining({ label: 'Video', categoryKey: 'video', value: 2, rowIds: ['r4', 'r5'] })
    );
    expect(band.seriesKey).toBeUndefined();
  });

  it('says how many groups it shows when a cap cut some', () => {
    const data = contentData('stacked');

    renderChart(<BarChartWidget data={{ ...data, truncated: { categories: false, series: true } }} fill />, COUNT);
    expect(screen.getByTestId('chart-truncation-caption').textContent).toBe('Only showing the first 50 groups');
  });

  it('grows horizontal stacks to the right with series 0 at the right end', () => {
    const { container } = renderChart(
      <HorizontalBarChartWidget data={contentData('stacked', ChartType.HorizontalBar)} fill />,
      COUNT
    );
    const [business, consumers] = ['Business', 'Consumers'].map((series) =>
      box(segments(container, 'Blog').find((segment) => segment.getAttribute('data-series') === series) as Element)
    );

    expect(screen.getByTestId('horizontal-bar-chart-widget').getAttribute('data-group-style')).toBe('stacked');
    expect(business.left).toBeGreaterThan(consumers.left);
    expect(Math.abs(consumers.left + consumers.width - business.left)).toBeLessThanOrEqual(0.5);
  });
});
