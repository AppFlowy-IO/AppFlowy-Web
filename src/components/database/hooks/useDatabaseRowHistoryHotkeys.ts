import { useEffect, useRef } from 'react';

import { useDatabaseHistory } from '@/application/database-yjs';
import { RowId } from '@/application/types';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

const isUndoHotkey = createHotkey(HOT_KEY_NAME.UNDO);
const isRedoHotkey = createHotkey(HOT_KEY_NAME.REDO);

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
  const { canRedo, canUndo, redo, undo } = useDatabaseHistory(useLatest ? undefined : rowId);

  // Keep the live undo/redo state in a ref so the keydown listener is attached
  // once and always reads fresh values, instead of re-subscribing whenever
  // canUndo/canRedo flip (which also avoids a stale-closure fall-through bug).
  const latest = useRef({ canRedo, canUndo, redo, undo });

  latest.current = { canRedo, canUndo, redo, undo };

  useEffect(() => {
    if (!enabled || (!useLatest && !rowId)) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (ignoreInput && isEditableEventTarget(event)) return;

      const { canRedo, canUndo, redo, undo } = latest.current;

      if (isRedoHotkey(event)) {
        if (!canRedo) return;

        event.preventDefault();
        redo();
        return;
      }

      if (isUndoHotkey(event)) {
        if (!canUndo) return;

        event.preventDefault();
        undo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, ignoreInput, rowId, useLatest]);
}
