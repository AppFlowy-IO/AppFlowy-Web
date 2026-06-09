import { useEffect } from 'react';

import { useDatabaseHistory } from '@/application/database-yjs';
import { RowId } from '@/application/types';
import { createHotkey, HOT_KEY_NAME, isInputElement } from '@/utils/hotkeys';

const isUndoHotkey = createHotkey(HOT_KEY_NAME.UNDO);
const isRedoHotkey = createHotkey(HOT_KEY_NAME.REDO);

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

  useEffect(() => {
    if (!enabled || (!useLatest && !rowId)) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (ignoreInput && isInputElement()) return;

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
  }, [canRedo, canUndo, enabled, ignoreInput, redo, rowId, undo, useLatest]);
}
