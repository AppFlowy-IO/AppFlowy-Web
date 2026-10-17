import { fireEvent, render, screen } from '@testing-library/react';

import { Filter } from '@/application/database-yjs/database.type';
import { UpdateFilterParams } from '@/application/database-yjs/dispatch/filter-update';
import {
  parseVerificationFilter,
  serializeVerificationFilter,
  VerificationFilterCondition as Condition,
  VerificationFilterStatus as Status,
} from '@/application/database-yjs/fields/verification';

import { VerificationFilterMenu, VerificationFilterValue } from '../VerificationConditions';

const mockUpdate = jest.fn();
let mockReadOnly = false;

jest.mock('@/application/database-yjs', () => ({ useReadOnly: () => mockReadOnly }));
jest.mock('@/components/database/components/filters/filter-menu/FilterEditorContext', () => ({
  useFilterValueUpdater: () => mockUpdate,
}));
jest.mock('@/components/database/components/filters/filter-menu/FieldMenuTitle', () => ({
  __esModule: true,
  default: ({ filterId }: { filterId: string }) => <span data-testid='native-filter-header'>{filterId}</span>,
}));
jest.mock('@/components/ui/calendar', () => ({
  Calendar: ({
    onSelect,
    selected,
    defaultMonth,
  }: {
    onSelect: (date: Date) => void;
    selected?: Date;
    defaultMonth?: Date;
  }) => {
    if (selected && !Number.isFinite(selected.getTime())) throw new Error('Invalid calendar selection');
    if (defaultMonth && !Number.isFinite(defaultMonth.getTime())) throw new Error('Invalid calendar month');
    return <button onClick={() => onSelect(new Date(2026, 9, 16))}>October 16</button>;
  },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

function rule(id = 'rule-A', condition = Condition.Is): Filter {
  return {
    id,
    fieldId: 'native-verification',
    condition,
    content: serializeVerificationFilter({
      condition,
      status: Status.Verified,
      expiresAfterMicros: null,
      expiresBeforeMicros: null,
    }),
  };
}

function updated(filter: Filter) {
  const update = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1][0] as UpdateFilterParams;

  expect(update.fieldId).toBe('native-verification');
  expect(update.filterId).toBe(filter.id);
  return parseVerificationFilter(update.condition ?? filter.condition, update.transformContent!(filter.content ?? ''));
}

beforeEach(() => {
  mockUpdate.mockReset();
  mockReadOnly = false;
});

it('edits the selected native rule independently of a second rule on the same field', () => {
  const first = rule();
  const second = rule('rule-B');
  const { rerender } = render(<VerificationFilterMenu filter={first} />);

  fireEvent.click(screen.getByTestId(`verification-filter-${Status.Expired}`));
  expect(updated(first).status).toBe(Status.Expired);
  rerender(<VerificationFilterMenu filter={second} />);
  fireEvent.click(screen.getByTestId(`verification-filter-${Status.Unverified}`));
  expect(updated(second).status).toBe(Status.Unverified);
  expect(screen.getByTestId('native-filter-header').textContent).toBe('rule-B');
});

it('uses IsNot as a native condition and clears bounds for IsEmpty', () => {
  const filter = rule();

  filter.content = serializeVerificationFilter({
    ...parseVerificationFilter(filter.condition, filter.content),
    expiresBeforeMicros: 42n,
  });
  render(<VerificationFilterMenu filter={filter} />);
  fireEvent.click(screen.getByTestId(`filter-condition-${Condition.IsNot}`));
  expect(updated(filter)).toMatchObject({
    condition: Condition.IsNot,
    status: Status.Verified,
    expiresBeforeMicros: 42n,
  });
  fireEvent.click(screen.getByTestId(`filter-condition-${Condition.IsEmpty}`));
  expect(updated(filter)).toMatchObject({
    condition: Condition.IsEmpty,
    expiresAfterMicros: null,
    expiresBeforeMicros: null,
  });
});

it.each(['before', 'after'])('includes every microsecond of the selected local day on or %s', (boundary) => {
  const filter = rule();

  render(<VerificationFilterMenu filter={filter} />);
  fireEvent.click(screen.getByRole('button', { name: `Expires on or ${boundary} Any date` }));
  fireEvent.click(screen.getByText('October 16'));
  const upper = boundary === 'before';
  const date = upper ? new Date(2026, 9, 16, 23, 59, 59, 999) : new Date(2026, 9, 16);

  expect(updated(filter)[upper ? 'expiresBeforeMicros' : 'expiresAfterMicros']).toBe(
    BigInt(date.getTime()) * 1000n + (upper ? 999n : 0n)
  );
});

it('suppresses value for empty but retains expiration editing for nonempty', () => {
  const { rerender } = render(<VerificationFilterValue filter={rule('A', Condition.IsEmpty)} />);

  expect(screen.queryByTestId('advanced-filter-verification-input')).toBeNull();
  rerender(<VerificationFilterMenu filter={rule('A', Condition.IsNotEmpty)} />);
  expect(screen.queryByTestId(`verification-filter-${Status.Verified}`)).toBeNull();
  expect(screen.getByRole('button', { name: 'Expires on or before Any date' })).toBeTruthy();
});

it('does not dispatch mutations in a read-only view', () => {
  mockReadOnly = true;
  render(<VerificationFilterMenu filter={rule()} />);
  fireEvent.click(screen.getByTestId(`verification-filter-${Status.Expired}`));
  fireEvent.click(screen.getByTestId(`filter-condition-${Condition.IsEmpty}`));
  expect(mockUpdate).not.toHaveBeenCalled();
});

it.each([9223372036854775807n, -9223372036854775808n])(
  'preserves an out-of-range i64 expiry %s without passing Invalid Date to Calendar',
  (micros) => {
    const filter = rule();

    filter.content = serializeVerificationFilter({
      ...parseVerificationFilter(filter.condition, filter.content),
      expiresBeforeMicros: micros,
    });
    render(<VerificationFilterMenu filter={filter} />);
    fireEvent.click(screen.getByTestId(`verification-filter-${Status.Expired}`));
    expect(updated(filter)).toMatchObject({ status: Status.Expired, expiresBeforeMicros: micros });
    fireEvent.click(screen.getByRole('button', { name: 'Expires on or before Unsupported date' }));
    expect(screen.getByText('October 16')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Expires on or before' }));
    expect(updated(filter).expiresBeforeMicros).toBeNull();
  }
);
