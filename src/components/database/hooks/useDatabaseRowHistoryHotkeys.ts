import { useEffect, useRef } from 'react';

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

  // Keep the live undo/redo state in a ref so the keydown listener is attached
  // once and always reads fresh values, instead of re-subscribing whenever
  // canUndo/canRedo flip (which also avoids a stale-closure fall-through bug).
  const latest = useRef({ canRedo, canUndo, redo, undo });

  latest.current = { canRedo, canUndo, redo, undo };

  useEffect(() => {
    if (!enabled || (!useLatest && !rowId)) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (ignoreInput && isInputElement()) return;

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
