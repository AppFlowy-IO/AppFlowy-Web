import { createContext, useContext } from 'react';

import { SimpleTableNode } from '@/components/editor/editor.type';

export interface SimpleTableCellPosition {
  row: number;
  col: number;
}

export interface SimpleTableContextValue {
  tableNode: SimpleTableNode;
  cellPositionById: Map<string, SimpleTableCellPosition>;
  rowCount: number;
  columnCount: number;
  isHoveringTable: boolean;
  hoveringCell: { row: number; col: number } | null;
  readOnly: boolean;
  setHoveringCell: (cell: { row: number; col: number } | null) => void;
  isMenuOpen: boolean;
  setIsMenuOpen: (open: boolean) => void;
}

export const SimpleTableContext = createContext<SimpleTableContextValue | null>(null);

export function useSimpleTableContext() {
  return useContext(SimpleTableContext);
}
