import { render, screen } from '@testing-library/react';

import { ChartTooltip, getChartTooltipPosition } from '@/components/database/chart/widgets/ChartTooltip';

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

describe('ChartTooltip', () => {
  it('sizes to its content so a long category name reads in full, like desktop', () => {
    const label = 'A really long category label that goes on and on';

    render(<ChartTooltip label={label} value={12.9} color='#5B8FF9' />);

    const tooltip = screen.getByTestId('chart-tooltip');

    expect(tooltip.className).toContain('w-max');
    expect(tooltip.className).not.toMatch(/max-w-/);
    expect(tooltip.textContent).toContain(label);
    // Desktop prints `item.value.toInt()`.
    expect(tooltip.textContent).toContain('12');
    expect(tooltip.textContent).not.toContain('12.9');
    expect(tooltip.textContent).toContain('Click to view data');
  });

  it('divides the two rows with the secondary border color, which stays quiet on the inverse surface', () => {
    render(<ChartTooltip label='Plan A' value={1} color='#5B8FF9' />);

    expect(screen.getByTestId('chart-tooltip-divider').className).toContain('bg-border-secondary');
  });
});

describe('getChartTooltipPosition', () => {
  const chartSize = { width: 800, height: 400 };

  it('centers the 180×80 box on the anchor and lifts it by the vertical gap', () => {
    expect(getChartTooltipPosition({ x: 300, y: 200 }, chartSize)).toEqual({ left: 210, top: 140 });
    expect(getChartTooltipPosition({ x: 300, y: 200 }, chartSize, 60)).toEqual({ left: 210, top: 100 });
  });

  it('keeps the box 8px inside the chart', () => {
    expect(getChartTooltipPosition({ x: 0, y: 0 }, chartSize)).toEqual({ left: 8, top: 8 });
    expect(getChartTooltipPosition({ x: 800, y: 400 }, chartSize)).toEqual({ left: 612, top: 312 });
  });
});
