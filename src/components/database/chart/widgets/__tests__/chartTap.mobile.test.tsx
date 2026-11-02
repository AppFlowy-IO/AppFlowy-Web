import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactElement } from 'react';

import { ChartAggregationType, ChartDataItem, ChartSeriesData } from '@/application/database-yjs/chart.type';
import { ChartContextValue } from '@/components/database/chart/useChartContext';
import BarChartWidget from '@/components/database/chart/widgets/BarChart';
import DonutChartWidget from '@/components/database/chart/widgets/DonutChart';
import LineChartWidget from '@/components/database/chart/widgets/LineChart';

import {
  chartContextStub,
  ChartStubProvider,
  firePointer,
  hoverCategory,
  installChartEnvironment,
  seriesDataOf,
} from './chartTestUtils';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const OWNERS: ChartDataItem[] = [
  { key: 'alice', label: 'Alice', value: 48500, rowIds: ['r1'], color: '#BF8EDA' },
  { key: 'bob', label: 'Bob', value: 1300000, rowIds: ['r2', 'r3'], color: '#DE9255' },
  { key: 'carol', label: 'Carol', value: 690000, rowIds: ['r4'], color: '#4FB9C9' },
];

const COUNT = { aggregation: ChartAggregationType.Count, yField: null };

/** A mobile context (WP14 §1.4.6): the chart context the provider builds below 768px. */
function mobileContext(stub: Parameters<typeof chartContextStub>[0] = {}): ChartContextValue {
  return { ...chartContextStub(stub), mobile: true };
}

function renderMobile(element: ReactElement, stub: Parameters<typeof chartContextStub>[0] = {}) {
  return render(<ChartStubProvider value={mobileContext(stub)}>{element}</ChartStubProvider>);
}

/** A tap (click) in the band of category `index`, as Recharts sees it. */
function tapCategory(container: HTMLElement, index: number, offset = 5) {
  const anchor = container.querySelectorAll('[data-testid="chart-category-anchor"]')[index] as SVGRectElement;

  act(() => {
    firePointer(
      container.querySelector('.recharts-wrapper') as HTMLElement,
      'click',
      Number(anchor.getAttribute('x')) + offset,
      200
    );
  });
}

const tooltip = () => screen.queryByTestId('chart-tooltip');

