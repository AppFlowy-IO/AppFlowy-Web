import { fireEvent, render, screen } from '@testing-library/react';

import { ChartErrorState, ChartLoadingState, ChartNoDataState } from '@/components/database/chart/ChartStates';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('ChartStates', () => {
  it('shows the skeleton glyph and "Preparing your chart" while loading', () => {
    render(<ChartLoadingState fill />);

    const skeleton = screen.getByTestId('chart-loading-skeleton');

    expect(Array.from(skeleton.children).map((bar) => (bar as HTMLElement).style.height)).toEqual([
      '18px',
      '30px',
      '24px',
      '36px',
      '14px',
    ]);
    expect(screen.getByText('Preparing your chart')).toBeTruthy();
    expect(screen.getByTestId('chart-loading').querySelector('[data-parity-id="dash-chart-loading"]')).not.toBeNull();
  });

  it('says "No data" in the unchanged card', () => {
    render(<ChartNoDataState fill />);

    expect(screen.getByTestId('chart-no-data').textContent).toBe('No data');
    expect(screen.getByText('No data').getAttribute('data-parity-id')).toBe('dash-chart-empty');
    expect(screen.queryByTestId('chart-donut-empty-ring')).toBeNull();
  });

  it('offers Retry when the chart could not load', () => {
    const onRetry = jest.fn();

    render(<ChartErrorState onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load this chart")).toBeTruthy();
    fireEvent.click(screen.getByTestId('chart-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the standalone chart height', () => {
    render(<ChartNoDataState />);

    expect(screen.getByTestId('chart-no-data').style.height).toBe('400px');
  });
});
