import { fireEvent, render, screen } from '@testing-library/react';

import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { ChartGroupByPage, ChartGroupByRow } from '@/components/database/chart/settings/ChartGroupByRow';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/components/database/components/field', () => ({
  FieldDisplay: ({ fieldId }: { fieldId: string }) => <span>{fieldId}</span>,
}));

const FIELDS = [
  { id: 'audience', name: 'Audience', type: FieldType.SingleSelect },
  { id: 'region', name: 'Région', type: FieldType.SingleSelect },
  { id: 'due', name: 'Due', type: FieldType.DateTime },
  { id: 'done', name: 'Done', type: FieldType.Checkbox },
];

function renderPage(selectedId: string | null = null, dateCondition = DateGroupCondition.Month) {
  const onSelect = jest.fn();
  const onSelectDate = jest.fn();
  const onBack = jest.fn();

  render(
    <ChartGroupByPage
      dateCondition={dateCondition}
      fields={FIELDS}
      onBack={onBack}
      onSelect={onSelect}
      onSelectDate={onSelectDate}
      selectedId={selectedId}
      title='Group by'
    />
  );
  return { onSelect, onSelectDate, onBack };
}

const listed = () => screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('data-field-name'));

describe('ChartGroupByRow', () => {
  it('shows the Group by property, or None, and opens its page', () => {
    const onOpen = jest.fn();
    const { rerender } = render(<ChartGroupByRow fieldName={null} label='Group by' onOpen={onOpen} />);
    const row = screen.getByTestId('chart-settings-group-by');

    expect(row.getAttribute('data-row-id')).toBe('y_group_by');
    expect(row.textContent).toBe('Group byNone');
    rerender(<ChartGroupByRow fieldName='Audience' label='Group by' onOpen={onOpen} />);
    expect(screen.getByTestId('chart-settings-group-by').textContent).toBe('Group byAudience');
    fireEvent.click(screen.getByTestId('chart-settings-group-by'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('ChartGroupByPage', () => {
  it('lists None first, then the candidates in view order, with a tick on the selected one', () => {
    renderPage('audience');

    expect(listed()).toEqual(['None', 'Audience', 'Région', 'Due', 'Done']);
    expect(screen.getByTestId('chart-group-by-option-audience').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('chart-group-by-option-none').getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(screen.getByTestId('chart-group-by-search'));
  });

  it('ticks None without a Group by and picks a property or None', () => {
    const { onSelect } = renderPage();

    expect(screen.getByTestId('chart-group-by-option-none').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('chart-group-by-option-done'));
    expect(onSelect).toHaveBeenLastCalledWith('done');
    fireEvent.click(screen.getByTestId('chart-group-by-option-none'));
    expect(onSelect).toHaveBeenLastCalledWith('');
  });

  it('searches case and accent insensitively and says No results', () => {
    renderPage();
    const search = screen.getByTestId('chart-group-by-search');

    fireEvent.change(search, { target: { value: 'REGION' } });
    expect(listed()).toEqual(['Région']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
    expect(screen.getByTestId('chart-group-by-no-results').textContent).toBe('No results');
  });

  it('opens the date groupings of a date property and writes the picked one', () => {
    const { onSelectDate } = renderPage('due', DateGroupCondition.Week);

    expect(screen.queryByTestId('chart-group-by-date-open-audience')).toBeNull();
    fireEvent.click(screen.getByTestId('chart-group-by-date-open-due'));
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Relative',
      'Day',
      'Week',
      'Month',
      'Year',
    ]);
    expect(screen.getByTestId(`chart-group-by-date-${DateGroupCondition.Week}`).getAttribute('aria-checked')).toBe(
      'true'
    );
    fireEvent.click(screen.getByTestId(`chart-group-by-date-${DateGroupCondition.Day}`));
    expect(onSelectDate).toHaveBeenCalledWith('due', DateGroupCondition.Day);
  });

  it('goes back from the date groupings to the property list', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('chart-group-by-date-open-due'));
    fireEvent.click(screen.getByTestId('chart-group-by-date-back'));
    expect(listed()).toEqual(['None', 'Audience', 'Région', 'Due', 'Done']);
  });
});
