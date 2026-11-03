import { fireEvent, render, screen } from '@testing-library/react';

import { ChartGroupStyleControl } from '@/components/database/chart/settings/ChartGroupStyleControl';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const pressed = () =>
  ['stacked', 'grouped', 'percent'].map((style) =>
    screen.getByTestId(`chart-group-style-${style}`).getAttribute('aria-pressed')
  );

describe('ChartGroupStyleControl', () => {
  it('offers Stacked, Grouped and Percent in a radio group with the stored style pressed', () => {
    render(<ChartGroupStyleControl label='Group style' onChange={jest.fn()} value='stacked' />);
    const group = screen.getByTestId('chart-group-style');

    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(Array.from(group.querySelectorAll('button')).map((button) => button.textContent)).toEqual([
      'Stacked',
      'Grouped',
      'Percent',
    ]);
    expect(pressed()).toEqual(['true', 'false', 'false']);
    expect(screen.getByTestId('chart-settings-group-style').getAttribute('data-row-id')).toBe('y_group_style');
  });

  it('writes only a change of style', () => {
    const onChange = jest.fn();

    render(<ChartGroupStyleControl label='Group style' onChange={onChange} value='grouped' />);
    fireEvent.click(screen.getByTestId('chart-group-style-grouped'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('chart-group-style-percent'));
    expect(onChange).toHaveBeenCalledWith('percent');
  });

  it('moves the selection with the arrow keys, wrapping at the ends', () => {
    const onChange = jest.fn();

    render(<ChartGroupStyleControl label='Group style' onChange={onChange} value='stacked' />);
    const stacked = screen.getByTestId('chart-group-style-stacked');

    expect(stacked.tabIndex).toBe(0);
    expect(screen.getByTestId('chart-group-style-grouped').tabIndex).toBe(-1);
    fireEvent.keyDown(stacked, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('grouped');
    expect(document.activeElement).toBe(screen.getByTestId('chart-group-style-grouped'));
    fireEvent.keyDown(stacked, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('percent');
  });
});
