import { createContext, useContext } from 'react';

import { GroupColumn } from '@/application/database-yjs';

import type { CleanupFn } from '@atlaskit/pragmatic-drag-and-drop/types';

export type BoardDragContextValue = {
  getColumns: () => GroupColumn[];

  reorderColumn: (args: { startIndex: number; finishIndex: number }) => void;

  reorderCard: (args: { columnId: string; startIndex: number; finishIndex: number }) => void;

  moveCard: (args: {
    startColumnId: string;
    finishColumnId: string;
    itemIndexInStartColumn: number;
    itemIndexInFinishColumn?: number;
  }) => void;

  registerCard: (args: {
    cardId: string;
    entry: {
      element: HTMLDivElement;
    };
  }) => CleanupFn;

  registerColumn: (args: {
    columnId: string;
    entry: {
      element: HTMLDivElement;
    };
  }) => CleanupFn;

  instanceId: symbol;

  /**
   * The effective view has a sort (WP09 §1.4): cards keep their sorted place,
   * so no card is a drop target and a column refuses its own cards.
   */
  sorted: boolean;
};

export const BoardDragContext = createContext<BoardDragContextValue | null>(null);

export function useBoardDragContext(): BoardDragContextValue {
  const value = useContext(BoardDragContext);

  if (!value) {
    throw new Error('useBoardDragContext must be used within a BoardProvider');
  }

  return value;
}
