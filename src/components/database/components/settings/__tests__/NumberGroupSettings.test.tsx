import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import {
  defaultNumberGroupConfiguration,
  NumberGroupMode,
  type NumberGroupConfiguration,
} from '@/application/database-yjs/number-grouping';
import { NumberGroupSettings } from '@/components/database/components/settings/NumberGroupSettings';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

function SettingsMenu({
  configuration,
  onChange,
}: {
  configuration: NumberGroupConfiguration;
  onChange: (configuration: NumberGroupConfiguration) => void;
}) {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger>Grouping</DropdownMenuTrigger>
      <DropdownMenuContent>
        <NumberGroupSettings configuration={configuration} onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LiveSettingsMenu({
  initial = defaultNumberGroupConfiguration(NumberGroupMode.Range),
  onChange,
}: {
  initial?: NumberGroupConfiguration;
  onChange: (configuration: NumberGroupConfiguration) => void;
}) {
  const [configuration, setConfiguration] = useState(initial);

  return (
    <SettingsMenu
      configuration={configuration}
      onChange={(next) => {
        setConfiguration(next);
        onChange(next);
      }}
    />
  );
}

function input(name: 'Start' | 'End' | 'Interval') {
  return screen.getByRole('textbox', { name });
}

function changeRange(start: string, end: string, interval: string) {
  fireEvent.change(input('Start'), { target: { value: start } });
  fireEvent.change(input('End'), { target: { value: end } });
  fireEvent.change(input('Interval'), { target: { value: interval } });
}

describe('NumberGroupSettings', () => {
  it('preserves legacy grouping until an explicit mode selection', () => {
    const onChange = jest.fn();

    render(<LiveSettingsMenu initial={defaultNumberGroupConfiguration()} onChange={onChange} />);
    expect(screen.getByText('Automatic ranges of 100')).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: 'Exact value' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemradio', { name: 'Range' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Range' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(defaultNumberGroupConfiguration(NumberGroupMode.Range));
    expect(input('Start').value).toBe('0');
    expect(input('End').value).toBe('100');
    expect(input('Interval').value).toBe('10');
  });

  it('validates and applies signed decimal ranges atomically', () => {
    const onChange = jest.fn();

    render(<LiveSettingsMenu onChange={onChange} />);
    changeRange('-0.50', '0.50', '0');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toBe('Interval must be greater than zero.');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input('Interval'), { target: { value: '0.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        range_start: '-0.5',
        range_end: '0.5',
        range_interval: '0.25',
      })
    );
    expect(input('Start').value).toBe('-0.5');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply' }).disabled).toBe(true);
  });

  it('retains the last valid range and sorting across mode switches', () => {
    const onChange = jest.fn();

    render(<LiveSettingsMenu onChange={onChange} />);
    changeRange('-1', '1', '0.25');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.change(input('Start'), { target: { value: '-' } });
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Descending' }));
    expect(input('Start').value).toBe('-');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ range_start: '-1', sort_descending: true }));

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Exact value' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Range' }));
    expect(input('Start').value).toBe('-1');
    expect(input('Interval').value).toBe('0.25');
    expect(screen.getByRole('menuitemradio', { name: 'Descending' }).getAttribute('aria-checked')).toBe('true');
  });

  it('preserves unfinished input and caret when saved metadata refreshes', () => {
    const onChange = jest.fn();
    const configuration = defaultNumberGroupConfiguration(NumberGroupMode.Range);
    const { rerender } = render(<SettingsMenu configuration={configuration} onChange={onChange} />);

    fireEvent.change(input('Start'), { target: { value: '-0.' } });
    act(() => input('Start').focus());
    input('Start').setSelectionRange(2, 2);
    rerender(<SettingsMenu configuration={{ ...configuration, sort_descending: true }} onChange={onChange} />);
    expect(input('Start').value).toBe('-0.');
    expect(input('Start').selectionStart).toBe(2);

    rerender(<SettingsMenu configuration={{ ...configuration, range_start: '-10' }} onChange={onChange} />);
    expect(input('Start').value).toBe('-0.');
    expect(input('Start').selectionStart).toBe(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('handles Enter inside a range field without Radix selecting a different option', () => {
    const onChange = jest.fn();

    render(<LiveSettingsMenu onChange={onChange} />);
    changeRange('-1', '1', '0.5');
    act(() => input('Interval').focus());
    fireEvent.keyDown(input('Interval'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ range_interval: '0.5' }));
    expect(screen.getByRole('menuitemradio', { name: 'Range' }).getAttribute('aria-checked')).toBe('true');
    expect(input('Interval').value).toBe('0.5');
  });
});