describe('chart taps in a mobile context (resolveChartTap)', () => {
  installChartEnvironment();

  it('shows the tapped bar tooltip with "Tap again to view data", then drills on a second tap', () => {
    const onItemClick = jest.fn();
    const { container } = renderMobile(<BarChartWidget data={seriesDataOf(OWNERS)} onItemClick={onItemClick} />);

    tapCategory(container, 1);
    expect(onItemClick).not.toHaveBeenCalled();
    expect(tooltip()?.getAttribute('data-category')).toBe('Bob');
    expect(tooltip()?.getAttribute('data-mobile')).toBe('true');
    expect(screen.getByTestId('chart-tooltip-name').textContent).toBe('Bob');
    expect(screen.getByTestId('chart-tooltip-footer').textContent).toBe('Tap again to view data');
    expect(screen.queryByText('Click to view data')).toBeNull();
    // The band marks the tapped category.
    expect(container.querySelector('.recharts-tooltip-cursor')).not.toBeNull();

    tapCategory(container, 1, 9);
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith({ ...OWNERS[1], categoryKey: 'bob', isEmptyCategory: false });
    // Drilling drops the selection.
    expect(tooltip()).toBeNull();
  });

  it('moves the selection to another tapped bar without drilling', () => {
    const onItemClick = jest.fn();
    const { container } = renderMobile(<BarChartWidget data={seriesDataOf(OWNERS)} onItemClick={onItemClick} />);

    tapCategory(container, 1);
    tapCategory(container, 2);
    expect(onItemClick).not.toHaveBeenCalled();
    expect(tooltip()?.getAttribute('data-category')).toBe('Carol');

    tapCategory(container, 2);
    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ categoryKey: 'carol', label: 'Carol' }));
  });

  it('keeps the tooltip on the tapped category: the pointer neither shows, moves nor ends it', () => {
    const { container } = renderMobile(<BarChartWidget data={seriesDataOf(OWNERS)} onItemClick={jest.fn()} />);

    act(() => hoverCategory(container, 0));
    expect(tooltip()).toBeNull();

    tapCategory(container, 1);
    act(() => hoverCategory(container, 2));
    expect(tooltip()?.getAttribute('data-category')).toBe('Bob');

    act(() => {
      fireEvent.mouseLeave(screen.getByTestId('bar-chart-widget'));
      fireEvent.pointerLeave(screen.getByTestId('bar-chart-widget'));
    });
    expect(tooltip()?.getAttribute('data-category')).toBe('Bob');
  });

  it('clears the selection on a tap outside every mark and on a press outside the chart', () => {
    const onItemClick = jest.fn();
    const { container } = renderMobile(<BarChartWidget data={seriesDataOf(OWNERS)} onItemClick={onItemClick} />);

    tapCategory(container, 1);
    expect(tooltip()).not.toBeNull();
    // A tap in the frame that no mark answers (the padding, an axis, the legend).
    act(() => {
      fireEvent.click(screen.getByTestId('bar-chart-widget'));
    });
    expect(tooltip()).toBeNull();
    expect(onItemClick).not.toHaveBeenCalled();

    // After a clear the next tap selects again rather than drilling.
    tapCategory(container, 1);
    expect(onItemClick).not.toHaveBeenCalled();
    expect(tooltip()).not.toBeNull();

    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(tooltip()).toBeNull();
    tapCategory(container, 1);
    expect(onItemClick).not.toHaveBeenCalled();
  });

  it('drops the selection when the charted data changes', () => {
    const value = mobileContext();
    const { container, rerender } = render(
      <ChartStubProvider value={value}>
        <BarChartWidget data={seriesDataOf(OWNERS)} onItemClick={jest.fn()} />
      </ChartStubProvider>
    );

    tapCategory(container, 1);
    expect(tooltip()).not.toBeNull();
    rerender(
      <ChartStubProvider value={value}>
        <BarChartWidget data={seriesDataOf(OWNERS.map((item) => ({ ...item, value: item.value + 1 })))} onItemClick={jest.fn()} />
      </ChartStubProvider>
    );
    expect(tooltip()).toBeNull();
  });

  it('selects a category from any of its segments and drills into the tapped segment', () => {
    const data: ChartSeriesData = {
      categories: [
        { key: 'blog', label: 'Blog', isEmpty: false, color: null, rowIds: ['r1', 'r2', 'r3'] },
        { key: 'video', label: 'Video', isEmpty: false, color: null, rowIds: ['r4'] },
      ],
      series: [
        {
          key: 'biz',
          label: 'Business',
          color: { kind: 'hex', hex: '#5E9FE8', alpha: 1 },
          isEmpty: false,
          values: [1, 1],
          rowIds: [['r1'], ['r4']],
        },
        {
          key: 'con',
          label: 'Consumers',
          color: { kind: 'hex', hex: '#DE9255', alpha: 1 },
          isEmpty: false,
          values: [2, 0],
          rowIds: [['r2', 'r3'], []],
        },
      ],
      truncated: { categories: false, series: false },
    };
    const onItemClick = jest.fn();
    const { container } = renderMobile(<BarChartWidget data={data} fill onItemClick={onItemClick} />, COUNT);
    const segment = (series: string) =>
      Array.from(container.querySelectorAll('[data-testid="chart-bar-segment"]')).find(
        (element) => element.getAttribute('data-category') === 'Blog' && element.getAttribute('data-series') === series
      );

    act(() => {
      segment('Business')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onItemClick).not.toHaveBeenCalled();
    // The tooltip of a grouped chart describes the whole category.
    expect(tooltip()?.getAttribute('data-category')).toBe('Blog');
    expect(screen.getByTestId('chart-tooltip-title').textContent).toBe('Blog');
    expect(screen.getByTestId('chart-tooltip-footer').textContent).toBe('Tap again to view data');

    act(() => {
      segment('Consumers')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(
      expect.objectContaining({ categoryKey: 'blog', seriesKey: 'con', seriesLabel: 'Consumers', rowIds: ['r2', 'r3'] })
    );
    expect(tooltip()).toBeNull();
  });

  it('taps a donut slice twice to drill', () => {
    const onItemClick = jest.fn();
    const { container } = renderMobile(<DonutChartWidget data={seriesDataOf(OWNERS)} fill onItemClick={onItemClick} />, COUNT);
    const sector = (index: number) => container.querySelectorAll('.recharts-pie-sector')[index];

    // Hovering a slice shows nothing in a mobile context.
    act(() => {
      fireEvent.mouseEnter(sector(1), { clientX: 100, clientY: 100 });
    });
    expect(tooltip()).toBeNull();

    act(() => {
      fireEvent.click(sector(1), { clientX: 100, clientY: 100 });
    });
    expect(onItemClick).not.toHaveBeenCalled();
    expect(tooltip()?.getAttribute('data-category')).toBe('Bob');
    expect(screen.getByTestId('chart-tooltip-footer').textContent).toBe('Tap again to view data');
    act(() => {
      fireEvent.mouseLeave(sector(1));
    });
    expect(tooltip()?.getAttribute('data-category')).toBe('Bob');

    act(() => {
      fireEvent.click(sector(1), { clientX: 100, clientY: 100 });
    });
    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ categoryKey: 'bob', label: 'Bob' }));
    expect(tooltip()).toBeNull();
  });

  it('taps a line category twice to drill', () => {
    const onItemClick = jest.fn();
    const { container } = renderMobile(
      <LineChartWidget data={seriesDataOf(OWNERS)} onItemClick={onItemClick} />,
      { seriesLabel: 'Sum of Amount' }
    );

    tapCategory(container, 0, 3);
    expect(onItemClick).not.toHaveBeenCalled();
    expect(tooltip()?.getAttribute('data-category')).toBe('Alice');

    tapCategory(container, 0, 3);
    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ categoryKey: 'alice' }));
  });

  it('still drills at once on a desktop click', () => {
    const onItemClick = jest.fn();
    const { container } = render(
      <ChartStubProvider value={chartContextStub()}>
        <BarChartWidget data={seriesDataOf(OWNERS)} onItemClick={onItemClick} />
      </ChartStubProvider>
    );

    tapCategory(container, 1);
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(tooltip()).toBeNull();
  });
});
