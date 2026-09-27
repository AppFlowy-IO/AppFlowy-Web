import { fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';

import { FieldVisibility, TimelineLayout } from '@/application/database-yjs/database.type';

import { useTimelineRange } from '../hooks/useTimelineRange';
import { timelineColumnWidthVars, TIMELINE_SIDEBAR_WIDTH_PROPERTY } from '../table-layout';
import { TimelineColumnResizeHandle } from '../TimelineColumnResizeHandle';
import { TimelineRow } from '../TimelineRow';
import { TimelineTableProvider, timelineTableViewportWidth } from '../TimelineTable';

const mockPropertyRender = jest.fn();
const mockTranslation = { t: (key: string) => key };

jest.mock('react-i18next', () => ({ useTranslation: () => mockTranslation }));
jest.mock('@/application/database-yjs', () => ({
  ...jest.requireActual('@/application/database-yjs/database.type'),
  DEFAULT_ROW_HEIGHT: jest.requireActual('@/application/database-yjs/const').DEFAULT_ROW_HEIGHT,
  useRowMetaSelector: () => undefined,
}));
jest.mock('@/components/database/components/drag-and-drop/useRowDnd', () => ({
  useRowDnd: () => ({ dragging: false, ignoreClickRef: { current: false } }),
}));
jest.mock('@/components/database/list/ListSortState', () => ({ useListHasSorts: () => false }));
jest.mock('@/components/database/list/ListRowActions', () => ({ RowActionsMenu: () => null }));
jest.mock('@/components/database/gallery/GalleryRowIcon', () => ({ GalleryRowIcon: () => null }));
jest.mock('@/components/database/fullcalendar/event/components/EventIconButton', () => ({
  EventIconButton: () => null,
}));
jest.mock('@/components/database/components/field/CardField', () => ({
  CardField: ({ fieldId }: { fieldId: string }) => {
    mockPropertyRender(fieldId);
    return null;
  },
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

class TestPointerEvent extends MouseEvent {
  readonly pointerId = 1;
}

const rows = Array.from({ length: 10 }, (_, index) => ({
  rowId: String(index),
  title: 'Task',
  start: new Date(2026, 8, 16),
  allDay: true,
  isRange: false,
}));
const rect = { left: 20, width: 300 };
const properties = [{ fieldId: 'done', width: 100, visibility: FieldVisibility.AlwaysShown, isPrimary: false }];
const tableFieldIds = ['owner'];
const rowActions = { addAbove: jest.fn(), addBelow: jest.fn(), duplicate: jest.fn() };
const formatTime = () => '';

// Exercise the real row, bar, sidebar and table provider with the same layout
// and navigation inputs as TimelineView. Only the cell contents are counted.
function ResizeHarness({ onCommit }: { onCommit: (fieldId: string, width: number) => void }) {
  const [preview, setPreview] = useState<number | null>(null);
  const width = preview ?? 252;
  const contentWidth = width + 140 + 28;
  const sidebarWidth = timelineTableViewportWidth(contentWidth, 1280);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { scrollToX } = useTimelineRange({ layout: TimelineLayout.Month, scrollerRef, sidebarWidth });
  const onScrollTo = useCallback((x: number) => scrollToX(x, 0.25), [scrollToX]);

  return (
    <TimelineTableProvider contentWidth={contentWidth} viewportWidth={sidebarWidth}>
      <div
        data-testid='layout'
        style={timelineColumnWidthVars(
          new Map([
            ['title', width],
            ['owner', 140],
          ]),
          sidebarWidth
        )}
      >
        <TimelineColumnResizeHandle
          fieldId='title'
          width={width}
          minWidth={100}
          onResize={(_, next) => setPreview(next)}
          onCommit={onCommit}
        />
        {rows.map((row, rowIndex) => (
          <TimelineRow
            key={row.rowId}
            row={row}
            rowIndex={rowIndex}
            rect={rect}
            showSidebar
            propertyFields={properties}
            tableFieldIds={tableFieldIds}
            editable
            dateEditable
            offscreenLeft
            offscreenRight={false}
            rowActions={rowActions}
            formatTime={formatTime}
            onScrollTo={onScrollTo}
          />
        ))}
      </div>
    </TimelineTableProvider>
  );
}

test('resize previews and cancellation do not rerender unchanged bar or table properties', () => {
  const originalPointerEvent = window.PointerEvent;
  const originalCapture = {
    setPointerCapture: HTMLElement.prototype.setPointerCapture,
    hasPointerCapture: HTMLElement.prototype.hasPointerCapture,
    releasePointerCapture: HTMLElement.prototype.releasePointerCapture,
  };

  window.PointerEvent = TestPointerEvent as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.hasPointerCapture = jest.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = jest.fn();
  try {
    const onCommit = jest.fn();
    const { unmount } = render(<ResizeHarness onCommit={onCommit} />);
    const handle = screen.getByTestId('timeline-column-resize-title');

    expect(mockPropertyRender.mock.calls.filter(([fieldId]) => fieldId === 'done')).toHaveLength(10);
    expect(mockPropertyRender.mock.calls.filter(([fieldId]) => fieldId === 'owner')).toHaveLength(10);
    mockPropertyRender.mockClear();
    fireEvent.pointerDown(handle, { button: 0, clientX: 252 });
    for (let index = 1; index <= 12; index++) {
      fireEvent.pointerMove(handle, { clientX: 252 + index });
      expect(screen.getByTestId('layout').style.getPropertyValue(TIMELINE_SIDEBAR_WIDTH_PROPERTY)).toBe(
        `${420 + index}px`
      );
      expect(screen.getAllByTestId('timeline-table-viewport')[0].style.width).toBe(`${420 + index}px`);
    }

    expect(mockPropertyRender).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('layout').style.getPropertyValue(TIMELINE_SIDEBAR_WIDTH_PROPERTY)).toBe('420px');
    expect(mockPropertyRender).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    unmount();
  } finally {
    window.PointerEvent = originalPointerEvent;
    Object.assign(HTMLElement.prototype, originalCapture);
  }
});
