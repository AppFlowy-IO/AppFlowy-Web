import { fireEvent, render, screen } from '@testing-library/react';
import { ComponentProps } from 'react';

import { FieldVisibility } from '@/application/database-yjs';

import { TimelineBar } from '../TimelineBar';

const mockIconClick = jest.fn();
const mockCheckboxClick = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/database/fullcalendar/event/components/EventIconButton', () => ({
  EventIconButton: () => (
    <button onClick={mockIconClick} data-testid='icon-picker'>
      <svg data-testid='icon-glyph' />
    </button>
  ),
}));
jest.mock('@/components/database/components/field/CardField', () => ({
  CardField: () => (
    <div onClick={mockCheckboxClick} data-testid='checkbox-chip' tabIndex={0}>
      Checkbox
    </div>
  ),
}));
jest.mock('@/components/database/fullcalendar/event/eventAppearance', () => ({
  calendarEventCompletionTime: () => undefined,
  useCalendarEventPast: () => false,
}));
jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

function setup(overrides: Partial<ComponentProps<typeof TimelineBar>> = {}) {
  const onPointerDown = jest.fn();
  const onOpen = jest.fn();

  render(
    <TimelineBar
      row={{ rowId: 'row', title: 'Task', start: new Date(2026, 8, 16), allDay: true, isRange: false }}
      rect={{ left: 20, width: 300 }}
      propertyFields={[{ fieldId: 'done', width: 100, visibility: FieldVisibility.AlwaysShown, isPrimary: false }]}
      editable
      formatTime={() => ''}
      onPointerDown={onPointerDown}
      onOpen={onOpen}
      {...overrides}
    />
  );
  return { onPointerDown, onOpen };
}

beforeEach(() => jest.clearAllMocks());

test('icon and property presses do not begin a bar drag or open the row', () => {
  const { onPointerDown, onOpen } = setup();

  for (const id of ['icon-glyph', 'checkbox-chip']) {
    const control = screen.getByTestId(id);

    fireEvent.pointerDown(control, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(control, { pointerId: 1 });
    fireEvent.click(control);
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: ' ' });
  }

  expect(mockIconClick).toHaveBeenCalledTimes(1);
  expect(mockCheckboxClick).toHaveBeenCalledTimes(1);
  expect(onPointerDown).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();

  fireEvent.pointerDown(screen.getByText('Task'));
  expect(onPointerDown).toHaveBeenCalledWith(expect.anything(), 'move');
  fireEvent.keyDown(screen.getByText('Task'), { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledWith('row');
});

test('system date bindings disable only date gestures', () => {
  const { onPointerDown, onOpen } = setup({ dateEditable: false, progress: 40, linkable: true });

  expect(screen.queryByTestId('timeline-handle-start-row')).toBeNull();
  expect(screen.queryByTestId('timeline-handle-end-row')).toBeNull();
  fireEvent.pointerDown(screen.getByText('Task'));
  expect(onPointerDown).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Task'));
  expect(onOpen).toHaveBeenCalledWith('row');

  fireEvent.click(screen.getByTestId('icon-picker'));
  fireEvent.click(screen.getByTestId('checkbox-chip'));
  expect(mockIconClick).toHaveBeenCalledTimes(1);
  expect(mockCheckboxClick).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(screen.getByTestId('timeline-handle-progress-row'));
  expect(onPointerDown).toHaveBeenCalledWith(expect.anything(), 'progress');
  expect(screen.getByTestId('timeline-link-row')).not.toBeNull();
});
