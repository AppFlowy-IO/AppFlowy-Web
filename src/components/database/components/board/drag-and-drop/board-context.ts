import { GroupColumn } from '@/application/database-yjs';
import { createContext, useContext } from 'react';
import type { CleanupFn } from '@atlaskit/pragmatic-drag-and-drop/types';

export type BoardContextValue = {
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
};

export const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoardContext (): BoardContextValue {
  const value = useContext(BoardContext);

  if (!value) {
    throw new Error('useBoardContext must be used within a BoardProvider');
  }

  return value;
}
