import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EventApi, EventContentArg } from '@fullcalendar/core';

import { EventWithPopover } from '../EventWithPopover';

const mockClearNewEvent = jest.fn();
const mockClearUpdateEvent = jest.fn();
const mockDeleteRows = jest.fn();
const mockSetOpenEventRowId = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/database-yjs', () => ({
  useDatabaseViewLayout: () => undefined,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useTrashAwareDeleteRowsDispatch: () => mockDeleteRows,
}));

jest.mock('../../CalendarContent', () => ({
  useEventContext: () => ({
    clearNewEvent: mockClearNewEvent,
    clearUpdateEvent: mockClearUpdateEvent,
    setOpenEventRowId: mockSetOpenEventRowId,
  }),
}));

jest.mock('../EventDisplay', () => ({
  EventDisplay: ({ onClick }: { onClick?: () => void }) => (
    <button data-testid='event-display' onClick={onClick}>
      Event
    </button>
  ),
}));

jest.mock('../EventPopoverContent', () => ({
  __esModule: true,
  default: ({ onRequestDelete }: { onRequestDelete: () => void }) => (
    <button data-testid='request-delete' onClick={onRequestDelete}>
      Delete event
    </button>
  ),
}));

describe('EventWithPopover', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserverMock {
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
    jest.clearAllMocks();
    mockDeleteRows.mockResolvedValue(undefined);
  });

  it('closes the modal event popover before opening and confirming the MUI delete dialog', async () => {
    const event = {
      id: 'row-1',
      extendedProps: { rowId: 'row-1' },
    } as unknown as EventApi;
    const eventInfo = {
      isStart: true,
      view: { calendar: { gotoDate: jest.fn() } },
    } as unknown as EventContentArg;

    render(<EventWithPopover event={event} eventInfo={eventInfo} />);

    fireEvent.click(screen.getByTestId('event-display'));
    const deleteRequest = await screen.findByTestId('request-delete');

    expect(document.querySelector('[data-slot="popover-content"]')).toBeTruthy();
    expect(screen.queryByTestId('delete-row-confirm-button')).toBeNull();

    fireEvent.click(deleteRequest);

    const confirmDelete = await screen.findByTestId('delete-row-confirm-button');

    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(mockSetOpenEventRowId).toHaveBeenNthCalledWith(1, 'row-1');
    expect(mockSetOpenEventRowId).toHaveBeenNthCalledWith(2, null);

    fireEvent.click(confirmDelete);

    expect(mockDeleteRows).toHaveBeenCalledWith(['row-1']);
    await waitFor(() => expect(screen.queryByTestId('delete-row-confirm-button')).toBeNull());
  });
});
