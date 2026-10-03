import { render, screen } from '@testing-library/react';

import { ChartTooltip } from '../ChartTooltip';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const ROWS = [{ color: '#DE9255', name: 'Bob', value: '$1,300,000' }];

describe('ChartTooltip', () => {
  it('lists a swatch, the name and the value per row', () => {
    render(<ChartTooltip rows={ROWS} />);

    expect(screen.getByTestId('chart-tooltip').getAttribute('data-parity-id')).toBe('dash-chart-tooltip');
    expect(screen.getByTestId('chart-tooltip-name').textContent).toBe('Bob');
    expect(screen.getByTestId('chart-tooltip-value').textContent).toBe('$1,300,000');
    expect(screen.queryByTestId('chart-tooltip-footer')).toBeNull();
  });

  // CO1: the hairline is the tooltip's own border colour (`color.tooltipBorder`, border-primary),
  // not the lighter border-secondary, and the visual contract measures it by its parity id.
  it('separates the drill-down hint with a 1px divider in the tooltip border colour', () => {
    render(<ChartTooltip rows={ROWS} showDrilldownHint />);

    const tooltip = screen.getByTestId('chart-tooltip');
    const dividers = tooltip.querySelectorAll('[data-parity-id="dash-chart-tooltip__divider"]');

    expect(dividers).toHaveLength(1);
    const classes = Array.from(dividers[0].classList);

    expect(classes).toContain('bg-chart-tooltip-border');
    expect(classes).toContain('h-px');
    expect(classes).not.toContain('bg-border-secondary');
    // The same token draws the tooltip's outline.
    expect(Array.from(tooltip.classList)).toContain('border-chart-tooltip-border');

    const footer = screen.getByTestId('chart-tooltip-footer');

    expect(footer.getAttribute('data-parity-id')).toBe('dash-chart-tooltip__footer');
    expect(footer.textContent).toBe('Click to view data');
    // The divider sits between the rows and the footer.
    expect(dividers[0].nextElementSibling).toBe(footer);
  });

  it('draws no divider without the drill-down hint', () => {
    render(<ChartTooltip rows={ROWS} />);

    expect(document.querySelector('[data-parity-id="dash-chart-tooltip__divider"]')).toBeNull();
  });

  it('shows a group title above the rows', () => {
    render(<ChartTooltip rows={ROWS} title='Q1' />);

    expect(screen.getByTestId('chart-tooltip-title').textContent).toBe('Q1');
  });
});
