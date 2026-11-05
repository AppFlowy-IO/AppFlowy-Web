/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useReducer } from 'react';

import type { CalendarEvent } from '@/application/database-yjs';
import { CalendarLayout } from '@/application/database-yjs/database.type';
import { AFConfigContext } from '@/components/main/app.hooks';

import { CalendarContent } from '../CalendarContent';
import { useCalendarDraftContext } from '../event/CalendarDraftContext';
import { useCalendarHandlers } from '../hooks';

import type { EventApi } from '@fullcalendar/core';

// The real CalendarContent, FullCalendar and EventWithPopover. The data hooks
// are stubbed with values as stable as the real selectors keep theirs, and the
// event card is a stub that counts the renders of every event. Hooks count the
// rest: CalendarContent calls `useCalendarHandlers` once per render, and the
// EventWithPopover that `eventContent` returns calls `useCalendarDraftContext`
// once per render, which happens again only when FullCalendar regenerates the
// content of its event.
const mockEventCardRenders = jest.fn();
const mockNoop = () => undefined;
const mockDatabaseContext = { readOnly: false, canWrite: true, activeViewId: 'calendar', isDocumentBlock: false };
const mockEmptyEvents: CalendarEvent[] = [];
const mockEvents: CalendarEvent[] = [
  { id: 'all-day', rowId: 'all-day', title: 'All day', allDay: true, start: new Date(2026, 2, 17) },
  {
    id: 'timed',
    rowId: 'timed',
    title: 'Timed',
    allDay: false,
    isRange: true,
    start: new Date(2026, 2, 18, 10),
    end: new Date(2026, 2, 18, 11),
  },
  {
    id: 'multi-day',
    rowId: 'multi-day',
    title: 'Multi-day',
    allDay: true,
    isRange: true,
    start: new Date(2026, 2, 19),
    end: new Date(2026, 2, 20),
  },
];
let mockLayoutSetting: { fieldId: string; layout: CalendarLayout; numberOfDays?: number };

// The shared lodash-es mock has no sortBy and runs debounced calls at once.
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('@/application/database-yjs', () => ({
  CalendarLayout: jest.requireActual('@/application/database-yjs/database.type').CalendarLayout,
  FieldType: jest.requireActual('@/application/database-yjs/database.type').FieldType,
  useDatabaseContext: () => mockDatabaseContext,
  useDatabaseViewId: () => 'calendar',
  useReadOnly: () => false,
  useCalendarLayoutSetting: () => mockLayoutSetting,
  useCalendarEventsSelector: () => ({ events: mockEvents, emptyEvents: mockEmptyEvents, loading: false }),
  useCreateCalendarEvent: () => mockNoop,
  useUpdateStartEndTimeCell: () => mockNoop,
  useFieldSelector: () => ({ field: null }),
  useDatabaseExtraFilters: () => undefined,
  useDatabaseView: () => undefined,
  usePrimaryFieldId: () => 'title',
}));
jest.mock('@/application/database-yjs/context', () => ({
  ...jest.requireActual('@/application/database-yjs/context'),
  useNavigateToRow: () => undefined,
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateCalendarSetting: () => mockNoop,
  useNewRowDispatch: () => mockNoop,
}));
jest.mock('@/application/database-yjs/dispatch/row', () => ({ useNewRowDispatch: () => mockNoop }));
jest.mock('@/application/database-yjs/effective-conditions', () => ({ useEffectiveViewFilters: () => undefined }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/database/components/database-row/DeleteRowConfirm', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../event/EventPopoverContent', () => ({ __esModule: true, default: () => null }));
jest.mock('../event/EventDisplay', () => ({
  EventDisplay: ({ event }: { event: EventApi }) => {
    mockEventCardRenders(event.id);
    return <div data-testid='calendar-event' />;
  },
}));
jest.mock('../event/CalendarDraftContext', () => {
  const actual = jest.requireActual('../event/CalendarDraftContext');

  return { ...actual, useCalendarDraftContext: jest.fn(actual.useCalendarDraftContext) };
});
jest.mock('../hooks', () => {
  const actual = jest.requireActual('../hooks');

  return { ...actual, useCalendarHandlers: jest.fn(actual.useCalendarHandlers) };
});

const calendarContentRenders = useCalendarHandlers as jest.Mock;
const eventContentRenders = useCalendarDraftContext as jest.Mock;
const appConfig = { isAuthenticated: false, openLoginModal: mockNoop, updateCurrentUser: async () => undefined };
const onDataChange = jest.fn();

/** Like the calendar page, which re-renders CalendarContent whenever it stores calendar data or a drag starts. */
function CalendarPage() {
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  return (
    <AFConfigContext.Provider value={appConfig}>
      <button data-testid='rerender-page' onClick={rerender} />
      <CalendarContent onDataChange={onDataChange} />
    </AFConfigContext.Provider>
  );
}

function renderCalendar(layout: CalendarLayout, numberOfDays?: number) {
  mockLayoutSetting = { fieldId: 'date', layout, numberOfDays };
  const view = render(<CalendarPage />);

  // Let the mount, its follow-up renders and the debounced resize settle.
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  jest.clearAllMocks();
  return view;
}

beforeAll(() => {
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  });
});

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 2, 18, 12) });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

it.each([
  ['month', CalendarLayout.MonthLayout, undefined, 3],
  ['week', CalendarLayout.WeekLayout, 7, 3],
  ['3-day', CalendarLayout.WeekLayout, 3, 2],
])('%s view: re-rendering CalendarContent re-renders no event', (_name, layout, numberOfDays, segments) => {
  renderCalendar(layout, numberOfDays);
  expect(screen.getAllByTestId('calendar-event')).toHaveLength(segments);

  for (let i = 0; i < 3; i++) {
    fireEvent.click(screen.getByTestId('rerender-page'));
    act(() => {
      jest.advanceTimersByTime(100);
    });
  }

  expect(calendarContentRenders).toHaveBeenCalledTimes(3);
  // FullCalendar saw no changed option, so it regenerated no event's content,
  expect(eventContentRenders).not.toHaveBeenCalled();
  // and the context every event reads kept its value.
  expect(mockEventCardRenders).not.toHaveBeenCalled();
});

it('month view: hovering day cells moves the add button without re-rendering any event', () => {
  const { container } = renderCalendar(CalendarLayout.MonthLayout);
  const dayCells = Array.from(container.querySelectorAll('.fc-daygrid-day')).slice(15, 18);

  expect(dayCells).toHaveLength(3);
  for (const dayCell of dayCells) {
    fireEvent.mouseEnter(dayCell);
    act(() => {
      jest.advanceTimersByTime(150);
    });
    expect(document.querySelector('[data-add-button]')).not.toBeNull();
    fireEvent.mouseLeave(dayCell);
    expect(document.querySelector('[data-add-button]')).toBeNull();
  }

  // One render to show the add button on each cell and one to hide it.
  expect(calendarContentRenders).toHaveBeenCalledTimes(6);
  expect(eventContentRenders).not.toHaveBeenCalled();
  expect(mockEventCardRenders).not.toHaveBeenCalled();
});
