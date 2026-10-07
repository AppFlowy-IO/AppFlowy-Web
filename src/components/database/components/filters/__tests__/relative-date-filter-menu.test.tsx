import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { DateFilter, DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

import DateTimeFilterMenu from '../filter-menu/DateTimeFilterMenu';
import { useFilterChipLabel } from '../overview/useFilterChipLabel';

const mockUpdate = jest.fn();
let mockField: YDatabaseField;

jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useConditionsReadOnly: () => false,
}));
jest.mock('@/application/database-yjs/selector', () => ({
  ...jest.requireActual('@/application/database-yjs/selector'),
  useFieldSelector: () => ({ field: mockField }),
  useFieldType: () => FieldType.DateTime,
  useFormulaResultType: () => 'any',
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  ...jest.requireActual('@/application/database-yjs/dispatch'),
  useUpdateFilter: () => mockUpdate,
}));
jest.mock('@/components/database/components/filters/filter-menu/FieldMenuTitle', () => ({
  __esModule: true,
  default: ({ renderConditionSelect }: { renderConditionSelect: ReactNode }) => <div>{renderConditionSelect}</div>,
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => undefined,
  useCurrentUserOptional: () => undefined,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const count = options?.count;
      const template =
        (count === 1 ? options?.defaultValue_one : count !== undefined ? options?.defaultValue_other : undefined) ??
        options?.defaultValue ??
        key;

      return String(template).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

function dateField() {
  const field = new Y.Doc().getMap('field');

  field.set(YjsDatabaseKey.id, 'due');
  field.set(YjsDatabaseKey.type, FieldType.DateTime);
  return field as unknown as YDatabaseField;
}

function filterOf(condition: number, extra: Partial<DateFilter> = {}): DateFilter {
  return { id: 'filter-1', fieldId: 'due', condition, content: '', filterType: 2, ...extra } as unknown as DateFilter;
}

function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
}

beforeAll(() => {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  mockField = dateField();
  jest.clearAllMocks();
});

describe('"Is relative to today" in the view date filter menu (WP08 §3.3)', () => {
  it('is offered right after "Is between" and writes the default spec with the condition', async () => {
    render(<DateTimeFilterMenu filter={filterOf(DateFilterCondition.DateStartsOn)} />);

    openDropdown(screen.getByTestId('filter-condition-trigger'));
    const option = await waitFor(() => screen.getByTestId(`filter-condition-${DateFilterCondition.DateStartsRelative}`));
    const values = screen
      .getAllByTestId(/^filter-condition-\d+$/)
      .map((item) => Number(item.getAttribute('data-testid')?.replace('filter-condition-', '')));

    expect(values.indexOf(DateFilterCondition.DateStartsRelative)).toBe(
      values.indexOf(DateFilterCondition.DateStartsBetween) + 1
    );
    expect(option.textContent).toBe('Is relative to today');
    fireEvent.click(option);
    expect(mockUpdate).toHaveBeenCalledWith({
      filterId: 'filter-1',
      fieldId: 'due',
      condition: DateFilterCondition.DateStartsRelative,
      content: JSON.stringify({ relative_direction: 'this', relative_amount: 1, relative_unit: 'week' }),
    });
  });

  it('edits the spec with the relative builder instead of a date picker', async () => {
    render(
      <DateTimeFilterMenu
        filter={filterOf(DateFilterCondition.DateStartsRelative, {
          relative_direction: 'past',
          relative_amount: 7,
          relative_unit: 'day',
        })}
      />
    );

    expect(screen.queryByTestId('date-filter-date-picker')).toBeNull();
    expect(screen.getByTestId('date-filter-relative-direction').getAttribute('data-value')).toBe('past');
    expect(screen.getByTestId<HTMLInputElement>('date-filter-relative-amount').value).toBe('7');
    expect(screen.getByTestId('date-filter-relative-unit').textContent).toContain('days');
    expect(screen.getByTestId('date-filter-relative-hint').textContent).toBe('Filter will update with the current date');

    // A new amount (the input is debounced in the app); an invalid one is not written.
    fireEvent.change(screen.getByTestId('date-filter-relative-amount'), { target: { value: '0' } });
    expect(mockUpdate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('date-filter-relative-amount'), { target: { value: '14' } });
    expect(JSON.parse(mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0].content)).toEqual({
      relative_direction: 'past',
      relative_amount: 14,
      relative_unit: 'day',
    });

    openDropdown(screen.getByTestId('date-filter-relative-unit'));
    const week = await waitFor(() =>
      screen
        .getAllByTestId('date-filter-relative-unit-option')
        .find((item) => item.getAttribute('data-value') === 'week')
    );

    fireEvent.click(week!);
    expect(JSON.parse(mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0].content)).toMatchObject({
      relative_unit: 'week',
    });
  });

  it('leaving the relative condition clears the spec', async () => {
    render(<DateTimeFilterMenu filter={filterOf(DateFilterCondition.DateStartsRelative)} />);

    openDropdown(screen.getByTestId('filter-condition-trigger'));
    fireEvent.click(await waitFor(() => screen.getByTestId(`filter-condition-${DateFilterCondition.DateStartsAfter}`)));
    expect(mockUpdate).toHaveBeenCalledWith({
      filterId: 'filter-1',
      fieldId: 'due',
      condition: DateFilterCondition.DateStartsAfter,
      content: '',
    });
  });

  it('the chip label reads the relative summary', () => {
    const { result } = renderHook(() =>
      useFilterChipLabel(
        filterOf(DateFilterCondition.DateStartsRelative, {
          relative_direction: 'past',
          relative_amount: 7,
          relative_unit: 'day',
        })
      )
    );

    expect(result.current.description).toBe('Past 7 days');
    expect(result.current.hasContent).toBe(true);
  });
});
