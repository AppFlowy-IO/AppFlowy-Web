import { CalendarApi } from '@fullcalendar/core';
import { RefObject, useEffect } from 'react';

import { CALENDAR_DAY_COUNTS, CalendarViewType, getCalendarDayView } from '../types';

interface UseCalendarKeyboardShortcutsProps {
  calendar?: CalendarApi | null;
  toolbarRef?: RefObject<HTMLDivElement | null>;
  currentView: CalendarViewType;
  onViewChange?: (view: CalendarViewType) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onToday?: () => void;
}

export const useCalendarKeyboardShortcuts = ({
  calendar,
  toolbarRef,
  onViewChange,
  onPrev,
  onNext,
  onToday,
}: UseCalendarKeyboardShortcutsProps) => {
  useEffect(() => {
    if (!calendar) return;
    const toolbar = toolbarRef?.current;
    const keyboardTarget = toolbar?.closest('.calendar-wrapper') || toolbar;

    if (!keyboardTarget) return;
    const handleKeyDown = (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      const target = keyEvent.target;
      const editable = target instanceof Element ? target.closest('[contenteditable]') : null;

      // Normal and sticky toolbars share the same calendar. Only the first handler consumes a key.
      if (
        keyEvent.defaultPrevented ||
        keyEvent.isComposing ||
        keyEvent.repeat ||
        keyEvent.metaKey ||
        keyEvent.ctrlKey ||
        keyEvent.altKey ||
        keyEvent.shiftKey
      )
        return;
      if (
        !(target instanceof Element) ||
        (editable !== null && editable.getAttribute('contenteditable') !== 'false')
      )
        return;

      const blocked = target.closest(
        'input, textarea, select, [role="textbox"], [role="dialog"], [role="menu"], [role="listbox"]'
      );

      // An embedded calendar can live inside Slate's textbox or a row dialog.
      if (blocked && keyboardTarget.contains(blocked)) return;

      let action: (() => void) | undefined;

      switch (keyEvent.key.toLowerCase()) {
        case 'm':
          action = () => onViewChange?.(CalendarViewType.DAY_GRID_MONTH);
          break;
        case 'w':
          action = () => onViewChange?.(CalendarViewType.TIME_GRID_WEEK);
          break;
        case 'k':
          action = onPrev;
          break;
        case 'j':
          action = onNext;
          break;
        case 't':
          action = onToday;
          break;
        default: {
          const count = CALENDAR_DAY_COUNTS.find((days) => String(days) === keyEvent.key);
          const view = count && getCalendarDayView(count);

          if (view) action = () => onViewChange?.(view);
        }
      }

      if (!action) return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      action();
    };

    keyboardTarget.addEventListener('keydown', handleKeyDown);
    return () => keyboardTarget.removeEventListener('keydown', handleKeyDown);
  }, [calendar, toolbarRef, onViewChange, onPrev, onNext, onToday]);
};
