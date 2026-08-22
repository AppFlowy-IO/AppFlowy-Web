import { Editor, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import * as Y from 'yjs';

import { relativeRangeToSlateRange, slateRangeToRelativeRange } from '@/application/slate-yjs/utils/positions';
import { isValidSelection } from '@/application/slate-yjs/utils/transformSelection';
import { getDocument } from '@/application/slate-yjs/utils/yjs';
import { CollabOrigin } from '@/application/types';

import { HistoryStackItem, RelativeRange } from '../types';

import { YjsEditor } from './withYjs';

const LAST_SELECTION: WeakMap<Editor, RelativeRange | null> = new WeakMap();

type HistoryStackEvent = {
  stackItem: HistoryStackItem;
  type: 'redo' | 'undo';
};

type UndoManagerUpdatedEventApi = {
  on: (eventName: 'stack-item-updated', handler: (event: HistoryStackEvent) => void) => void;
  off: (eventName: 'stack-item-updated', handler: (event: HistoryStackEvent) => void) => void;
};

export type YHistoryEditor = YjsEditor & {
  undoManager: Y.UndoManager;
  undo: () => void;
  redo: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-redeclare
export const YHistoryEditor = {
  isYHistoryEditor(value: unknown): value is YHistoryEditor {
    return (
      YjsEditor.isYjsEditor(value) &&
      'undoManager' in value &&
      typeof (value as YHistoryEditor).undo === 'function' &&
      typeof (value as YHistoryEditor).redo === 'function'
    );
  },

  canUndo(editor: YHistoryEditor) {
    return editor.undoManager.undoStack.length > 0;
  },

  canRedo(editor: YHistoryEditor) {
    return editor.undoManager.redoStack.length > 0;
  },
};

export function withYHistory<T extends YjsEditor>(editor: T): T & YHistoryEditor {
  const e = editor as T & YHistoryEditor;

  if (e.readOnly) {
    return e;
  }

  const document = getDocument(e.sharedRoot);

  if (!document) {
    return e;
  }

  e.undoManager = new Y.UndoManager(document, {
    trackedOrigins: new Set([CollabOrigin.Local, CollabOrigin.LocalManual, null]),
    captureTimeout: 200,
  });

  const { onChange } = e;

  e.onChange = () => {
    onChange();

    const selection = e.selection;

    try {
      const storeSelection = selection && slateRangeToRelativeRange(e.sharedRoot, e, selection);

      LAST_SELECTION.set(e, storeSelection);
    } catch (e) {
      //console.error(e);
    }
  };

  const handleStackItemChanged = ({ stackItem }: HistoryStackEvent) => {
    try {
      // Yjs 14.0.0-1 emits `stack-item-added` again when a transaction is
      // merged into the latest item. Newer Yjs versions emit
      // `stack-item-updated` instead. In either case, keep the selection from
      // before the first transaction and refresh the final selection.
      if (!stackItem.meta.has('selectionBefore')) {
        stackItem.meta.set('selectionBefore', LAST_SELECTION.get(e));
      }

      stackItem.meta.set('selection', e.selection && slateRangeToRelativeRange(e.sharedRoot, e, e.selection));
    } catch (e) {
      // console.error(e);
    }
  };

  const handleStackItemPopped = ({ stackItem, type }: HistoryStackEvent) => {
    // UndoManager creates the inverse item before emitting stack-item-popped.
    // Carry the original boundary selections to it so redo restores the final
    // cursor, and the next undo restores the initial cursor again.
    const inverseStack = type === 'undo' ? e.undoManager.redoStack : e.undoManager.undoStack;
    const inverseItem = inverseStack[inverseStack.length - 1] as HistoryStackItem | undefined;

    if (inverseItem) {
      inverseItem.meta.set('selection', stackItem.meta.get('selectionBefore'));
      inverseItem.meta.set('selectionBefore', stackItem.meta.get('selection'));
    }

    const relativeSelection = stackItem.meta.get('selectionBefore') as RelativeRange | null;

    if (!relativeSelection) {
      return;
    }

    const selection = relativeRangeToSlateRange(e.sharedRoot, relativeSelection);

    if (!selection || !ReactEditor.hasRange(editor, selection)) {
      const startPoint = Editor.start(e, [0]);

      if (isValidSelection(e, { anchor: startPoint, focus: startPoint })) {
        Transforms.select(e, startPoint);
      }

      return;
    }

    if (isValidSelection(e, selection)) {
      Transforms.select(e, selection);
    }
  };

  const { connect } = e;
  // The pinned Yjs typings predate `stack-item-updated`, although newer
  // runtimes support it. Keep the compatibility cast local to this event.
  const updatedEventApi = e.undoManager as unknown as UndoManagerUpdatedEventApi;

  e.connect = () => {
    connect();
    e.undoManager.on('stack-item-added', handleStackItemChanged);
    updatedEventApi.on('stack-item-updated', handleStackItemChanged);
    e.undoManager.on('stack-item-popped', handleStackItemPopped);
  };

  const { disconnect } = e;

  e.disconnect = () => {
    e.undoManager.off('stack-item-added', handleStackItemChanged);
    updatedEventApi.off('stack-item-updated', handleStackItemChanged);
    e.undoManager.off('stack-item-popped', handleStackItemPopped);
    disconnect();
  };

  e.undo = () => {
    if (YjsEditor.connected(e)) {
      YjsEditor.flushLocalChanges(e);
      e.undoManager.undo();
    }
  };

  e.redo = () => {
    if (YjsEditor.connected(e)) {
      YjsEditor.flushLocalChanges(e);
      e.undoManager.redo();
    }
  };

  return e;
}
