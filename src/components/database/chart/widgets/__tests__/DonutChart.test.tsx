import { act, fireEvent, screen } from '@testing-library/react';

import { ChartAggregationType, ChartDataItem } from '@/application/database-yjs/chart.type';
import DonutChartWidget from '@/components/database/chart/widgets/DonutChart';

import { installChartEnvironment, renderChart, setObservedSize } from './chartTestUtils';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const STAGES: ChartDataItem[] = [
  { key: 'lead', label: 'Lead', value: 3, rowIds: ['a', 'b', 'c'], color: '#5E9FE8' },
  { key: 'lost', label: 'Lost', value: 3, rowIds: ['d', 'e', 'f'], color: '#DF84A8' },
  { key: 'proposal', label: 'Proposal', value: 2, rowIds: ['g', 'h'], color: '#EAC26B' },
  { key: 'won', label: 'Won', value: 4, rowIds: ['i', 'j', 'k', 'l'], color: '#72BC8F' },
];

const OWNERS: ChartDataItem[] = [
  { key: 'alice', label: 'Alice', value: 48500, rowIds: ['a'], color: '#BF8EDA' },
  { key: 'bob', label: 'Bob', value: 1300000, rowIds: ['b'], color: '#DE9255' },
  { key: 'carol', label: 'Carol', value: 690000, rowIds: ['c'], color: '#4FB9C9' },
];

const COUNT = { aggregation: ChartAggregationType.Count, yField: null };

describe('DonutChartWidget', () => {
  installChartEnvironment();

  it('shows the rounded total over its caption', () => {
    renderChart(<DonutChartWidget data={STAGES} fill />, COUNT);

    expect(screen.getByTestId('chart-donut-total').textContent).toBe('12');
    expect(screen.getByTestId('chart-donut-total').getAttribute('data-value')).toBe('12');
    expect(screen.getByTestId('chart-donut-caption').textContent).toBe('Total');
  });

  it('prints a compact currency total', () => {
    renderChart(<DonutChartWidget data={OWNERS} fill />);

    expect(screen.getByTestId('chart-donut-total').textContent).toBe('$2M');
  });

  it('draws positive values only', () => {
    const { container } = renderChart(
      <DonutChartWidget data={[...STAGES, { key: 'refund', label: 'Refund', value: -5, rowIds: ['m'] }]} fill />,
      COUNT
    );

    expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(4);
    expect(screen.getByTestId('chart-donut-total').textContent).toBe('12');
    expect(
      Array.from(container.querySelectorAll('[data-testid="chart-donut-slice-anchor"]')).map((anchor) =>
        anchor.getAttribute('data-label')
      )
    ).toEqual(['Lead', 'Lost', 'Proposal', 'Won']);
  });

  it('shows the empty ring with "No data" when no value is positive', () => {
    renderChart(
      <DonutChartWidget
        data={[
          { key: 'a', label: 'A', value: 0, rowIds: [] },
          { key: 'b', label: 'B', value: -2, rowIds: ['x'] },
        ]}
        fill
      />,
      COUNT
    );

    expect(screen.getByTestId('chart-donut-empty-ring')).toBeTruthy();
    expect(screen.getByTestId('chart-no-data').textContent).toBe('No data');
  });

  it('separates slices with 1px card-color strokes and no padding angle', () => {
    const { container } = renderChart(<DonutChartWidget data={STAGES} fill />, COUNT);
    const sector = container.querySelector('.recharts-pie-sector path') as SVGPathElement;

    expect(sector.getAttribute('stroke')).toBe('var(--dash-card-bg)');
    expect(sector.getAttribute('stroke-width')).toBe('1');
    expect(container.querySelector('[data-parity-id="dash-donut-ring"]')).not.toBeNull();
  });

  it('shows the share in the tooltip', () => {
    const { container } = renderChart(<DonutChartWidget data={STAGES} onSliceClick={jest.fn()} fill />, COUNT);
    const won = container.querySelectorAll('.recharts-pie-sector')[3];

    act(() => {
      fireEvent.mouseEnter(won, { clientX: 100, clientY: 100 });
    });
    expect(screen.getByTestId('chart-tooltip-name').textContent).toBe('Won');
    expect(screen.getByTestId('chart-tooltip-value').textContent).toBe('4 (33.3%)');
    expect(screen.getByText('Click to view data')).toBeTruthy();
  });

  it('labels the slices outside the ring, except a slice under 3%', () => {
    renderChart(<DonutChartWidget data={OWNERS} fill />);

    expect(screen.getAllByTestId('chart-donut-outside-label').map((label) => label.getAttribute('data-label'))).toEqual([
      'Bob',
      'Carol',
    ]);
    expect(screen.getAllByTestId('chart-donut-outside-label')[0].textContent).toBe('Bob $1.3M (63.8%)');
  });

  it('drops the outside labels in a small frame', () => {
    setObservedSize(240, 200);
    renderChart(<DonutChartWidget data={OWNERS} fill />);

    expect(screen.queryByTestId('chart-donut-outside-label')).toBeNull();
    expect(screen.getAllByTestId('chart-donut-slice-anchor')).toHaveLength(3);
  });

  it('pages through a legend that needs more than two lines', () => {
    const regions: ChartDataItem[] = Array.from({ length: 12 }, (_, index) => ({
      key: `r${index}`,
      label: `Region number ${index + 1}`,
      value: index + 1,
      rowIds: [],
      color: '#5E9FE8',
    }));

    setObservedSize(260, 400);
    renderChart(<DonutChartWidget data={regions} fill />, COUNT);

    expect(screen.getByTestId('chart-legend-pager')).toBeTruthy();
    expect(screen.getByTestId('chart-legend-page').textContent).toBe('1/3');
    fireEvent.click(screen.getByTestId('chart-legend-next'));
    expect(screen.getByTestId('chart-legend-page').textContent).toBe('2/3');
  });
});
