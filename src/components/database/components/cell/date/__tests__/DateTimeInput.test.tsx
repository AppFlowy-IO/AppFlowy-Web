import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import DateTimeInput from '../DateTimeInput';

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// The typed day must not roll over when the base date's day is past the end of the typed month.
it.each([
  ['an empty input on Oct 31', undefined, '09/12/2026', new Date(2026, 8, 12, 12)],
  ['an existing Jan 31 date', new Date(2026, 0, 31, 9, 30), '02/15/2026', new Date(2026, 1, 15, 9, 30)],
])('typing a shorter month keeps the typed date for %s', (_, date, typed, expected) => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 31, 12));
  const onDateChange = jest.fn();

  render(<DateTimeInput date={date} dateFormat='MM/DD/YYYY' timeFormat='HH:mm' onDateChange={onDateChange} />);
  fireEvent.change(screen.getByTestId('datetime-date-input'), { target: { value: typed } });

  expect(onDateChange).toHaveBeenLastCalledWith(expected);
});
