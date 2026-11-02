import { createContext, useContext } from 'react';

import type { BoardColumnCalculation } from '@/components/database/board/useBoardGroupCalculations';

/**
 * What every column of a board shows the same way (WP09): whether the board
 * is sorted (drag places cards by the sort) and whether "Color columns" is on.
 * Two booleans, so the memoized columns re-render only when one flips.
 */
export interface BoardColumnDisplay {
  sorted: boolean;
  showColorColumns: boolean;
}

const DEFAULT_DISPLAY: BoardColumnDisplay = { sorted: false, showColorColumns: false };

export const BoardColumnDisplayContext = createContext<BoardColumnDisplay>(DEFAULT_DISPLAY);

export function useBoardColumnDisplay() {
  return useContext(BoardColumnDisplayContext);
}

/**
 * The column calculations (`null` = the card count): a new map after every
 * recalculation, so it has its own context and only the column aggregates
 * read it. A recalculation re-renders them alone, not every column.
 */
export const BoardColumnCalculationsContext = createContext<ReadonlyMap<string, BoardColumnCalculation> | null>(null);

export function useBoardColumnCalculations() {
  return useContext(BoardColumnCalculationsContext);
}
