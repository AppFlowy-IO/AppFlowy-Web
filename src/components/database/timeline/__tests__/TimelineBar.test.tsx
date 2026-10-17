import { fireEvent, render, screen } from '@testing-library/react';
import { ComponentProps, ReactNode } from 'react';

import { FieldType, FieldVisibility } from '@/application/database-yjs';

import { TimelineBar } from '../TimelineBar';
import { TimelineTableProvider } from '../TimelineTable';

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
  Tooltip: ({ children, onOpenChange }: { children: React.ReactNode; onOpenChange: (open: boolean) => void }) => (
    <div onMouseEnter={() => onOpenChange(true)} onMouseLeave={() => onOpenChange(false)} data-testid='tooltip'>
      {children}
    </div>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ collisionPadding }: { collisionPadding: { left: number } }) => (
    <output data-testid='tooltip-left-padding'>{collisionPadding.left}</output>
  ),
}));

function setup(
  overrides: Partial<ComponentProps<typeof TimelineBar>> = {},
  wrapper?: React.ComponentType<{ children: ReactNode }>
) {
  const onPointerDown = jest.fn();
  const onOpen = jest.fn();

  const bar = (
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
  const rendered = render(bar, { wrapper });

  return { ...rendered, bar, onPointerDown, onOpen };
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

test('a hover card reads the resized table boundary only when opened', () => {
  const boundary = document.createElement('div');
  const bounds = jest.spyOn(boundary, 'getBoundingClientRect').mockReturnValue({ left: 96 } as DOMRect);
  let width = 280;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <TimelineTableProvider contentWidth={width} viewportWidth={width}>
      {children}
    </TimelineTableProvider>
  );
  const { bar, rerender } = setup({ hoverCardBoundary: boundary }, Wrapper);

  expect(bounds).not.toHaveBeenCalled();
  fireEvent.mouseEnter(screen.getByTestId('tooltip'));
  expect(screen.getByTestId('tooltip-left-padding').textContent).toBe('376');
  fireEvent.mouseLeave(screen.getByTestId('tooltip'));
  // The closed card does not measure on a resize; its next opening uses the
  // latest width even though the bar's props never changed.
  width = 480;
  rerender(bar);
  expect(bounds).toHaveBeenCalledTimes(1);
  fireEvent.mouseEnter(screen.getByTestId('tooltip'));
  expect(screen.getByTestId('tooltip-left-padding').textContent).toBe('576');
  expect(bounds).toHaveBeenCalledTimes(2);
  // A remote resize while it is open still keeps the card clear of the table.
  width = 580;
  rerender(bar);
  expect(screen.getByTestId('tooltip-left-padding').textContent).toBe('676');
  bounds.mockRestore();
});

test('property chips use the desktop list card cell style map', () => {
  const chip = (fieldId: string, fieldType: FieldType) => ({
    fieldId,
    fieldType,
    width: 100,
    visibility: FieldVisibility.AlwaysShown,
    isPrimary: false,
  });

  setup({
    propertyFields: [
      chip('assignee', FieldType.Person),
      chip('files', FieldType.Media),
      chip('count', FieldType.Number),
      chip('author', FieldType.CreatedBy),
    ],
  });

  const chips = ['assignee', 'files', 'count', 'author'].map((fieldId) =>
    screen.getByTestId(`timeline-bar-chip-row-${fieldId}`)
  );
  const [person, media, number, author] = chips;

  for (const element of chips) {
    // Caption 12/18 regular overrides the bar's `font-medium`; the chip stays a nested control.
    expect(element.className).toContain('text-xs');
    expect(element.className).toContain('leading-[18px]');
    expect(element.className).toContain('font-normal');
    expect(element.className).toContain('shrink-0');
    expect(element.className).toContain('whitespace-nowrap');
    expect(element.hasAttribute('data-timeline-control')).toBe(true);
    expect(element.querySelector('[data-testid="checkbox-chip"]')).not.toBeNull();
  }

  // Desktop paints the all-day title in textEvent but the chips in the map's primary color.
  expect(screen.getByText('Task').closest('[role="button"]')?.className).toContain('text-other-colors-text-event');
  expect(person.className).toContain('text-text-primary');
  expect(person.className).toContain('[&_.person-cell-name]:sr-only');
  expect(person.getAttribute('data-field-type')).toBe(String(FieldType.Person));
  expect(media.className).toContain('text-text-secondary');
  expect(media.className).not.toContain('text-text-primary');
  expect(number.className).toContain('text-text-primary');
  expect(number.className).not.toContain('sr-only');
  expect(author.className).toContain('text-text-primary');
  expect(author.className).not.toContain('sr-only');
});
