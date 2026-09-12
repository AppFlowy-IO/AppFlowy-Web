import { CalendarApi } from '@fullcalendar/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReactNode, useState, ComponentProps } from 'react';

import { changeCalendarView } from '../calendarNavigation';
import { CustomToolbar as Toolbar } from '../CustomToolbar';
import { CalendarViewType } from '../types';

let mockViewTypeMap: Map<string, CalendarViewType>;
let mockViewId = 'calendar';
const mockSetCalendarViewType = jest.fn((viewId: string, view: CalendarViewType) => {
  mockViewTypeMap = new Map(mockViewTypeMap).set(viewId, view);
});

function CustomToolbar(props: ComponentProps<typeof Toolbar>) {
  const [, refresh] = useState(0);

  return <Toolbar {...props} currentView={mockViewTypeMap.get(mockViewId) ?? CalendarViewType.DAY_GRID_MONTH}
    onViewChange={(view) => {
      mockSetCalendarViewType(mockViewId, view);
      refresh((value) => value + 1);
      if (props.onViewChange) props.onViewChange(view);
      else changeCalendarView(props.calendar, view);
    }} />;
}

jest.mock('react-i18next', () => {
  const i18n = jest.requireActual('i18next').createInstance();

  i18n.init({
    lng: 'en',
    initImmediate: false,
    resources: { en: { translation: jest.requireActual('@/@types/translations/en.json') } },
  });
  return { useTranslation: () => ({ t: i18n.t.bind(i18n) }) };
});

jest.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    h2: ({ children, 'data-testid': testId }: { children: ReactNode; 'data-testid'?: string }) => (
      <h2 data-testid={testId}>{children}</h2>
    ),
  },
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipShortcut: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('../NoDateButton', () => ({ NoDateButton: () => <button type='button'>No date</button> }));
jest.mock('../hooks', () => ({
  useCalendarKeyboardShortcuts: jest.requireActual('../hooks/useCalendarKeyboardShortcuts').useCalendarKeyboardShortcuts,
}));

function createCalendar() {
  const listeners = new Set<() => void>();
  const el = document.createElement('div');
  const state = {
    date: new Date(2025, 11, 30),
    view: {
      type: CalendarViewType.DAY_GRID_MONTH,
      activeStart: new Date(2025, 11, 28),
      activeEnd: new Date(2026, 0, 4),
    },
  };
  const api = {
    el,
    view: state.view,
    getDate: jest.fn(() => state.date),
    gotoDate: jest.fn((date: Date) => { state.date = date; }),
    changeView: jest.fn((view: CalendarViewType, _date: Date) => { state.view.type = view; }),
    batchRendering: jest.fn((callback: () => void) => callback()),
    prev: jest.fn(),
    next: jest.fn(),
    today: jest.fn(),
    on: jest.fn((_event: string, listener: () => void) => listeners.add(listener)),
    off: jest.fn((_event: string, listener: () => void) => listeners.delete(listener)),
  };

  return {
    api,
    calendar: api as unknown as CalendarApi,
    state,
    emitDatesSet: () => act(() => listeners.forEach((listener) => listener())),
  };
}

async function openViewMenu() {
  const trigger = screen.getByTestId('calendar-view-select');

  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await screen.findByRole('menuitemradio', { name: /^Month(?:\s|$)/ });
}

async function openDayMenu() {
  await openViewMenu();
  const submenu = screen.getByRole('menuitem', { name: /Number of days/i });

  act(() => submenu.focus());
  fireEvent.keyDown(submenu, { key: 'ArrowRight' });
  await screen.findByRole('menuitemradio', { name: /^2 days(?:\s|$)/ });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockViewId = 'calendar';
  mockViewTypeMap = new Map();
});

afterEach(cleanup);

