import { act, cleanup, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { createEditor, Text } from 'slate';

import { DateFormat, MentionType, TimeFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';

import MentionDate from '../MentionDate';
import MentionDatePicker from '../MentionDatePicker';

let mockReadOnly = false;
let mockReminders = false;
let mockTimeFormat = TimeFormat.TwelveHour;
const mockEditor = createEditor();
const mockPicker = jest.fn();

jest.mock('slate-react', () => ({
  useSlateStatic: () => mockEditor,
  useReadOnly: () => mockReadOnly,
  ReactEditor: { findPath: () => [0, 0] },
}));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ enableReminderMentions: mockReminders }),
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ metadata: { [MetadataKey.DateFormat]: DateFormat.ISO, [MetadataKey.TimeFormat]: mockTimeFormat } }),
}));
jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('../MentionDatePicker', () => ({
  __esModule: true,
  default: (props: React.ComponentProps<typeof MentionDatePicker>) => {
    mockPicker(props);
    return null;
  },
}));

const date = new Date(2026, 9, 5, 16, 30).toISOString();
const text: Text = {
  text: '$',
  mention: { type: MentionType.Date, date, include_time: true, label: 'Stored date', data: { title: 'Preserved' } },
};

afterEach(cleanup);
beforeEach(() => {
  jest.clearAllMocks();
  mockReadOnly = false;
  mockReminders = false;
  mockTimeFormat = TimeFormat.TwelveHour;
  mockEditor.children = [{ type: 'paragraph', children: [text] }];
});

it('uses the selected time format and follows changes', () => {
  const props = { date, includeTime: true, text };
  const { rerender } = render(<MentionDate {...props} />);

  expect(screen.getByText('2026-10-05 4:30 PM', { exact: false })).toBeTruthy();
  mockTimeFormat = TimeFormat.TwentyFourHour;
  rerender(<MentionDate {...props} />);
  expect(screen.getByText('2026-10-05 16:30', { exact: false })).toBeTruthy();
});

it.each([false, true])('offers reminders only for capable hosts: %s', (enabled) => {
  mockReminders = enabled;
  render(<MentionDate date={date} text={text} />);
  expect(typeof mockPicker.mock.calls.at(-1)?.[0].onReminderOptionChange).toBe(enabled ? 'function' : 'undefined');
});

it('keeps mention data when a cell date is edited', async () => {
  const addMark = jest.spyOn(mockEditor, 'addMark');

  render(<MentionDate date={date} includeTime text={text} />);
  const next = new Date(2026, 9, 6, 16, 30);

  await act(async () => {
    mockPicker.mock.calls.at(-1)?.[0].onDateChange(next);
  });
  expect(addMark).toHaveBeenCalledWith('mention', expect.objectContaining({
    date: next.toISOString(), data: { title: 'Preserved' }, label: 'Stored date',
  }));
  addMark.mockRestore();
});

it('keeps date chips read-only without mounting an editor', () => {
  mockReadOnly = true;
  render(<MentionDate date={date} text={text} />);
  expect(mockPicker).not.toHaveBeenCalled();
});
