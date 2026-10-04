import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import MentionDatePicker from '../MentionDatePicker';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => undefined }));
jest.mock('@/components/ui/calendar', () => ({ Calendar: () => null }));
jest.mock('@/components/database/components/cell/date/DateTimeInput', () => ({
  __esModule: true,
  default: ({ timeFormat }: { timeFormat: string }) => <span data-testid='time-format'>{timeFormat}</span>,
}));

afterEach(cleanup);

it('lets cell users toggle time without offering unscheduled reminders', () => {
  const change = jest.fn();

  render(<MentionDatePicker date={new Date(2026, 9, 5)} includeTime reminderOption='atTimeOfEvent'
    onDateChange={jest.fn()} onIncludeTimeChange={change} />);
  expect(screen.queryByText('datePicker.reminderLabel')).toBeNull();
  expect(screen.getByTestId('time-format').textContent).toBe('HH:mm');
  fireEvent.click(screen.getByRole('switch', { name: 'datePicker.includeTime' }));
  expect(change).toHaveBeenCalledWith(false);
});

it('retains reminder choices for document hosts', () => {
  render(<MentionDatePicker date={new Date(2026, 9, 5)} includeTime={false} reminderOption='none'
    onDateChange={jest.fn()} onIncludeTimeChange={jest.fn()} onReminderOptionChange={jest.fn()} />);
  expect(screen.getByRole('button', { name: /datePicker.reminderLabel/ })).toBeTruthy();
});
