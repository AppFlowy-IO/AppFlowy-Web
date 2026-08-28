import { useEffect, useLayoutEffect, useRef } from 'react';

import { useDatabaseHistoryManager } from '@/application/database-yjs';
import { RowId } from '@/application/types';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

const isUndoHotkey = createHotkey(HOT_KEY_NAME.UNDO);
const isRedoHotkey = createHotkey(HOT_KEY_NAME.REDO);

export function isDatabaseHistoryHotkey(event: KeyboardEvent): boolean {
  return isUndoHotkey(event) || isRedoHotkey(event);
}

function getEventTargetElement(event: KeyboardEvent): Element | null {
  const target = event.target;

  if (target instanceof Element) return target;
  if (target instanceof Node && target.parentElement) return target.parentElement;

  return document.activeElement;
}

function isContentEditableElement(element: Element): boolean {
  let current: Element | null = element;

  while (current) {
    const contentEditable = current.getAttribute('contenteditable');

    if (contentEditable !== null) {
      const normalizedValue = contentEditable.toLowerCase();

      if (normalizedValue === 'false') return false;
      if (normalizedValue === '' || normalizedValue === 'true' || normalizedValue === 'plaintext-only') return true;
    }

    current = current.parentElement;
  }

  return false;
}

function isEditableEventTarget(event: KeyboardEvent): boolean {
  const element = getEventTargetElement(event);

  if (!element) return false;
  if (element.closest('[data-database-history-hotkeys="true"]')) return false;

  const formControl = element.closest('input, textarea, select');

  if (formControl instanceof HTMLInputElement || formControl instanceof HTMLTextAreaElement) {
    return !formControl.disabled && !formControl.readOnly;
  }

  if (formControl instanceof HTMLSelectElement) {
    return !formControl.disabled;
  }

  return isContentEditableElement(element);
}

export function useDatabaseRowHistoryHotkeys(
  rowId?: RowId,
  options: {
    enabled?: boolean;
    ignoreInput?: boolean;
    useLatest?: boolean;
  } = {}
) {
  const { enabled = true, ignoreInput = true, useLatest = false } = options;
  const manager = useDatabaseHistoryManager(useLatest ? undefined : rowId);

  // A document listener outlives the render that created it. Publish a new
  // manager only after that render commits so an interrupted render cannot
  // expose callbacks from UI that never became active.
  const latestManager = useRef(manager);

  useLayoutEffect(() => {
    latestManager.current = manager;
  }, [manager]);

  useEffect(() => {
    if (!enabled || (!useLatest && !rowId)) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (ignoreInput && isEditableEventTarget(event)) return;

      const history = latestManager.current;

      if (isRedoHotkey(event)) {
        if (!history.canRedo()) return;

        event.preventDefault();
        history.redo();
        return;
      }

      if (isUndoHotkey(event)) {
        if (!history.canUndo()) return;

        event.preventDefault();
        history.undo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, ignoreInput, rowId, useLatest]);
}
