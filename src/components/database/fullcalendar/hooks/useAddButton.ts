import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CalendarViewType } from '../types';

interface AddButtonState {
  visible: boolean;
  position: { top: number; left: number };
  date: Date | null;
}

interface UseAddButtonOptions {
  readOnly: boolean;
  currentView: CalendarViewType;
  calendarElement: HTMLDivElement | null;
  onAddEvent: (date: Date) => Promise<string | null>;
  isAddButtonEnabled?: (date: Date) => boolean;
}

export function useAddButton({
  readOnly,
  currentView,
  calendarElement,
  onAddEvent,
  isAddButtonEnabled,
}: UseAddButtonOptions) {
  const ref = useRef<HTMLButtonElement>(null);
  const [addButtonState, setAddButtonState] = useState<AddButtonState>({
    visible: false,
    position: { top: 0, left: 0 },
    date: null,
  });

  // Note: Scrolling state is now handled via CSS opacity in AddButton component

  // Memoized debounced show function
  const debouncedShowAddButton = useMemo(
    () =>
      debounce((dayCell: Element) => {
        const rect = dayCell.getBoundingClientRect();
        const dateAttr = dayCell.getAttribute('data-date');

        if (dateAttr) {
          // FullCalendar's date-only attributes describe a local calendar day.
          // Parsing them as ISO dates would shift west-of-UTC users to yesterday.
          const [year, month, day] = dateAttr.split('-').map(Number);
          const date = new Date(year, month - 1, day);
          
          // Check if add button should be enabled for this date
          const enabled = isAddButtonEnabled ? isAddButtonEnabled(date) : true;

          if (!enabled) return;
          
          let top = rect.top + 4;
          let left = rect.left + 4;

          // If containerRef is provided, calculate position relative to container
          if (calendarElement) {
            const containerRect = calendarElement.getBoundingClientRect();

            top = rect.top - containerRect.top + 4;
            left = rect.left - containerRect.left + 4;
          }

          setAddButtonState({
            visible: true,
            position: {
              top,
              left,
            },
            date,
          });
        }
      }, 150),
    [calendarElement, isAddButtonEnabled]
  );

  // Handle day cell hover for add button
  useEffect(() => {
    if (readOnly || currentView !== CalendarViewType.DAY_GRID_MONTH) return;

    const cellListeners = new Map<HTMLElement, { enter: (e: Event) => void; leave: (e: Event) => void }>();

    const setupCellListeners = () => {
      if (!calendarElement) {
        return;
      }

      const dayCells = calendarElement.querySelectorAll('.fc-daygrid-day');

      dayCells.forEach((dayCell) => {
        if (cellListeners.has(dayCell as HTMLElement)) return;

        const handleCellEnter = (e: Event) => {
          e.stopPropagation();
          debouncedShowAddButton(dayCell);
        };

        const handleCellLeave = (e: Event) => {
          const mouseEvent = e as MouseEvent;
          const relatedTarget = mouseEvent.relatedTarget as HTMLElement;

          if (relatedTarget?.closest('[data-add-button]')) {
            return;
          }

          debouncedShowAddButton.cancel();
          setAddButtonState((prev) => ({ ...prev, visible: false }));
        };

        dayCell.addEventListener('mouseenter', handleCellEnter);
        dayCell.addEventListener('mouseleave', handleCellLeave);

        cellListeners.set(dayCell as HTMLElement, {
          enter: handleCellEnter,
          leave: handleCellLeave,
        });
      });
    };

    setupCellListeners();

    const observer = new MutationObserver(() => {
      setupCellListeners();
    });

    if (calendarElement) {
      observer.observe(calendarElement, { childList: true, subtree: true });
    }

    return () => {
      debouncedShowAddButton.cancel();

      cellListeners.forEach((listeners, cell) => {
        cell.removeEventListener('mouseenter', listeners.enter);
        cell.removeEventListener('mouseleave', listeners.leave);
      });
      cellListeners.clear();

      observer.disconnect();
    };
  }, [readOnly, currentView, calendarElement, debouncedShowAddButton]);

  // Handle add button click
  const handleAddButtonClick = useCallback(async () => {
    if (addButtonState.date) {


      await onAddEvent(addButtonState.date);
      setAddButtonState((prev) => ({ ...prev, visible: false }));
    }
  }, [addButtonState.date, onAddEvent]);

  // Handle add button mouse leave
  const handleAddButtonMouseLeave = useCallback((e: React.MouseEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement;

    if (relatedTarget?.closest('.fc-daygrid-day')) {
      return;
    }

    setAddButtonState((prev) => ({ ...prev, visible: false }));
  }, []);

  return {
    addButtonState,
    handleAddButtonClick,
    handleAddButtonMouseLeave,
    ref,
  };
}
