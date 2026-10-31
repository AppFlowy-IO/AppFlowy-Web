import { act, screen } from '@testing-library/react';

import { ChartDataItem } from '@/application/database-yjs/chart.type';
import { NumberFormat } from '@/application/database-yjs/fields';
import HorizontalBarChartWidget from '@/components/database/chart/widgets/HorizontalBarChart';

import { hoverCategory, installChartEnvironment, renderChart, texts, seriesDataOf } from './chartTestUtils';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const MARGINS: ChartDataItem[] = [
  { key: 'lead', label: 'Lead', value: 800, rowIds: ['r1'], color: '#5E9FE8' },
  { key: 'lost', label: 'Lost', value: -1500, rowIds: ['r2'], color: '#DF84A8' },
  { key: 'proposal', label: 'Proposal', value: 1200, rowIds: ['r3'], color: '#EAC26B' },
  { key: 'won', label: 'Won', value: 6.5, rowIds: ['r4'], color: '#72BC8F' },
];

const NUMBER_FIELD = { type: 'number' as const, numberFormat: NumberFormat.Num };

describe('HorizontalBarChartWidget', () => {
  installChartEnvironment();

  it('fills a widget card without an inner scroll', () => {
    renderChart(<HorizontalBarChartWidget data={seriesDataOf(MARGINS)} fill />, { yField: NUMBER_FIELD });

    const frame = screen.getByTestId('horizontal-bar-chart-widget');

    expect(frame.getAttribute('data-fill')).toBe('true');
    expect(frame.querySelector('.overflow-y-auto')).toBeNull();
    expect(frame.style.padding).toBe('12px 16px 12px 12px');
  });

  it('keeps the scrolling height on a standalone page', () => {
    renderChart(<HorizontalBarChartWidget data={seriesDataOf(MARGINS)} />, { yField: NUMBER_FIELD });

    const frame = screen.getByTestId('horizontal-bar-chart-widget');

    expect(frame.style.height).toBe('300px');
    expect(screen.getByTestId('chart-plot-area').className).toContain('overflow-y-auto');
  });

  it('draws the values along the bottom and a negative bar left of the zero line', () => {
    const { container } = renderChart(<HorizontalBarChartWidget data={seriesDataOf(MARGINS)} fill />, { yField: NUMBER_FIELD });

    expect(texts(container, '.recharts-xAxis [data-testid="chart-value-tick"]')).toEqual(['-2K', '-1K', '0', '1K', '2K']);
    const zero = container.querySelector('.recharts-reference-line line') as SVGLineElement;
    const zeroX = Number(zero.getAttribute('x1'));
    const paths = Array.from(container.querySelectorAll('.recharts-bar-rectangle path'));
    const lost = paths[1];
    const lostX = Number(lost.getAttribute('x'));
    const lostWidth = Number(lost.getAttribute('width'));

    expect(Math.min(lostX, lostX + lostWidth)).toBeLessThan(zeroX);
    expect(Math.max(lostX, lostX + lostWidth)).toBeLessThanOrEqual(zeroX + 0.5);
    // The vertical dotted grid runs at the value ticks.
    expect(container.querySelector('.recharts-cartesian-grid-vertical line')?.getAttribute('stroke-dasharray')).toBe('2 3');
  });

  it('labels each bar end, left of a negative one', () => {
    const { container } = renderChart(<HorizontalBarChartWidget data={seriesDataOf(MARGINS)} fill />, { yField: NUMBER_FIELD });
    const labels = Array.from(container.querySelectorAll('[data-testid="chart-data-label"]'));

    expect(labels.map((label) => [label.getAttribute('data-label'), label.textContent])).toEqual([
      ['Lead', '800'],
      ['Lost', '-1.5K'],
      ['Proposal', '1.2K'],
      ['Won', '6.5'],
    ]);
    expect(labels[1].getAttribute('text-anchor')).toBe('end');
    expect(labels[0].getAttribute('text-anchor')).toBe('start');
  });

  it('truncates long category labels with an ellipsis and keeps the full name in a title', () => {
    const { container } = renderChart(
      <HorizontalBarChartWidget
        data={seriesDataOf([
          { key: 'a', label: 'A category name far longer than the label column allows', value: 3, rowIds: [] },
          { key: 'b', label: 'Short', value: 1, rowIds: [] },
        ])}
        fill
      />,
      { yField: NUMBER_FIELD }
    );
    const label = container.querySelector('[data-testid="chart-category-label"]') as SVGTextElement;

    expect(label.textContent?.endsWith('…')).toBe(true);
    expect(label.querySelector('title')?.textContent).toBe('A category name far longer than the label column allows');
    expect(label.getAttribute('text-anchor')).toBe('end');
  });

  it('shows the tooltip of the hovered row', () => {
    const { container } = renderChart(<HorizontalBarChartWidget data={seriesDataOf(MARGINS)} fill />, { yField: NUMBER_FIELD });
    const anchor = container.querySelectorAll('[data-testid="chart-category-anchor"]')[1] as SVGRectElement;

    act(() =>
      hoverCategory(container, 1, Number(anchor.getAttribute('y')) + Number(anchor.getAttribute('height')) / 2)
    );
    expect(screen.getByTestId('chart-tooltip-name').textContent).toBe('Lost');
    expect(screen.getByTestId('chart-tooltip-value').textContent).toBe('-1,500');
  });
});