it('labels a shared one-day layout Day, matching desktop', () => {
  const { calendar } = createCalendar();

  mockViewTypeMap.set('calendar', CalendarViewType.TIME_GRID_DAY);
  render(<CustomToolbar calendar={calendar} />);
  expect(screen.getByTestId('calendar-view-select').textContent).toBe('Day');
  expect(screen.getByRole('button', { name: 'Previous Day' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Next Day' })).toBeTruthy();
});

it('shows the selected view, changes it once, and closes the dropdown', async () => {
  const { calendar, api } = createCalendar();
  const onViewChange = jest.fn();
  const { rerender } = render(<CustomToolbar calendar={calendar} onViewChange={onViewChange} />);

  expect(screen.getByTestId('calendar-view-select').textContent).toContain('Month');
  await openViewMenu();
  const month = screen.getByRole('menuitemradio', { name: /^Month(?:\s|$)/ });
  const week = screen.getByRole('menuitemradio', { name: /^Week(?:\s|$)/ });

  expect(month.getAttribute('aria-checked')).toBe('true');
  expect(week.getAttribute('aria-checked')).toBe('false');
  expect(within(month).getByText('M')).toBeTruthy();
  expect(within(week).getByText('W')).toBeTruthy();
  fireEvent.click(week);
  expect(mockSetCalendarViewType).toHaveBeenCalledWith('calendar', CalendarViewType.TIME_GRID_WEEK);
  expect(mockSetCalendarViewType).toHaveBeenCalledTimes(1);
  expect(onViewChange).toHaveBeenCalledWith(CalendarViewType.TIME_GRID_WEEK);
  expect(onViewChange).toHaveBeenCalledTimes(1);
  expect(api.changeView).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('menuitemradio')).toBeNull());

  rerender(<CustomToolbar calendar={calendar} onViewChange={onViewChange} />);
  expect(screen.getByTestId('calendar-view-select').textContent).toContain('Week');
});

it('reselects the current view without resetting its date or rewriting view state', async () => {
  const { calendar, api } = createCalendar();
  const onViewChange = jest.fn();

  render(<CustomToolbar calendar={calendar} onViewChange={onViewChange} />);
  await openViewMenu();
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Month(?:\s|$)/ }));
  await waitFor(() => expect(screen.queryByRole('menuitemradio')).toBeNull());
  expect(onViewChange).not.toHaveBeenCalled();
  expect(mockSetCalendarViewType).not.toHaveBeenCalled();
  expect(api.changeView).not.toHaveBeenCalled();
  expect(api.today).not.toHaveBeenCalled();
});

it('offers the desktop day counts and keeps the selected custom range checked', async () => {
  const { calendar } = createCalendar();
  const onViewChange = jest.fn();

  mockViewTypeMap.set('calendar', CalendarViewType.TIME_GRID_3_DAYS);
  const { rerender } = render(<CustomToolbar calendar={calendar} onViewChange={onViewChange} />);

  expect(screen.getByTestId('calendar-view-select').textContent).toContain('3 days');
  await openDayMenu();
  for (const count of [2, 3, 4, 5, 6, 8]) {
    const option = screen.getByRole('menuitemradio', { name: new RegExp(`^${count} days(?:\\s|$)`) });

    expect(option.getAttribute('aria-checked')).toBe(String(count === 3));
  }

  expect(screen.queryByRole('menuitemradio', { name: /^7 days/ })).toBeNull();
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^8 days(?:\s|$)/ }));
  expect(onViewChange).toHaveBeenCalledWith(CalendarViewType.TIME_GRID_8_DAYS);
  expect(onViewChange).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('menuitemradio')).toBeNull());
  rerender(<CustomToolbar calendar={calendar} onViewChange={onViewChange} />);
  expect(screen.getByTestId('calendar-view-select').textContent).toContain('8 days');
});

it('preserves the focused date for standard and custom ranges', async () => {
  const { calendar, api, state } = createCalendar();
  const { rerender } = render(<CustomToolbar calendar={calendar} />);

  await openViewMenu();
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Week(?:\s|$)/ }));
  expect(api.changeView).toHaveBeenCalledTimes(1);
  expect(api.changeView.mock.calls[0][0]).toBe(CalendarViewType.TIME_GRID_WEEK);
  const anchor = new Date(api.changeView.mock.calls[0][1]);

  expect(anchor.toDateString()).toBe(new Date(2025, 11, 30).toDateString());
  rerender(<CustomToolbar calendar={calendar} />);
  await openDayMenu();
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^2 days(?:\s|$)/ }));
  expect(api.changeView).toHaveBeenLastCalledWith(CalendarViewType.TIME_GRID_2_DAYS, state.date);
  expect(api.changeView).toHaveBeenCalledTimes(2);
});

