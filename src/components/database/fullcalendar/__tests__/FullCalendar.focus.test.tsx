import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { Calendar } from '../FullCalendar';

jest.mock('@/application/database-yjs', () => ({ useDatabaseContext: () => ({}) }));
jest.mock('@/utils/platform', () => ({ getPlatform: () => ({ isMobile: false }) }));
jest.mock('../CalendarUnsupportedPage', () => ({ CalendarUnsupportedPage: () => null }));
jest.mock('../StickyCalendarToolbar', () => ({ StickyCalendarToolbar: () => null }));
jest.mock('../StickyWeekHeader', () => ({ StickyWeekHeader: () => null }));
jest.mock('../CalendarContent', () => ({
  CalendarContent: () => (
    <div>
      <div data-testid='blank-calendar-cell'>Empty day</div>
      <input aria-label='Event title' />
      <div role='dialog'>
        <div data-testid='dialog-content'>Event details</div>
        <button type='button'>Dialog action</button>
      </div>
      {jest.requireActual('react-dom').createPortal(
        <>
          <div role='menu'>
            <div role='menuitem' data-testid='portal-menu-item'>Menu action</div>
          </div>
          <div role='dialog'>
            <div data-testid='portal-dialog-content'>Portal dialog content</div>
          </div>
        </>,
        document.body
      )}
    </div>
  ),
}));

afterEach(cleanup);

it.each(['textbox', 'dialog'] as const)('focuses a calendar inside a containing %s without scrolling', (role) => {
  render(
    <div role={role} contentEditable={role === 'textbox'} suppressContentEditableWarning>
      <div contentEditable={false}>
        <Calendar />
      </div>
    </div>
  );
  const cell = screen.getByTestId('blank-calendar-cell');
  const wrapper = cell.closest('.calendar-wrapper') as HTMLElement;
  const focus = jest.spyOn(wrapper, 'focus');

  fireEvent.pointerDown(cell);
  expect(document.activeElement).toBe(wrapper);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});

it('preserves focus inside an event input or a nested event dialog', () => {
  render(<Calendar />);
  const wrapper = screen.getByTestId('blank-calendar-cell').closest('.calendar-wrapper') as HTMLElement;
  const focus = jest.spyOn(wrapper, 'focus');
  const input = screen.getByRole('textbox', { name: 'Event title' });

  input.focus();
  fireEvent.pointerDown(input);
  expect(document.activeElement).toBe(input);
  const dialogAction = screen.getByRole('button', { name: 'Dialog action' });

  dialogAction.focus();
  fireEvent.pointerDown(screen.getByTestId('dialog-content'));
  expect(document.activeElement).toBe(dialogAction);
  expect(focus).not.toHaveBeenCalled();
});

it.each(['portal-menu-item', 'portal-dialog-content'])('does not steal focus from React portal content: %s', (testId) => {
  render(<Calendar />);
  const wrapper = screen.getByTestId('blank-calendar-cell').closest('.calendar-wrapper') as HTMLElement;
  const focus = jest.spyOn(wrapper, 'focus');
  const target = screen.getByTestId(testId);

  expect(wrapper.contains(target)).toBe(false);
  fireEvent.pointerDown(target);
  expect(focus).not.toHaveBeenCalled();
});
