import { fireEvent, render, screen } from '@testing-library/react';

import { ChartLegend, ChartLegendItem, layoutChartLegend } from '../ChartLegend';

import { FIXTURE_MEASURE } from './chartTestUtils';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const REGIONS = [
  'North America East',
  'North America West',
  'Central America',
  'South America',
  'Western Europe',
  'Northern Europe',
  'Eastern Europe',
  'Middle East',
  'North Africa',
  'Sub-Saharan Africa',
  'South Asia',
  'Southeast Asia Pacific',
];

const items = (labels: string[]): ChartLegendItem[] =>
  labels.map((label, index) => ({ key: `k${index}`, label, color: '#5E9FE8' }));

function renderLegend(labels: string[], width: number, glyph: 'square' | 'line' = 'square') {
  const legendItems = items(labels);
  const layout = layoutChartLegend(legendItems, glyph, width, FIXTURE_MEASURE.measure12);

  render(<ChartLegend glyph={glyph} items={legendItems} layout={layout} />);
  return layout;
}

const shownLabels = () => screen.getAllByTestId('chart-legend-item').map((item) => item.getAttribute('data-label'));

describe('ChartLegend', () => {
  it('shows every item on one page when two lines are enough', () => {
    const layout = renderLegend(['Alice', 'Bob', 'Carol'], 300);

    expect(shownLabels()).toEqual(['Alice', 'Bob', 'Carol']);
    expect(screen.queryByTestId('chart-legend-pager')).toBeNull();
    expect(screen.getByTestId('chart-legend').style.height).toBe(`${layout.height}px`);
  });

  it('pages by two lines and moves between pages', () => {
    renderLegend(REGIONS, 260);

    expect(shownLabels()).toEqual(REGIONS.slice(0, 4));
    expect(screen.getByTestId('chart-legend-page').textContent).toBe('1/3');
    expect(screen.getByTestId('chart-legend-prev')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('chart-legend-next'));
    expect(screen.getByTestId('chart-legend-page').textContent).toBe('2/3');
    expect(shownLabels()).toEqual(REGIONS.slice(4, 8));
    fireEvent.click(screen.getByTestId('chart-legend-next'));
    expect(screen.getByTestId('chart-legend-next')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('chart-legend-prev'));
    expect(screen.getByTestId('chart-legend-page').textContent).toBe('2/3');
  });

  it('shows one item per page when narrower than 160px', () => {
    renderLegend(['Lead', 'Proposal', 'Won'], 150);

    expect(shownLabels()).toEqual(['Lead']);
    expect(screen.getByTestId('chart-legend-page').textContent).toBe('1/3');
  });

  it('draws 8×8 swatches, or a 12×2 line for a line series', () => {
    renderLegend(['Lead'], 300);
    const swatch = screen.getByTestId('chart-legend-swatch');

    expect([swatch.style.width, swatch.style.height, swatch.style.borderRadius]).toEqual(['8px', '8px', '2px']);
    expect(swatch.getAttribute('data-parity-id')).toBe('dash-chart-legend-swatch');
  });

  it('is display-only', () => {
    renderLegend(['Lead', 'Won'], 300, 'line');

    expect(screen.getByTestId('chart-legend').querySelectorAll('button')).toHaveLength(0);
    const swatch = screen.getByTestId('chart-legend').querySelector('[data-testid="chart-legend-swatch"]') as HTMLElement;

    expect([swatch.style.width, swatch.style.height]).toEqual(['12px', '2px']);
  });
});