it('keeps date and view navigation available in a read-only calendar', async () => {
  const { calendar, api, state } = createCalendar();
  const onViewChange = jest.fn();

  state.date = new Date(2026, 0, 31);
  render(<CustomToolbar calendar={calendar} onViewChange={onViewChange} />);
  expect(screen.getByRole('button', { name: 'Previous Month' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Next Month' })).toBeTruthy();
  fireEvent.click(screen.getByTestId('calendar-next-button'));
  expect(api.gotoDate).toHaveBeenLastCalledWith(new Date(2026, 1, 28));
  fireEvent.click(screen.getByTestId('calendar-prev-button'));
  expect(api.gotoDate).toHaveBeenLastCalledWith(new Date(2026, 0, 28));
  expect(api.gotoDate).toHaveBeenCalledTimes(2);
  expect(api.prev).not.toHaveBeenCalled();
  expect(api.next).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('calendar-today-button'));
  expect(api.today).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'No date' })).toBeTruthy();
  await openViewMenu();
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^Week(?:\s|$)/ }));
  expect(onViewChange).toHaveBeenCalledWith(CalendarViewType.TIME_GRID_WEEK);
});

it('uses each database view\'s own selected layout', () => {
  const { calendar } = createCalendar();

  mockViewTypeMap.set('calendar', CalendarViewType.TIME_GRID_4_DAYS);
  mockViewTypeMap.set('another-calendar', CalendarViewType.TIME_GRID_WEEK);
  const { rerender } = render(<CustomToolbar key={mockViewId} calendar={calendar} />);

  expect(screen.getByTestId('calendar-view-select').textContent).toContain('4 days');
  mockViewId = 'another-calendar';
  rerender(<CustomToolbar key={mockViewId} calendar={calendar} />);
  expect(screen.getByTestId('calendar-view-select').textContent).toContain('Week');
  expect(mockSetCalendarViewType).not.toHaveBeenCalled();
});

it('refreshes the month title after date navigation and releases its calendar subscription', () => {
  const { calendar, api, state, emitDatesSet } = createCalendar();
  const { unmount } = render(<CustomToolbar calendar={calendar} />);

  expect(screen.getByTestId('calendar-title').textContent).toBe('December 2025');
  state.date = new Date(2026, 0, 15);
  emitDatesSet();
  expect(screen.getByTestId('calendar-title').textContent).toBe('January 2026');
  const listener = api.on.mock.calls.at(-1)?.[1];

  unmount();
  expect(api.off).toHaveBeenCalledWith('datesSet', listener);
});

it.each([CalendarViewType.TIME_GRID_WEEK, CalendarViewType.TIME_GRID_8_DAYS])(
  'shows both years for a %s range and excludes the end boundary day',
  (view) => {
    const { calendar, state, emitDatesSet } = createCalendar();

    mockViewTypeMap.set('calendar', view);
    render(<CustomToolbar calendar={calendar} />);
    expect(screen.getByTestId('calendar-title').textContent).toBe('Dec 2025 - Jan 2026');
    const navigationLabel = view === CalendarViewType.TIME_GRID_WEEK ? 'Week' : 'period';

    expect(screen.getByRole('button', { name: `Previous ${navigationLabel}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Next ${navigationLabel}` })).toBeTruthy();
    state.view.activeEnd = new Date(2026, 0, 1);
    emitDatesSet();
    expect(screen.getByTestId('calendar-title').textContent).toBe('December 2025');
    state.view.activeStart = new Date(2026, 0, 29);
    state.view.activeEnd = new Date(2026, 1, 5);
    emitDatesSet();
    expect(screen.getByTestId('calendar-title').textContent).toBe('Jan - Feb 2026');
  }
);
